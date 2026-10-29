from decimal import Decimal

from rest_framework import serializers

from .models import Expense


class ExpenseSerializer(serializers.ModelSerializer):
    vehicle_reg = serializers.CharField(
        source="vehicle.registration_number",
        read_only=True,
    )
    shipment_ref = serializers.SerializerMethodField()
    maintenance_description = serializers.CharField(
        source="maintenance_record.description",
        read_only=True,
        default=None,
    )

    class Meta:
        model = Expense
        fields = "__all__"
        read_only_fields = ["created_at"]
        extra_kwargs = {"amount": {"required": False}}

    def get_shipment_ref(self, obj):
        return obj.trip.shipment.reference if obj.trip_id else None

    def validate(self, attrs):
        category = attrs.get(
            "category",
            self.instance.category if self.instance else None,
        )
        if category == Expense.Category.FUEL:
            litres = attrs.get("litres", getattr(self.instance, "litres", None))
            price = attrs.get("unit_price", getattr(self.instance, "unit_price", None))
            if litres is None or litres <= 0:
                raise serializers.ValidationError(
                    {"litres": "Enter the fuel quantity in litres."}
                )
            if price is None or price <= 0:
                raise serializers.ValidationError(
                    {"unit_price": "Enter the price per litre."}
                )
            attrs["amount"] = (litres * price).quantize(Decimal("0.01"))
        else:
            amount = attrs.get("amount")
            if amount is None or amount <= 0:
                raise serializers.ValidationError(
                    {"amount": "Enter an amount greater than zero."}
                )
        trip = attrs.get("trip")
        vehicle = attrs.get("vehicle", getattr(self.instance, "vehicle", None))
        if trip and vehicle and trip.vehicle_id != vehicle.id:
            raise serializers.ValidationError(
                {"trip": "That trip was driven by a different vehicle."}
            )
        return attrs
