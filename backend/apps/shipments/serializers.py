from django.utils import timezone
from rest_framework import serializers

from .models import Customer, DispatchRequest, Shipment, Warehouse

OPEN_STATUSES = (
    Shipment.Status.PENDING,
    Shipment.Status.ASSIGNED,
    Shipment.Status.AWAITING_DRIVER_ACCEPTANCE,
    Shipment.Status.ACCEPTED,
    Shipment.Status.IN_TRANSIT,
    Shipment.Status.DELAYED,
)


class CustomerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Customer
        fields = "__all__"
        read_only_fields = ["created_at"]


class WarehouseSerializer(serializers.ModelSerializer):
    class Meta:
        model = Warehouse
        fields = "__all__"


class DispatchRequestSerializer(serializers.ModelSerializer):
    shipment_ref = serializers.CharField(source="shipment.reference", read_only=True)
    customer_name = serializers.CharField(source="shipment.customer.name", read_only=True)
    pickup_address = serializers.CharField(source="shipment.pickup_address", read_only=True)
    delivery_address = serializers.CharField(source="shipment.delivery_address", read_only=True)
    cargo_description = serializers.CharField(source="shipment.cargo_description", read_only=True)
    weight_kg = serializers.DecimalField(source="shipment.weight_kg", max_digits=10, decimal_places=2, read_only=True)
    deadline = serializers.DateTimeField(source="shipment.deadline", read_only=True)
    shipment_status = serializers.CharField(source="shipment.status", read_only=True)
    shipment_started_at = serializers.DateTimeField(
        source="shipment.started_at",
        read_only=True,
    )
    vehicle_reg = serializers.CharField(source="vehicle.registration_number", read_only=True)
    vehicle_capacity = serializers.DecimalField(source="vehicle.capacity_kg", max_digits=10, decimal_places=2, read_only=True)
    driver_name = serializers.CharField(source="driver.full_name", read_only=True)
    driver_phone = serializers.CharField(source="driver.phone", read_only=True)
    dispatched_by_name = serializers.SerializerMethodField()

    class Meta:
        model = DispatchRequest
        fields = "__all__"
        read_only_fields = [
            "token",
            "dispatched_at",
            "responded_at",
            "sms_status",
            "sms_provider",
            "sms_provider_message_id",
            "sms_error",
            "sms_attempts",
            "sms_last_attempt_at",
        ]

    def get_dispatched_by_name(self, obj):
        if not obj.dispatched_by:
            return None
        return obj.dispatched_by.get_full_name() or obj.dispatched_by.username


class ShipmentSerializer(serializers.ModelSerializer):
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    is_late = serializers.SerializerMethodField()
    shipment_started_status = serializers.SerializerMethodField()
    departure_punctuality = serializers.SerializerMethodField()
    active_dispatch = serializers.SerializerMethodField()

    class Meta:
        model = Shipment
        fields = "__all__"
        read_only_fields = [
            "reference",
            "status",
            "started_at",
            "created_at",
            "updated_at",
        ]

    def get_is_late(self, obj):
        return obj.status in OPEN_STATUSES and obj.deadline < timezone.now()

    def get_shipment_started_status(self, obj):
        if obj.status == Shipment.Status.DELIVERED:
            return "Delivered"
        if obj.started_at or obj.status == Shipment.Status.IN_TRANSIT:
            return "Started"
        return "Not Started"

    def get_departure_punctuality(self, obj):
        """
        Derives punctuality from persistent departure comparison:
        Compares started_at with scheduled_departure.
        """
        if not obj.started_at:
            return None
        if not obj.scheduled_departure:
            return "Started"
        if obj.started_at <= obj.scheduled_departure:
            return "On Time"
        return "Late"

    def get_active_dispatch(self, obj):
        latest = obj.dispatch_requests.first()
        if not latest:
            return None
        return {
            "id": latest.id,
            "status": latest.status,
            "vehicle_id": latest.vehicle_id,
            "vehicle_reg": latest.vehicle.registration_number,
            "driver_id": latest.driver_id,
            "driver_name": latest.driver.full_name,
            "driver_phone": latest.driver.phone,
            "sms_status": latest.sms_status,
            "sms_provider": latest.sms_provider,
            "sms_error": latest.sms_error,
            "token": str(latest.token),
            "dispatched_at": latest.dispatched_at,
            "responded_at": latest.responded_at,
            "rejection_reason": latest.rejection_reason,
        }

    def validate_weight_kg(self, value):
        if value <= 0:
            raise serializers.ValidationError("Weight must be greater than zero.")
        return value

    def validate_deadline(self, value):
        if self.instance is None and value <= timezone.now():
            raise serializers.ValidationError("Deadline must be in the future.")
        return value
