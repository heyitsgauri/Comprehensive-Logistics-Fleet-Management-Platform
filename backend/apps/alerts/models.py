from django.db import models

from apps.fleet.models import Vehicle
from apps.shipments.models import Shipment


class Alert(models.Model):
    class Severity(models.TextChoices):
        CRITICAL = "critical", "Critical"
        WARNING = "warning", "Warning"
        INFO = "info", "Info"

    class Status(models.TextChoices):
        OPEN = "open", "Open"
        ACKNOWLEDGED = "acknowledged", "Acknowledged"
        RESOLVED = "resolved", "Resolved"

    key = models.CharField(max_length=60, unique=True)
    category = models.CharField(max_length=20, db_index=True)
    severity = models.CharField(max_length=10, choices=Severity.choices)
    message = models.CharField(max_length=255)
    vehicle = models.ForeignKey(
        Vehicle,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    shipment = models.ForeignKey(
        Shipment,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    status = models.CharField(
        max_length=15,
        choices=Status.choices,
        default=Status.OPEN,
        db_index=True,
    )
    resolution = models.CharField(max_length=10, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
