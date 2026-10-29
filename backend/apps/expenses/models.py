from django.db import models

from apps.fleet.models import Vehicle
from apps.trips.models import Trip


class Expense(models.Model):
    class Category(models.TextChoices):
        FUEL = "fuel", "Fuel"
        TOLL = "toll", "Toll"
        MAINTENANCE = "maintenance", "Maintenance"
        OTHER = "other", "Other"

    category = models.CharField(
        max_length=20,
        choices=Category.choices,
        db_index=True,
    )
    vehicle = models.ForeignKey(
        Vehicle,
        on_delete=models.PROTECT,
        related_name="expenses",
    )
    trip = models.ForeignKey(
        Trip,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="expenses",
    )
    maintenance_record = models.OneToOneField(
        "maintenance.MaintenanceRecord",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="expense",
    )
    date = models.DateField()
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    litres = models.DecimalField(
        max_digits=8,
        decimal_places=2,
        null=True,
        blank=True,
    )
    unit_price = models.DecimalField(
        max_digits=8,
        decimal_places=2,
        null=True,
        blank=True,
    )
    note = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date", "-id"]
