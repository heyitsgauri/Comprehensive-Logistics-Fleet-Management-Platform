from django.utils import timezone
from rest_framework import serializers

from .models import Driver, Vehicle

SYSTEM_MANAGED = {Vehicle.Status.ASSIGNED, Vehicle.Status.IN_TRANSIT}


class VehicleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Vehicle
        fields = "__all__"
        read_only_fields = ["current_lat", "current_lng", "created_at"]

    def validate_registration_number(self, value):
        value = "".join(value.split()).upper()
        qs = Vehicle.objects.filter(registration_number=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError(
                "A vehicle with this registration number already exists."
            )
        return value

    def validate_capacity_kg(self, value):
        if value <= 0:
            raise serializers.ValidationError("Capacity must be greater than zero.")
        return value

    def validate(self, attrs):
        new = attrs.get("status")
        if new is None:
            return attrs
        old = self.instance.status if self.instance else None
        if new != old and (new in SYSTEM_MANAGED or old in SYSTEM_MANAGED):
            raise serializers.ValidationError(
                {
                    "status": (
                        "Assigned and In Transit are set automatically by trips "
                        "and cannot be changed by hand."
                    )
                }
            )
        return attrs


class DriverSerializer(serializers.ModelSerializer):
    license_valid = serializers.SerializerMethodField()

    class Meta:
        model = Driver
        fields = "__all__"
        read_only_fields = ["created_at"]

    def get_license_valid(self, obj):
        return obj.license_expiry >= timezone.localdate()

    def validate_license_number(self, value):
        value = "".join(value.split()).upper()
        qs = Driver.objects.filter(license_number=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError(
                "A driver with this license number already exists."
            )
        return value

    def validate(self, attrs):
        new = attrs.get("status")
        old = self.instance.status if self.instance else None
        system = {Driver.Status.ASSIGNED, Driver.Status.ON_TRIP}
        if new is not None and new != old and (new in system or old in system):
            raise serializers.ValidationError(
                {
                    "status": (
                        "Assigned and On Trip are set automatically by trips "
                        "and cannot be changed by hand."
                    )
                }
            )
        return attrs
