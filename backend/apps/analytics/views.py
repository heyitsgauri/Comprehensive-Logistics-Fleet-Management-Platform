import csv
from datetime import date, datetime, time, timedelta

from django.db.models import Avg, Count, Sum
from django.http import HttpResponse
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.expenses.models import Expense
from apps.fleet.models import Vehicle
from apps.trips.models import Trip

LITRES_PER_KM = 0.35
EMISSION_FACTOR = {
    Vehicle.FuelType.DIESEL: 2.68,
    Vehicle.FuelType.PETROL: 2.31,
}


def parse_range(request):
    today = timezone.localdate()
    try:
        start = date.fromisoformat(
            request.query_params.get("from", (today - timedelta(days=29)).isoformat())
        )
        end = date.fromisoformat(
            request.query_params.get("to", today.isoformat())
        )
    except ValueError as exc:
        raise ValidationError("Dates must be YYYY-MM-DD.") from exc
    if start > end:
        raise ValidationError("'from' must be on or before 'to'.")
    if (end - start).days > 365:
        raise ValidationError("Date range cannot exceed 366 days.")
    return start, end, timezone.make_aware(datetime.combine(start, time.min)), timezone.make_aware(
        datetime.combine(end + timedelta(days=1), time.min)
    )


def range_trips(start_at, end_at):
    return Trip.objects.filter(created_at__gte=start_at, created_at__lt=end_at)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def trends(request):
    start, end, start_at, end_at = parse_range(request)
    created_trips = range_trips(start_at, end_at)
    completed = list(
        Trip.objects.filter(
            status=Trip.Status.COMPLETED,
            completed_at__gte=start_at,
            completed_at__lt=end_at,
        ).select_related(
            "shipment",
            "driver",
            "vehicle",
        )
    )
    deliveries = len(completed)
    on_time = sum(
        trip.completed_at <= trip.shipment.deadline for trip in completed
    )
    durations = [
        (trip.completed_at - trip.started_at).total_seconds() / 60
        for trip in completed
        if trip.started_at
    ]

    daily = []
    day = start
    while day <= end:
        day_start = timezone.make_aware(datetime.combine(day, time.min))
        next_day = day_start + timedelta(days=1)
        daily.append(
            {
                "date": day.isoformat(),
                "created": created_trips.filter(
                    created_at__gte=day_start,
                    created_at__lt=next_day,
                ).count(),
                "delivered": Trip.objects.filter(
                    status=Trip.Status.COMPLETED,
                    completed_at__gte=day_start,
                    completed_at__lt=next_day,
                ).count(),
                "late": sum(
                    timezone.localtime(trip.completed_at).date() == day
                    and trip.completed_at > trip.shipment.deadline
                    for trip in completed
                ),
            }
        )
        day += timedelta(days=1)

    expenses = Expense.objects.filter(date__gte=start, date__lte=end)
    cost_rows = {
        row["category"]: float(row["total"] or 0)
        for row in expenses.values("category").annotate(total=Sum("amount"))
    }
    costs = {
        category: cost_rows.get(category, 0.0)
        for category in Expense.Category.values
    }
    costs["total"] = sum(costs.values())

    drivers = {}
    for trip in completed:
        item = drivers.setdefault(
            trip.driver_id,
            {
                "driver": trip.driver.full_name,
                "trips": 0,
                "on_time": 0,
                "minutes": [],
            },
        )
        item["trips"] += 1
        item["on_time"] += trip.completed_at <= trip.shipment.deadline
        if trip.started_at:
            item["minutes"].append(
                (trip.completed_at - trip.started_at).total_seconds() / 60
            )
    driver_rows = [
        {
            "driver": item["driver"],
            "trips": item["trips"],
            "on_time_rate": round(100 * item["on_time"] / item["trips"], 1),
            "avg_minutes": round(sum(item["minutes"]) / len(item["minutes"]))
            if item["minutes"]
            else None,
        }
        for item in sorted(
            drivers.values(),
            key=lambda item: item["trips"],
            reverse=True,
        )
    ]

    active_fleet = Vehicle.objects.exclude(status=Vehicle.Status.INACTIVE)
    active_count = active_fleet.count()
    utilized = created_trips.filter(
        status__in=[Trip.Status.PLANNED, Trip.Status.IN_TRANSIT, Trip.Status.COMPLETED]
    ).values("vehicle_id").distinct().count()
    emissions_total = 0.0
    estimated = 0
    excluded = 0
    for trip in completed:
        factor = EMISSION_FACTOR.get(trip.vehicle.fuel_type)
        if factor is None or trip.distance_km is None:
            excluded += 1
        else:
            emissions_total += trip.distance_km * LITRES_PER_KM * factor
            estimated += 1

    return Response(
        {
            "daily": daily,
            "deliveries": deliveries,
            "on_time_rate": round(100 * on_time / deliveries, 1)
            if deliveries
            else None,
            "avg_delivery_minutes": round(sum(durations) / len(durations))
            if durations
            else None,
            "fleet_utilization": round(100 * utilized / active_count, 1)
            if active_count
            else None,
            "costs": costs,
            "drivers": driver_rows,
            "emissions": {
                "total_kg_co2": round(emissions_total, 1),
                "trips_estimated": estimated,
                "trips_excluded": excluded,
                "assumptions": [
                    f"Estimate: distance x {LITRES_PER_KM} L/km x fuel emission factor.",
                    "Emission factors (kg CO2/L): diesel 2.68, petrol 2.31.",
                    "CNG/electric vehicles and trips without distance are excluded.",
                ],
            },
        }
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def export_csv(request):
    _, _, start_at, end_at = parse_range(request)
    response = HttpResponse(content_type="text/csv")
    response["Content-Disposition"] = 'attachment; filename="trips.csv"'
    writer = csv.writer(response)
    writer.writerow(
        [
            "Trip",
            "Shipment",
            "Customer",
            "Vehicle",
            "Driver",
            "Status",
            "Started",
            "Completed",
            "Deadline",
            "Distance km",
            "On time",
        ]
    )
    trips = (
        Trip.objects.filter(created_at__gte=start_at, created_at__lt=end_at)
        .select_related("shipment__customer", "vehicle", "driver")
        .order_by("created_at")
    )
    for trip in trips:
        on_time = (
            ""
            if not trip.completed_at
            else "yes"
            if trip.completed_at <= trip.shipment.deadline
            else "no"
        )
        writer.writerow(
            [
                trip.id,
                trip.shipment.reference,
                trip.shipment.customer.name,
                trip.vehicle.registration_number,
                trip.driver.full_name,
                trip.status,
                trip.started_at or "",
                trip.completed_at or "",
                trip.shipment.deadline,
                trip.distance_km or "",
                on_time,
            ]
        )
    return response
