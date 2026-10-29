import uuid
from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from apps.fleet.models import Driver, Vehicle


class Customer(models.Model):
    name = models.CharField(max_length=150)
    contact_name = models.CharField(max_length=100, blank=True)
    phone = models.CharField(max_length=20)
    email = models.EmailField(blank=True)
    address = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


def lat_field():
    return models.FloatField(
        validators=[MinValueValidator(-90), MaxValueValidator(90)]
    )


def lng_field():
    return models.FloatField(
        validators=[MinValueValidator(-180), MaxValueValidator(180)]
    )


class Shipment(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        PENDING = "pending", "Pending Assignment"
        ASSIGNED = "assigned", "Assigned"
        AWAITING_DRIVER_ACCEPTANCE = "awaiting_acceptance", "Awaiting Driver Acceptance"
        ACCEPTED = "accepted", "Accepted"
        REJECTED = "rejected", "Rejected"
        IN_TRANSIT = "in_transit", "In Transit"
        DELAYED = "delayed", "Delayed"
        DELIVERED = "delivered", "Delivered"
        CANCELLED = "cancelled", "Cancelled"

    reference = models.CharField(
        max_length=20,
        unique=True,
        null=True,
        blank=True,
        editable=False,
    )
    customer = models.ForeignKey(
        Customer,
        on_delete=models.PROTECT,
        related_name="shipments",
    )
    pickup_address = models.TextField()
    pickup_lat = lat_field()
    pickup_lng = lng_field()
    delivery_address = models.TextField()
    delivery_lat = lat_field()
    delivery_lng = lng_field()
    cargo_description = models.CharField(max_length=255)
    weight_kg = models.DecimalField(max_digits=10, decimal_places=2)
    deadline = models.DateTimeField()
    scheduled_departure = models.DateTimeField(null=True, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(
        max_length=25,
        choices=Status.choices,
        default=Status.PENDING,
        db_index=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        if not self.reference:
            self.reference = f"SHP-{self.pk:05d}"
            super().save(update_fields=["reference"])

    def __str__(self):
        return self.reference or f"Shipment {self.pk}"


class Warehouse(models.Model):
    name = models.CharField(max_length=150, unique=True)
    address = models.TextField()
    lat = lat_field()
    lng = lng_field()
    operating_hours = models.CharField(max_length=100, blank=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class DispatchRequest(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending Acceptance"
        ACCEPTED = "accepted", "Accepted"
        REJECTED = "rejected", "Rejected"
        CANCELLED = "cancelled", "Cancelled"
        SUPERSEDED = "superseded", "Superseded"

    class SmsStatus(models.TextChoices):
        PENDING = "pending", "Pending"
        SENT = "sent", "Sent"
        DELIVERED = "delivered", "Delivered"
        FAILED = "failed", "Failed"

    shipment = models.ForeignKey(
        Shipment,
        on_delete=models.CASCADE,
        related_name="dispatch_requests",
    )
    vehicle = models.ForeignKey(
        Vehicle,
        on_delete=models.PROTECT,
        related_name="dispatch_requests",
    )
    driver = models.ForeignKey(
        Driver,
        on_delete=models.PROTECT,
        related_name="dispatch_requests",
    )
    dispatched_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PENDING,
        db_index=True,
    )
    token = models.UUIDField(
        default=uuid.uuid4,
        unique=True,
        editable=False,
        db_index=True,
    )
    rejection_reason = models.CharField(max_length=255, blank=True)
    rejection_notes = models.TextField(blank=True)
    dispatched_at = models.DateTimeField(auto_now_add=True)
    responded_at = models.DateTimeField(null=True, blank=True)

    # SMS notification tracking
    sms_status = models.CharField(
        max_length=20,
        choices=SmsStatus.choices,
        default=SmsStatus.PENDING,
        db_index=True,
    )
    sms_provider = models.CharField(max_length=50, blank=True)
    sms_provider_message_id = models.CharField(max_length=100, blank=True)
    sms_error = models.TextField(blank=True)
    sms_attempts = models.PositiveIntegerField(default=0)
    sms_last_attempt_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-dispatched_at"]
        indexes = [
            models.Index(fields=["shipment", "status"]),
            models.Index(fields=["driver", "status"]),
        ]

    def __str__(self):
        return f"Dispatch {self.pk}: {self.shipment.reference} -> {self.driver.full_name} ({self.status})"
