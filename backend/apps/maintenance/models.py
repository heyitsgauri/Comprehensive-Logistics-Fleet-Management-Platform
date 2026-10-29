from django.db import models

from apps.fleet.models import Vehicle


class MaintenanceRecord(models.Model):
    class Kind(models.TextChoices):
        SCHEDULED = "scheduled", "Scheduled service"
        PREVENTIVE = "preventive", "Preventive maintenance"
        REPAIR = "repair", "Repair"

    class Status(models.TextChoices):
        SCHEDULED = "scheduled", "Scheduled"
        IN_PROGRESS = "in_progress", "In progress"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"

    vehicle = models.ForeignKey(
        Vehicle,
        on_delete=models.PROTECT,
        related_name="maintenance",
    )
    kind = models.CharField(
        max_length=20,
        choices=Kind.choices,
        default=Kind.SCHEDULED,
    )
    description = models.CharField(max_length=255)
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.SCHEDULED,
        db_index=True,
    )
    scheduled_date = models.DateField()
    estimated_cost = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=0,
    )
    notes = models.TextField(blank=True)
    completed_date = models.DateField(null=True, blank=True)
    cost = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    odometer_km = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["scheduled_date"]
