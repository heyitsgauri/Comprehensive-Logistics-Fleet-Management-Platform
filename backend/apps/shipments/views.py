from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import filters, viewsets, status as http_status
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import ValidationError, PermissionDenied
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from apps.accounts.audit import log_event
from apps.accounts.permissions import RolePermission, get_role
from apps.fleet.models import Driver

from . import dispatch_service
from .models import Customer, DispatchRequest, Shipment, Warehouse
from .notifications import NotificationService
from .serializers import (
    OPEN_STATUSES,
    CustomerSerializer,
    DispatchRequestSerializer,
    ShipmentSerializer,
    WarehouseSerializer,
)

WRITE_ROLES = ("admin", "fleet_manager", "coordinator")


class CustomerViewSet(viewsets.ModelViewSet):
    queryset = Customer.objects.all()
    serializer_class = CustomerSerializer
    permission_classes = [RolePermission]
    write_roles = WRITE_ROLES
    http_method_names = ["get", "post", "put", "patch", "head", "options"]
    filter_backends = [filters.SearchFilter]
    search_fields = ["name", "contact_name", "phone"]


class WarehouseViewSet(viewsets.ModelViewSet):
    queryset = Warehouse.objects.all()
    serializer_class = WarehouseSerializer
    permission_classes = [RolePermission]
    write_roles = WRITE_ROLES
    http_method_names = ["get", "post", "put", "patch", "head", "options"]
    filter_backends = [filters.SearchFilter]
    search_fields = ["name", "address"]


class ShipmentViewSet(viewsets.ModelViewSet):
    queryset = (
        Shipment.objects.select_related("customer")
        .prefetch_related("dispatch_requests__vehicle", "dispatch_requests__driver")
    )
    serializer_class = ShipmentSerializer
    permission_classes = [RolePermission]
    write_roles = WRITE_ROLES
    http_method_names = ["get", "post", "put", "patch", "head", "options"]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["reference", "customer__name", "pickup_address", "delivery_address"]
    ordering_fields = ["created_at", "deadline", "status", "weight_kg", "started_at"]

    def perform_create(self, serializer):
        shipment = serializer.save()
        log_event(
            self.request.user,
            "shipment",
            shipment.id,
            "Shipment created (pending assignment)",
        )

    def get_queryset(self):
        qs = super().get_queryset()
        params = getattr(self.request, "query_params", getattr(self.request, "GET", {}))
        status_param = params.get("status")
        if status_param:
            qs = qs.filter(status=status_param)
        if params.get("late") == "true":
            qs = qs.filter(
                status__in=OPEN_STATUSES,
                deadline__lt=timezone.now(),
            )
        return qs

    def perform_update(self, serializer):
        if serializer.instance.status not in (
            Shipment.Status.DRAFT,
            Shipment.Status.PENDING,
            Shipment.Status.REJECTED,
        ):
            raise ValidationError(
                "Only pending or rejected shipments can be edited."
            )
        shipment = serializer.save()
        log_event(
            self.request.user,
            "shipment",
            shipment.id,
            "Shipment details edited",
        )

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        shipment = self.get_object()
        if shipment.status not in (
            Shipment.Status.DRAFT,
            Shipment.Status.PENDING,
            Shipment.Status.AWAITING_DRIVER_ACCEPTANCE,
            Shipment.Status.ACCEPTED,
            Shipment.Status.REJECTED,
        ):
            raise ValidationError(
                "Only shipments that have not yet started trip can be cancelled."
            )

        # Cancel any active dispatch
        active_dispatches = shipment.dispatch_requests.filter(
            status__in=[DispatchRequest.Status.PENDING, DispatchRequest.Status.ACCEPTED]
        )
        for d in active_dispatches:
            d.status = DispatchRequest.Status.CANCELLED
            d.save(update_fields=["status"])
            d.vehicle.status = "available"
            d.vehicle.save(update_fields=["status"])
            d.driver.status = "available"
            d.driver.save(update_fields=["status"])

        shipment.status = Shipment.Status.CANCELLED
        shipment.save(update_fields=["status", "updated_at"])
        log_event(request.user, "shipment", shipment.id, "Shipment cancelled")
        return Response(self.get_serializer(shipment).data)

    @action(detail=True, methods=["post"], url_path="dispatch")
    def dispatch_shipment(self, request, pk=None):
        """
        Start Shipment / Dispatch action:
        Validates vehicle capacity, maintenance, driver license and availability,
        persists DispatchRequest, sends SMS notification, and raises manager alert.
        """
        shipment = self.get_object()
        vehicle_id = request.data.get("vehicle_id")
        driver_id = request.data.get("driver_id")
        retry_sms = bool(request.data.get("retry_sms", False))

        if not vehicle_id or not driver_id:
            raise ValidationError({"detail": "Both vehicle_id and driver_id are required for dispatch."})

        try:
            vehicle_id = int(vehicle_id)
            driver_id = int(driver_id)
        except (ValueError, TypeError):
            raise ValidationError({"detail": "vehicle_id and driver_id must be valid numbers."})

        dispatch_req, is_new = dispatch_service.dispatch_shipment(
            shipment_id=shipment.id,
            vehicle_id=vehicle_id,
            driver_id=driver_id,
            user=request.user,
            retry_sms=retry_sms,
        )

        shipment.refresh_from_db()
        response_data = self.get_serializer(shipment).data
        response_data["dispatch"] = DispatchRequestSerializer(dispatch_req).data
        response_data["newly_dispatched"] = is_new
        return Response(response_data, status=http_status.HTTP_200_OK)

    @action(detail=True, methods=["post"])
    def start_trip(self, request, pk=None):
        """
        Start Trip action:
        Only allowed when shipment status is ACCEPTED.
        Creates/activates Trip, sets In Transit, records start time, and activates Live Fleet tracking.
        """
        trip = dispatch_service.start_trip_from_dispatch(
            shipment_id=pk,
            user=request.user,
        )
        shipment = self.get_object()
        response_data = self.get_serializer(shipment).data
        response_data["trip_id"] = trip.id
        return Response(response_data, status=http_status.HTTP_200_OK)

    @action(detail=True, methods=["get"], url_path="route-details")
    def route_details(self, request, pk=None):
        """
        Calculates and provides comprehensive route data for the Check Route side panel.
        """
        shipment = self.get_object()
        from apps.trips.models import Trip
        from apps.trips.routing import get_route, RouteError
        from apps.trips.views import SIM_SPEEDUP
        from datetime import timedelta

        trip = Trip.objects.filter(shipment=shipment).select_related("vehicle", "driver").first()
        now = timezone.now()

        try:
            route = get_route(
                shipment.pickup_lat,
                shipment.pickup_lng,
                shipment.delivery_lat,
                shipment.delivery_lng,
            )
        except RouteError as exc:
            return Response({"detail": f"Route calculation failed: {exc}"}, status=502)

        coords = route.get("geometry", [])
        total_dist = route.get("distance_km", 0.0)
        duration = (trip.planned_duration_min if trip else None) or route.get("duration_min", 120)

        if trip and trip.status == Trip.Status.IN_TRANSIT and trip.started_at:
            elapsed = (now - trip.started_at).total_seconds() / 60 * SIM_SPEEDUP
            progress = min(max(elapsed / duration, 0.0), 1.0)
        elif shipment.status == Shipment.Status.DELIVERED or (trip and trip.status == Trip.Status.COMPLETED):
            progress = 1.0
        else:
            progress = 0.0

        if coords:
            idx = min(int(progress * (len(coords) - 1)), len(coords) - 1)
            current_loc = [coords[idx][1], coords[idx][0]]
            covered_path = [[c[1], c[0]] for c in coords[: idx + 1]]
            remaining_path = [[c[1], c[0]] for c in coords[idx:]]
            full_path = [[c[1], c[0]] for c in coords]
        else:
            current_loc = [shipment.pickup_lat, shipment.pickup_lng]
            covered_path = []
            remaining_path = []
            full_path = []

        distance_covered = round(total_dist * progress, 1)
        distance_remaining = max(0.0, round(total_dist - distance_covered, 1))
        remaining_minutes = max(0, round(duration * (1 - progress)))
        eta = now + timedelta(minutes=remaining_minutes)

        return Response(
            {
                "shipment_id": shipment.id,
                "trip_id": trip.id if trip else None,
                "status": trip.status if trip else shipment.status,
                "started_at": trip.started_at if trip else shipment.started_at,
                "completed_at": trip.completed_at if trip else None,
                "last_update": now,
                "simulated": True,
                "progress_ratio": round(progress, 3),
                "progress_percent": round(progress * 100, 1),
                "total_distance_km": total_dist,
                "distance_covered_km": distance_covered,
                "distance_remaining_km": distance_remaining,
                "planned_duration_min": duration,
                "estimated_arrival": eta,
                "shipment": {
                    "id": shipment.id,
                    "reference": shipment.reference,
                    "customer_name": shipment.customer.name,
                    "cargo_description": shipment.cargo_description,
                    "weight_kg": str(shipment.weight_kg),
                    "deadline": shipment.deadline,
                    "pickup_address": shipment.pickup_address,
                    "delivery_address": shipment.delivery_address,
                    "pickup_coords": [shipment.pickup_lat, shipment.pickup_lng],
                    "delivery_coords": [shipment.delivery_lat, shipment.delivery_lng],
                },
                "vehicle": {
                    "id": trip.vehicle.id if trip else (shipment.dispatch_requests.first().vehicle_id if shipment.dispatch_requests.exists() else None),
                    "registration_number": trip.vehicle.registration_number if trip else (shipment.dispatch_requests.first().vehicle.registration_number if shipment.dispatch_requests.exists() else "—"),
                    "vehicle_type": trip.vehicle.vehicle_type if trip else "",
                    "make": trip.vehicle.make if trip else "",
                    "model": trip.vehicle.model if trip else "",
                },
                "driver": {
                    "id": trip.driver.id if trip else (shipment.dispatch_requests.first().driver_id if shipment.dispatch_requests.exists() else None),
                    "full_name": trip.driver.full_name if trip else (shipment.dispatch_requests.first().driver.full_name if shipment.dispatch_requests.exists() else "—"),
                    "phone": trip.driver.phone if trip else (shipment.dispatch_requests.first().driver.phone if shipment.dispatch_requests.exists() else "—"),
                },
                "current_location": current_loc,
                "full_route": full_path,
                "covered_route": covered_path,
                "remaining_route": remaining_path,
            }
        )


class DispatchRequestViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Endpoints for Driver dashboard & Dispatch tracking.
    """
    queryset = (
        DispatchRequest.objects.select_related("shipment", "shipment__customer", "vehicle", "driver", "dispatched_by")
    )
    serializer_class = DispatchRequestSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        role = get_role(user)

        # If logged in as driver, only show assignments linked to this driver
        if role == "driver":
            driver = Driver.objects.filter(user=user).first()
            if not driver:
                # Also fallback to full_name or phone match
                driver = Driver.objects.filter(phone=user.username).first()
            if driver:
                qs = qs.filter(driver=driver)
            else:
                return qs.none()

        # Completed shipments remain in history but are no longer active assignments.
        qs = qs.exclude(shipment__status=Shipment.Status.DELIVERED)

        # Manager/Coordinator/Admin can filter by status or shipment
        params = getattr(self.request, "query_params", getattr(self.request, "GET", {}))
        status_param = params.get("status")
        if status_param:
            qs = qs.filter(status=status_param)
        shipment_id = params.get("shipment")
        if shipment_id and shipment_id.isdigit():
            qs = qs.filter(shipment_id=int(shipment_id))
        return qs

    @action(detail=True, methods=["post"])
    def accept(self, request, pk=None):
        """Driver accepts an assignment."""
        dispatch = dispatch_service.driver_accept_dispatch(
            dispatch_id=pk,
            user=request.user,
        )
        return Response(self.get_serializer(dispatch).data)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        """Driver rejects an assignment with reason."""
        reason = request.data.get("reason", "")
        notes = request.data.get("notes", "")
        dispatch = dispatch_service.driver_reject_dispatch(
            dispatch_id=pk,
            user=request.user,
            reason=reason,
            notes=notes,
        )
        return Response(self.get_serializer(dispatch).data)

    @action(detail=True, methods=["post"])
    def retry_sms(self, request, pk=None):
        """Retry sending the driver SMS."""
        dispatch = self.get_object()
        sms_ok, sms_meta = NotificationService.send_dispatch_sms(dispatch_request=dispatch)
        dispatch.sms_attempts += 1
        dispatch.sms_last_attempt_at = timezone.now()
        dispatch.sms_provider = sms_meta.get("provider", "")
        dispatch.sms_provider_message_id = sms_meta.get("provider_message_id", "")
        if sms_ok:
            dispatch.sms_status = DispatchRequest.SmsStatus.SENT
            dispatch.sms_error = ""
        else:
            dispatch.sms_status = DispatchRequest.SmsStatus.FAILED
            dispatch.sms_error = sms_meta.get("error", "SMS delivery failed.")
        dispatch.save(
            update_fields=[
                "sms_attempts",
                "sms_last_attempt_at",
                "sms_provider",
                "sms_provider_message_id",
                "sms_status",
                "sms_error",
            ]
        )
        return Response(self.get_serializer(dispatch).data)


@api_view(["GET", "POST"])
@permission_classes([AllowAny])
def driver_token_portal(request):
    """
    Secure single-use / token-based driver portal view.
    Permits driver to view, accept, or reject via their unique SMS link.
    """
    token = request.query_params.get("token") or request.data.get("token")
    if not token:
        return Response({"detail": "Token is required."}, status=400)

    dispatch = get_object_or_404(
        DispatchRequest.objects.select_related("shipment", "shipment__customer", "vehicle", "driver"),
        token=token,
    )

    if request.method == "GET":
        return Response(DispatchRequestSerializer(dispatch).data)

    action_type = request.data.get("action")
    if action_type == "accept":
        updated = dispatch_service.driver_accept_dispatch(token=token, user=request.user)
        return Response(DispatchRequestSerializer(updated).data)
    elif action_type == "reject":
        reason = request.data.get("reason", "")
        notes = request.data.get("notes", "")
        updated = dispatch_service.driver_reject_dispatch(
            token=token,
            user=request.user,
            reason=reason,
            notes=notes,
        )
        return Response(DispatchRequestSerializer(updated).data)
    else:
        return Response({"detail": "Invalid action. Specify 'accept' or 'reject'."}, status=400)
