from django.conf import settings
from django.db import models


class Vehicle(models.Model):
    class Status(models.TextChoices):
        AVAILABLE = "available", "Available"
        ASSIGNED = "assigned", "Assigned"
        IN_TRANSIT = "in_transit", "In Transit"
        MAINTENANCE = "maintenance", "Maintenance"
        INACTIVE = "inactive", "Inactive"

    class FuelType(models.TextChoices):
        DIESEL = "diesel", "Diesel"
        PETROL = "petrol", "Petrol"
        CNG = "cng", "CNG"
        ELECTRIC = "electric", "Electric"

    registration_number = models.CharField(max_length=20, unique=True)
    vehicle_type = models.CharField(max_length=50)
    make = models.CharField(max_length=50)
    model = models.CharField(max_length=50)
    capacity_kg = models.DecimalField(max_digits=10, decimal_places=2)
    fuel_type = models.CharField(
        max_length=10,
        choices=FuelType.choices,
        default=FuelType.DIESEL,
    )
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.AVAILABLE,
        db_index=True,
    )
    odometer_km = models.PositiveIntegerField(default=0)
    insurance_expiry = models.DateField(null=True, blank=True)
    permit_expiry = models.DateField(null=True, blank=True)
    current_lat = models.FloatField(null=True, blank=True)
    current_lng = models.FloatField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["registration_number"]

    def __str__(self):
        return self.registration_number


class Driver(models.Model):
    class Status(models.TextChoices):
        AVAILABLE = "available", "Available"
        ASSIGNED = "assigned", "Assigned"
        ON_TRIP = "on_trip", "On Trip"
        OFF_DUTY = "off_duty", "Off Duty"
        INACTIVE = "inactive", "Inactive"

    full_name = models.CharField(max_length=100)
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="driver_record",
    )
    phone = models.CharField(max_length=20)
    license_number = models.CharField(max_length=30, unique=True)
    license_expiry = models.DateField()
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.AVAILABLE,
        db_index=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["full_name"]

    def __str__(self):
        return self.full_name
