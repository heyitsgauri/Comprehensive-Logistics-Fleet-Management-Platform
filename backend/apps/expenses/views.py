from datetime import date

from django.db.models import Sum
from rest_framework import mixins, viewsets
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.audit import log_event
from apps.accounts.permissions import RolePermission
from apps.trips.models import Trip

from .models import Expense
from .serializers import ExpenseSerializer


def parse_date(value):
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ValidationError("Dates must be YYYY-MM-DD.") from exc


def apply_filters(request, queryset):
    params = request.query_params
    if params.get("category"):
        queryset = queryset.filter(category=params["category"])
    if params.get("vehicle", "").isdigit():
        queryset = queryset.filter(vehicle_id=params["vehicle"])
    date_from = parse_date(params.get("date_from"))
    date_to = parse_date(params.get("date_to"))
    if date_from:
        queryset = queryset.filter(date__gte=date_from)
    if date_to:
        queryset = queryset.filter(date__lte=date_to)
    return queryset


class ExpenseViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    queryset = Expense.objects.select_related(
        "vehicle",
        "trip__shipment",
    )
    serializer_class = ExpenseSerializer
    permission_classes = [RolePermission]
    write_roles = ("admin", "fleet_manager", "coordinator")

    def get_queryset(self):
        return apply_filters(self.request, super().get_queryset())

    def perform_create(self, serializer):
        expense = serializer.save()
        log_event(
            self.request.user,
            "vehicle",
            expense.vehicle_id,
            f"{expense.get_category_display()} expense recorded: {expense.amount}",
        )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def expense_summary(request):
    queryset = apply_filters(request, Expense.objects.all())
    by_category = {category: 0.0 for category in Expense.Category.values}
    for row in queryset.values("category").annotate(total=Sum("amount")):
        by_category[row["category"]] = float(row["total"])

    trip_rows = list(
        queryset.filter(trip__isnull=False)
        .values("trip_id", "trip__shipment__reference")
        .annotate(total=Sum("amount"))
        .order_by("-total")
    )
    top_trips = [
        {
            "trip_id": row["trip_id"],
            "shipment_ref": row["trip__shipment__reference"],
            "total": float(row["total"]),
        }
        for row in trip_rows[:5]
    ]

    date_from = parse_date(request.query_params.get("date_from"))
    date_to = parse_date(request.query_params.get("date_to"))
    fuel_rows = (
        queryset.filter(category=Expense.Category.FUEL, litres__isnull=False)
        .values("vehicle_id", "vehicle__registration_number")
        .annotate(litres=Sum("litres"))
    )
    efficiency = []
    for row in fuel_rows:
        trips = Trip.objects.filter(
            vehicle_id=row["vehicle_id"],
            status=Trip.Status.COMPLETED,
        )
        if date_from:
            trips = trips.filter(completed_at__date__gte=date_from)
        if date_to:
            trips = trips.filter(completed_at__date__lte=date_to)
        distance = trips.aggregate(total=Sum("distance_km"))["total"] or 0
        litres = float(row["litres"])
        efficiency.append(
            {
                "vehicle_reg": row["vehicle__registration_number"],
                "km": round(distance, 1),
                "litres": litres,
                "km_per_litre": round(distance / litres, 2)
                if litres and distance
                else None,
            }
        )

    linked_totals = [row["total"] for row in trip_rows]
    return Response(
        {
            "total": sum(by_category.values()),
            "by_category": by_category,
            "fuel_litres": float(
                queryset.filter(category=Expense.Category.FUEL).aggregate(
                    total=Sum("litres")
                )["total"]
                or 0
            ),
            "avg_cost_per_trip": round(
                sum(linked_totals) / len(linked_totals), 2
            )
            if linked_totals
            else None,
            "top_trips": top_trips,
            "fuel_efficiency": efficiency,
            "assumptions": [
                "Fuel amount = litres x unit price.",
                "Cost per trip only counts expenses linked to that trip.",
                "Fuel efficiency is an approximation using completed trip distance "
                "and recorded fuel litres for the selected period.",
            ],
        }
    )
