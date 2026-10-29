from datetime import timedelta
from decimal import Decimal, InvalidOperation
from types import SimpleNamespace

from django.db.models import Count
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import mixins, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.audit import log_event
from apps.accounts.permissions import RolePermission
from apps.fleet.models import Driver, Vehicle
from apps.shipments.models import Shipment

from . import services
from .models import Trip
from .routing import RouteError, geocode, get_route
from .serializers import TripCreateSerializer, TripSerializer

SIM_SPEEDUP = 60


class TripViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    queryset = Trip.objects.select_related("shipment", "vehicle", "driver")
    serializer_class = TripSerializer
    permission_classes = [RolePermission]
    write_roles = ("admin", "fleet_manager", "coordinator")

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if params.get("status"):
            qs = qs.filter(status=params["status"])
        if params.get("shipment", "").isdigit():
            qs = qs.filter(shipment_id=params["shipment"])
        return qs

    def create(self, request):
        data = TripCreateSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        trip = services.create_trip(user=request.user, **data.validated_data)
        log_event(
            request.user,
            "shipment",
            trip.shipment_id,
            f"Assigned vehicle {trip.vehicle.registration_number} and "
            f"driver {trip.driver.full_name} (trip #{trip.id})",
        )
        return Response(TripSerializer(trip).data, status=201)

    @action(detail=True, methods=["post"])
    def start(self, request, pk=None):
        trip = services.start_trip(pk)
        log_event(
            request.user,
            "shipment",
            trip.shipment_id,
            f"Trip #{trip.id} started. Shipment in transit",
        )
        return Response(TripSerializer(trip).data)

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        trip = services.complete_trip(pk)
        log_event(
            request.user,
            "shipment",
            trip.shipment_id,
            f"Trip #{trip.id} completed. Shipment delivered",
        )
        return Response(TripSerializer(trip).data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        trip = services.cancel_trip(pk)
        log_event(
            request.user,
            "shipment",
            trip.shipment_id,
            f"Trip #{trip.id} cancelled. Shipment back to pending",
        )
        return Response(TripSerializer(trip).data)

    @action(detail=True, methods=["get"], url_path="route-details")
    def route_details(self, request, pk=None):
        trip = self.get_object()
        shipment = trip.shipment
        now = timezone.now()

        try:
            route = get_route(
                shipment.pickup_lat,
                shipment.pickup_lng,
                shipment.delivery_lat,
                shipment.delivery_lng,
            )
        except RouteError as exc:
            return Response({"detail": f"Could not calculate route: {exc}"}, status=502)

        coords = route.get("geometry", [])
        total_dist = route.get("distance_km", 0.0)
        duration = trip.planned_duration_min or route.get("duration_min", 120)

        if trip.status == Trip.Status.IN_TRANSIT and trip.started_at:
            elapsed = (now - trip.started_at).total_seconds() / 60 * SIM_SPEEDUP
            progress = min(max(elapsed / duration, 0.0), 1.0)
        elif trip.status == Trip.Status.COMPLETED:
            progress = 1.0
        else:
            progress = 0.0

        if coords:
            idx = min(int(progress * (len(coords) - 1)), len(coords) - 1)
            current_loc = [coords[idx][1], coords[idx][0]]  # [lat, lng]
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
                "trip_id": trip.id,
                "status": trip.status,
                "started_at": trip.started_at,
                "completed_at": trip.completed_at,
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
                    "id": trip.vehicle.id,
                    "registration_number": trip.vehicle.registration_number,
                    "vehicle_type": trip.vehicle.vehicle_type,
                    "make": trip.vehicle.make,
                    "model": trip.vehicle.model,
                },
                "driver": {
                    "id": trip.driver.id,
                    "full_name": trip.driver.full_name,
                    "phone": trip.driver.phone,
                },
                "current_location": current_loc,
                "full_route": full_path,
                "covered_route": covered_path,
                "remaining_route": remaining_path,
            }
        )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def route_preview(request):
    """Calculate a route without creating a trip or changing any status."""
    try:
        values = [
            float(request.query_params[key])
            for key in ("from_lat", "from_lng", "to_lat", "to_lng")
        ]
    except (KeyError, ValueError):
        return Response(
            {"detail": "from_lat, from_lng, to_lat and to_lng are required numbers."},
            status=400,
        )
    from_lat, from_lng, to_lat, to_lng = values
    if (
        not -90 <= from_lat <= 90
        or not -90 <= to_lat <= 90
        or not -180 <= from_lng <= 180
        or not -180 <= to_lng <= 180
    ):
        raise ValidationError({"detail": "Coordinates are outside valid latitude/longitude ranges."})
    try:
        route = get_route(*values)
    except RouteError as exc:
        return Response({"detail": str(exc)}, status=502)
    route["eta"] = timezone.now() + timedelta(minutes=route["duration_min"])
    return Response(route)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def geocode_view(request):
    query = request.query_params.get("q", "").strip()
    if len(query) < 3:
        return Response(
            {"detail": "Enter at least 3 characters to search."},
            status=400,
        )
    try:
        return Response(geocode(query))
    except RouteError as exc:
        return Response({"detail": str(exc)}, status=502)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def assignment_options(request):
    try:
        weight = Decimal(request.query_params.get("weight_kg", "0"))
    except InvalidOperation:
        return Response({"detail": "weight_kg must be a number."}, status=400)
    if not weight.is_finite() or weight <= 0:
        return Response(
            {"detail": "weight_kg must be greater than zero."},
            status=400,
        )

    probe = SimpleNamespace(weight_kg=weight)
    vehicles = [
        {
            "id": vehicle.id,
            "registration_number": vehicle.registration_number,
            "capacity_kg": str(vehicle.capacity_kg),
            "issues": services.vehicle_issues(vehicle, probe),
        }
        for vehicle in Vehicle.objects.exclude(
            status=Vehicle.Status.INACTIVE
        ).order_by("capacity_kg")
    ]
    drivers = [
        {
            "id": driver.id,
            "full_name": driver.full_name,
            "issues": services.driver_issues(driver),
        }
        for driver in Driver.objects.exclude(status=Driver.Status.INACTIVE)
    ]
    for item in vehicles + drivers:
        item["eligible"] = not item["issues"]
        item["recommended"] = False
    for group in (vehicles, drivers):
        recommended = next((item for item in group if item["eligible"]), None)
        if recommended:
            recommended["recommended"] = True
    return Response({"vehicles": vehicles, "drivers": drivers})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def eligible(request, pk):
    shipment = get_object_or_404(Shipment, pk=pk)
    active_trips = (
        Trip.objects.filter(
            status__in=[Trip.Status.PLANNED, Trip.Status.IN_TRANSIT]
        )
        .select_related("shipment")
        .order_by("-created_at")
    )
    active_by_vehicle = {}
    active_by_driver = {}
    for trip in active_trips:
        active_by_vehicle.setdefault(trip.vehicle_id, trip)
        active_by_driver.setdefault(trip.driver_id, trip)

    vehicles = [
        {
            "id": vehicle.id,
            "registration_number": vehicle.registration_number,
            "vehicle_type": vehicle.vehicle_type,
            "make": vehicle.make,
            "model": vehicle.model,
            "capacity_kg": vehicle.capacity_kg,
            "fuel_type": vehicle.fuel_type,
            "status": vehicle.status,
            "active_trip": (
                {
                    "id": active_by_vehicle[vehicle.id].id,
                    "shipment_ref": active_by_vehicle[vehicle.id].shipment.reference,
                    "status": active_by_vehicle[vehicle.id].status,
                }
                if vehicle.id in active_by_vehicle
                else None
            ),
            "issues": services.vehicle_issues(vehicle, shipment),
        }
        for vehicle in Vehicle.objects.exclude(status=Vehicle.Status.INACTIVE)
    ]
    drivers = [
        {
            "id": driver.id,
            "full_name": driver.full_name,
            "status": driver.status,
            "license_expiry": driver.license_expiry,
            "license_valid": driver.license_expiry >= timezone.localdate(),
            "active_trip": (
                {
                    "id": active_by_driver[driver.id].id,
                    "shipment_ref": active_by_driver[driver.id].shipment.reference,
                    "status": active_by_driver[driver.id].status,
                }
                if driver.id in active_by_driver
                else None
            ),
            "issues": services.driver_issues(driver),
        }
        for driver in Driver.objects.exclude(status=Driver.Status.INACTIVE)
    ]
    for item in vehicles + drivers:
        item["eligible"] = not item["issues"]
    return Response({"vehicles": vehicles, "drivers": drivers})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def live_fleet(request):
    """Return simulated straight-line positions for vehicles that are in transit."""
    now = timezone.now()
    active = {
        trip.vehicle_id: trip
        for trip in Trip.objects.filter(status=Trip.Status.IN_TRANSIT).select_related(
            "shipment",
            "driver",
        )
    }
    result = []
    for vehicle in Vehicle.objects.exclude(status=Vehicle.Status.INACTIVE):
        lat, lng, progress = vehicle.current_lat, vehicle.current_lng, None
        trip = active.get(vehicle.id)
        if trip:
            shipment = trip.shipment
            duration = trip.planned_duration_min or 120
            elapsed = (
                (now - trip.started_at).total_seconds() / 60 * SIM_SPEEDUP
                if trip.started_at
                else 0
            )
            progress = min(elapsed / duration, 1.0)
            lat = shipment.pickup_lat + (
                shipment.delivery_lat - shipment.pickup_lat
            ) * progress
            lng = shipment.pickup_lng + (
                shipment.delivery_lng - shipment.pickup_lng
            ) * progress
            total_dist = trip.distance_km or 0.0
            dist_remaining = max(0.0, round(total_dist * (1 - progress), 1))
        else:
            total_dist = None
            dist_remaining = None

        result.append(
            {
                "id": vehicle.id,
                "registration_number": vehicle.registration_number,
                "status": vehicle.status,
                "lat": lat,
                "lng": lng,
                "simulated": True,
                "gps_mode": "Simulated GPS",
                "last_update": now,
                "is_actively_travelling": bool(trip),
                "trip_id": trip.id if trip else None,
                "shipment_id": trip.shipment_id if trip else None,
                "shipment_ref": trip.shipment.reference if trip else None,
                "driver_name": trip.driver.full_name if trip else None,
                "driver_phone": trip.driver.phone if trip else None,
                "estimated_arrival": trip.estimated_arrival if trip else None,
                "progress": round(progress, 3) if progress is not None else None,
                "progress_percent": round(progress * 100, 1) if progress is not None else None,
                "total_distance_km": total_dist,
                "remaining_distance_km": dist_remaining,
                "pickup_address": trip.shipment.pickup_address if trip else None,
                "delivery_address": trip.shipment.delivery_address if trip else None,
                "pickup": [
                    trip.shipment.pickup_lat,
                    trip.shipment.pickup_lng,
                ]
                if trip
                else None,
                "delivery": [
                    trip.shipment.delivery_lat,
                    trip.shipment.delivery_lng,
                ]
                if trip
                else None,
                "late": bool(trip and trip.shipment.deadline < now),
                "deadline": trip.shipment.deadline if trip else None,
            }
        )
    return Response(result)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def summary(request):
    now = timezone.now()
    shipment_counts = {status: 0 for status in Shipment.Status.values}
    for row in Shipment.objects.values("status").annotate(n=Count("id")):
        shipment_counts[row["status"]] = row["n"]
    vehicle_counts = {status: 0 for status in Vehicle.Status.values}
    for row in Vehicle.objects.values("status").annotate(n=Count("id")):
        vehicle_counts[row["status"]] = row["n"]

    completed = list(
        Trip.objects.filter(
            status=Trip.Status.COMPLETED,
            completed_at__isnull=False,
        ).select_related("shipment")
    )
    on_time = sum(
        1 for trip in completed if trip.completed_at <= trip.shipment.deadline
    )
    minutes = [
        (trip.completed_at - trip.started_at).total_seconds() / 60
        for trip in completed
        if trip.started_at
    ]
    delayed = Shipment.objects.filter(
        status__in=[
            Shipment.Status.PENDING,
            Shipment.Status.ASSIGNED,
            Shipment.Status.AWAITING_DRIVER_ACCEPTANCE,
            Shipment.Status.ACCEPTED,
            Shipment.Status.IN_TRANSIT,
            Shipment.Status.DELAYED,
        ],
        deadline__lt=now,
    ).count()

    return Response(
        {
            "total_shipments": sum(shipment_counts.values()),
            "shipments_today": Shipment.objects.filter(
                created_at__date=timezone.localdate()
            ).count(),
            "shipment_status_counts": shipment_counts,
            "vehicle_status_counts": vehicle_counts,
            "total_vehicles": sum(vehicle_counts.values()),
            "available_vehicles": vehicle_counts[Vehicle.Status.AVAILABLE],
            "active_trips": Trip.objects.filter(
                status=Trip.Status.IN_TRANSIT
            ).count(),
            "awaiting_acceptance": shipment_counts.get(
                Shipment.Status.AWAITING_DRIVER_ACCEPTANCE, 0
            ),
            "accepted_awaiting_start": shipment_counts.get(
                Shipment.Status.ACCEPTED, 0
            ),
            "rejected_assignments": shipment_counts.get(
                Shipment.Status.REJECTED, 0
            ),
            "delayed_deliveries": delayed,
            "on_time_rate": round(100 * on_time / len(completed), 1)
            if completed
            else None,
            "avg_delivery_minutes": round(sum(minutes) / len(minutes))
            if minutes
            else None,
        }
    )
