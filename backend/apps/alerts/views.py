from django.utils import timezone
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.audit import log_event
from apps.accounts.permissions import RolePermission

from . import services
from .models import Alert
from .serializers import AlertSerializer


class AlertViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    queryset = Alert.objects.select_related("vehicle", "shipment")
    serializer_class = AlertSerializer
    permission_classes = [RolePermission]
    write_roles = ("admin", "fleet_manager", "coordinator")

    def get_permissions(self):
        if self.action == "refresh":
            return [IsAuthenticated()]
        return super().get_permissions()

    def get_queryset(self):
        queryset = super().get_queryset()
        for field in ("status", "severity", "category"):
            value = self.request.query_params.get(field)
            if value:
                queryset = queryset.filter(**{field: value})
        return queryset

    @action(detail=False, methods=["post"])
    def refresh(self, request):
        return Response({"open": services.refresh_alerts()})

    @action(detail=True, methods=["post"])
    def acknowledge(self, request, pk=None):
        alert = self.get_object()
        if alert.status != Alert.Status.OPEN:
            raise ValidationError("Only open alerts can be acknowledged.")
        alert.status = Alert.Status.ACKNOWLEDGED
        alert.save(update_fields=["status"])
        log_event(request.user, "alert", alert.id, "Alert acknowledged")
        return Response(self.get_serializer(alert).data)

    @action(detail=True, methods=["post"])
    def resolve(self, request, pk=None):
        alert = self.get_object()
        if alert.status == Alert.Status.RESOLVED:
            raise ValidationError("This alert is already resolved.")
        alert.status = Alert.Status.RESOLVED
        alert.resolution = "manual"
        alert.resolved_at = timezone.now()
        alert.save(update_fields=["status", "resolution", "resolved_at"])
        log_event(request.user, "alert", alert.id, "Alert resolved")
        return Response(self.get_serializer(alert).data)
