from rest_framework import serializers

from .models import Trip


class TripSerializer(serializers.ModelSerializer):
    shipment_ref = serializers.CharField(source="shipment.reference", read_only=True)
    vehicle_reg = serializers.CharField(
        source="vehicle.registration_number",
        read_only=True,
    )
    driver_name = serializers.CharField(source="driver.full_name", read_only=True)

    class Meta:
        model = Trip
        fields = [
            "id",
            "shipment",
            "shipment_ref",
            "vehicle",
            "vehicle_reg",
            "driver",
            "driver_name",
            "status",
            "distance_km",
            "planned_duration_min",
            "started_at",
            "estimated_arrival",
            "completed_at",
            "created_at",
        ]
        read_only_fields = fields


class TripCreateSerializer(serializers.Serializer):
    shipment_id = serializers.IntegerField()
    vehicle_id = serializers.IntegerField()
    driver_id = serializers.IntegerField()
