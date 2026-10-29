from rest_framework import serializers

from .models import Alert


class AlertSerializer(serializers.ModelSerializer):
    vehicle_reg = serializers.SerializerMethodField()
    shipment_ref = serializers.SerializerMethodField()

    class Meta:
        model = Alert
        fields = [
            "id",
            "category",
            "severity",
            "message",
            "vehicle",
            "shipment",
            "vehicle_reg",
            "shipment_ref",
            "status",
            "resolution",
            "created_at",
            "resolved_at",
        ]

    def get_vehicle_reg(self, obj):
        return obj.vehicle.registration_number if obj.vehicle_id else None

    def get_shipment_ref(self, obj):
        return obj.shipment.reference if obj.shipment_id else None
