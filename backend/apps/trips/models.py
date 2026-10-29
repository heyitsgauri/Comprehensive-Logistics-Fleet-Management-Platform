from django.conf import settings
from django.db import models

from apps.fleet.models import Driver, Vehicle
from apps.shipments.models import Shipment

ACTIVE = ["planned", "in_transit"]


class Trip(models.Model):
    class Status(models.TextChoices):
        PLANNED = "planned", "Planned"
        IN_TRANSIT = "in_transit", "In Transit"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"

    shipment = models.ForeignKey(
        Shipment,
        on_delete=models.PROTECT,
        related_name="trips",
    )
    vehicle = models.ForeignKey(
        Vehicle,
        on_delete=models.PROTECT,
        related_name="trips",
    )
    driver = models.ForeignKey(
        Driver,
        on_delete=models.PROTECT,
        related_name="trips",
    )
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PLANNED,
        db_index=True,
    )
    distance_km = models.FloatField(null=True, blank=True)
    planned_duration_min = models.PositiveIntegerField(null=True, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    estimated_arrival = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["vehicle"],
                condition=models.Q(status__in=ACTIVE),
                name="one_active_trip_per_vehicle",
            ),
            models.UniqueConstraint(
                fields=["driver"],
                condition=models.Q(status__in=ACTIVE),
                name="one_active_trip_per_driver",
            ),
            models.UniqueConstraint(
                fields=["shipment"],
                condition=models.Q(status__in=ACTIVE),
                name="one_active_trip_per_shipment",
            ),
        ]

    def __str__(self):
        return f"Trip {self.pk} ({self.status})"
