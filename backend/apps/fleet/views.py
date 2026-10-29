from rest_framework import filters, viewsets

from apps.accounts.permissions import RolePermission

from .models import Driver, Vehicle
from .serializers import DriverSerializer, VehicleSerializer

WRITE_ROLES = ("admin", "fleet_manager")


class StatusFilterMixin:
    def get_queryset(self):
        qs = super().get_queryset()
        status = self.request.query_params.get("status")
        return qs.filter(status=status) if status else qs


class VehicleViewSet(StatusFilterMixin, viewsets.ModelViewSet):
    queryset = Vehicle.objects.all()
    serializer_class = VehicleSerializer
    permission_classes = [RolePermission]
    write_roles = WRITE_ROLES
    http_method_names = ["get", "post", "put", "patch", "head", "options"]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["registration_number", "make", "model"]
    ordering_fields = ["registration_number", "status", "odometer_km", "created_at"]


class DriverViewSet(StatusFilterMixin, viewsets.ModelViewSet):
    queryset = Driver.objects.all()
    serializer_class = DriverSerializer
    permission_classes = [RolePermission]
    write_roles = WRITE_ROLES
    http_method_names = ["get", "post", "put", "patch", "head", "options"]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["full_name", "license_number", "phone"]
    ordering_fields = ["full_name", "status", "license_expiry", "created_at"]
