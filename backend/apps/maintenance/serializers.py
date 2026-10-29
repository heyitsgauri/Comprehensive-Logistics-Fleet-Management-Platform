from rest_framework import serializers

from apps.fleet.models import Vehicle

from .models import MaintenanceRecord


class MaintenanceSerializer(serializers.ModelSerializer):
    vehicle_reg = serializers.CharField(
        source="vehicle.registration_number",
        read_only=True,
    )

    class Meta:
        model = MaintenanceRecord
        fields = "__all__"
        read_only_fields = [
            "status",
            "completed_date",
            "cost",
            "created_at",
        ]

    def validate(self, attrs):
        if self.instance and self.instance.status != MaintenanceRecord.Status.SCHEDULED:
            raise serializers.ValidationError(
                "Only scheduled maintenance can be edited."
            )
        return attrs

    def validate_estimated_cost(self, value):
        if value < 0:
            raise serializers.ValidationError(
                "Estimated cost cannot be negative."
            )
        return value

    def validate_vehicle(self, value):
        if value.status == Vehicle.Status.INACTIVE:
            raise serializers.ValidationError("This vehicle is inactive.")
        return value
