from datetime import timedelta
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import filters, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from apps.accounts.audit import log_event
from apps.accounts.permissions import RolePermission
from apps.alerts.services import refresh_alerts
from apps.expenses.models import Expense
from apps.fleet.models import Vehicle

from .models import MaintenanceRecord
from .serializers import MaintenanceSerializer

Status = MaintenanceRecord.Status


class MaintenanceViewSet(viewsets.ModelViewSet):
    queryset = MaintenanceRecord.objects.select_related("vehicle")
    serializer_class = MaintenanceSerializer
    permission_classes = [RolePermission]
    write_roles = ("admin", "fleet_manager")
    http_method_names = ["get", "post", "put", "patch", "head", "options"]
    filter_backends = [filters.SearchFilter]
    search_fields = ["description", "notes", "vehicle__registration_number"]

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if params.get("status"):
            qs = qs.filter(status=params["status"])
        if params.get("vehicle", "").isdigit():
            qs = qs.filter(vehicle_id=params["vehicle"])
        if params.get("due") == "week":
            qs = qs.filter(
                status__in=[Status.SCHEDULED, Status.IN_PROGRESS],
                scheduled_date__lte=timezone.localdate() + timedelta(days=7),
            )
        return qs

    def perform_create(self, serializer):
        record = serializer.save()
        log_event(
            self.request.user,
            "vehicle",
            record.vehicle_id,
            f"Maintenance scheduled: {record.description}",
        )
        refresh_alerts()

    def perform_update(self, serializer):
        record = serializer.instance
        with transaction.atomic():
            locked = get_object_or_404(
                MaintenanceRecord.objects.select_for_update(),
                pk=record.pk,
            )
            if locked.status != Status.SCHEDULED:
                raise ValidationError("Only scheduled maintenance can be edited.")
            updated = serializer.save()
            log_event(
                self.request.user,
                "vehicle",
                updated.vehicle_id,
                f"Scheduled maintenance edited: {updated.description}",
            )
            refresh_alerts()

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        with transaction.atomic():
            record = get_object_or_404(
                MaintenanceRecord.objects.select_for_update(),
                pk=pk,
            )
            if record.status != Status.SCHEDULED:
                raise ValidationError(
                    "Only scheduled maintenance can be cancelled."
                )
            record.status = Status.CANCELLED
            record.save(update_fields=["status"])
            log_event(
                request.user,
                "vehicle",
                record.vehicle_id,
                f"Maintenance cancelled: {record.description}",
            )
            refresh_alerts()
        return Response(self.get_serializer(record).data)

    @action(detail=True, methods=["post"])
    def start(self, request, pk=None):
        with transaction.atomic():
            record = get_object_or_404(
                MaintenanceRecord.objects.select_for_update(),
                pk=pk,
            )
            if record.status != Status.SCHEDULED:
                raise ValidationError("Only scheduled maintenance can be started.")
            vehicle = Vehicle.objects.select_for_update().get(pk=record.vehicle_id)
            if vehicle.status != Vehicle.Status.AVAILABLE:
                raise ValidationError(
                    f"Vehicle is {vehicle.get_status_display().lower()}. "
                    "It must be available to enter maintenance."
                )
            vehicle.status = Vehicle.Status.MAINTENANCE
            vehicle.save(update_fields=["status"])
            record.status = Status.IN_PROGRESS
            record.save(update_fields=["status"])
            log_event(
                request.user,
                "vehicle",
                vehicle.id,
                f"Maintenance started: {record.description}",
            )
            refresh_alerts()
        return Response(self.get_serializer(record).data)

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        try:
            cost = Decimal(str(request.data.get("cost") or 0))
        except InvalidOperation as exc:
            raise ValidationError({"cost": "Enter a valid number."}) from exc
        if not cost.is_finite() or cost < 0:
            raise ValidationError({"cost": "Cost cannot be negative."})
        odometer = request.data.get("odometer_km")
        if odometer not in (None, "") and (
            not str(odometer).isdigit() or int(odometer) < 0
        ):
            raise ValidationError({"odometer_km": "Enter a whole number."})

        with transaction.atomic():
            record = get_object_or_404(
                MaintenanceRecord.objects.select_for_update(),
                pk=pk,
            )
            if record.status != Status.IN_PROGRESS:
                raise ValidationError(
                    "Only maintenance in progress can be completed."
                )
            vehicle = Vehicle.objects.select_for_update().get(pk=record.vehicle_id)
            record.status = Status.COMPLETED
            record.completed_date = timezone.localdate()
            record.cost = cost
            if odometer not in (None, ""):
                record.odometer_km = int(odometer)
                vehicle.odometer_km = max(vehicle.odometer_km, int(odometer))
            record.save()
            other_open = MaintenanceRecord.objects.filter(
                vehicle=vehicle,
                status=Status.IN_PROGRESS,
            ).exclude(pk=record.pk).exists()
            if vehicle.status == Vehicle.Status.MAINTENANCE and not other_open:
                vehicle.status = Vehicle.Status.AVAILABLE
            vehicle.save()
            if cost > 0:
                Expense.objects.update_or_create(
                    maintenance_record=record,
                    defaults={
                        "category": Expense.Category.MAINTENANCE,
                        "vehicle": vehicle,
                        "date": record.completed_date,
                        "amount": cost,
                        "note": record.description,
                    },
                )
            log_event(
                request.user,
                "vehicle",
                vehicle.id,
                f"Maintenance completed: {record.description}",
            )
            refresh_alerts()
        return Response(self.get_serializer(record).data)
