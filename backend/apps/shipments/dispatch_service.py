from datetime import timedelta
from typing import Optional
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import ValidationError, PermissionDenied

from apps.accounts.audit import log_event
from apps.alerts.models import Alert
from apps.fleet.models import Driver, Vehicle
from apps.trips import services as trip_services
from apps.trips.models import Trip
from apps.trips.routing import RouteError, get_route

from .models import DispatchRequest, Shipment
from .notifications import NotificationService



def validate_dispatch_eligibility(shipment, vehicle, driver):
    """
    Validates that vehicle and driver are fully eligible for this shipment.
    Raises ValidationError if any rule is violated.
    """
    if shipment.status not in (
        Shipment.Status.PENDING,
        Shipment.Status.ASSIGNED,
        Shipment.Status.REJECTED,
        Shipment.Status.AWAITING_DRIVER_ACCEPTANCE,
    ):
        raise ValidationError(
            {"shipment": f"Shipment status is '{shipment.get_status_display()}', cannot be dispatched."}
        )

    vehicle_issues = trip_services.vehicle_issues(vehicle, shipment)
    # Check if vehicle has conflicting active trip
    conflicting_trip = Trip.objects.filter(
        vehicle=vehicle,
        status__in=[Trip.Status.PLANNED, Trip.Status.IN_TRANSIT],
    ).exclude(shipment=shipment).first()
    if conflicting_trip:
        vehicle_issues.append(f"Vehicle is assigned to active trip #{conflicting_trip.id}.")
    if vehicle_issues:
        raise ValidationError({"vehicle": vehicle_issues})

    driver_issues = trip_services.driver_issues(driver)
    # Check if driver has conflicting active trip
    conflicting_driver_trip = Trip.objects.filter(
        driver=driver,
        status__in=[Trip.Status.PLANNED, Trip.Status.IN_TRANSIT],
    ).exclude(shipment=shipment).first()
    if conflicting_driver_trip:
        driver_issues.append(f"Driver is assigned to active trip #{conflicting_driver_trip.id}.")
    if driver_issues:
        raise ValidationError({"driver": driver_issues})


def dispatch_shipment(*, shipment_id: int, vehicle_id: int, driver_id: int, user, retry_sms: bool = False):
    """
    Dispatches a shipment to a driver and vehicle.
    Idempotent: Re-dispatching to the exact same pending assignment does not create duplicates.
    """
    with transaction.atomic():
        shipment = get_object_or_404(
            Shipment.objects.select_for_update(),
            pk=shipment_id,
        )
        vehicle = get_object_or_404(
            Vehicle.objects.select_for_update(),
            pk=vehicle_id,
        )
        driver = get_object_or_404(
            Driver.objects.select_for_update(),
            pk=driver_id,
        )

        # Check existing active dispatch for this shipment
        existing_dispatch = (
            DispatchRequest.objects.select_for_update()
            .filter(shipment=shipment, status=DispatchRequest.Status.PENDING)
            .order_by("-dispatched_at")
            .first()
        )

        if existing_dispatch and existing_dispatch.vehicle_id == vehicle.id and existing_dispatch.driver_id == driver.id:
            # Idempotent re-request to the exact same pending assignment
            dispatch = existing_dispatch
            if not retry_sms:
                return dispatch, False

        else:
            # If changing vehicle/driver from a previous dispatch, release previous resources
            if existing_dispatch:
                existing_dispatch.status = DispatchRequest.Status.SUPERSEDED
                existing_dispatch.save(update_fields=["status"])
                if existing_dispatch.driver_id != driver.id:
                    existing_dispatch.driver.status = Driver.Status.AVAILABLE
                    existing_dispatch.driver.save(update_fields=["status"])
                if existing_dispatch.vehicle_id != vehicle.id:
                    existing_dispatch.vehicle.status = Vehicle.Status.AVAILABLE
                    existing_dispatch.vehicle.save(update_fields=["status"])

            validate_dispatch_eligibility(shipment, vehicle, driver)

            dispatch = DispatchRequest.objects.create(
                shipment=shipment,
                vehicle=vehicle,
                driver=driver,
                dispatched_by=user,
                status=DispatchRequest.Status.PENDING,
            )

        # Update entities status
        shipment.status = Shipment.Status.AWAITING_DRIVER_ACCEPTANCE
        shipment.save(update_fields=["status", "updated_at"])

        vehicle.status = Vehicle.Status.ASSIGNED
        vehicle.save(update_fields=["status"])

        driver.status = Driver.Status.ASSIGNED
        driver.save(update_fields=["status"])

        # Create or update manager alert
        alert_key = f"dispatch:{shipment.id}"
        alert_msg = (
            f"Shipment {shipment.reference} from {shipment.pickup_address[:30]} "
            f"to {shipment.delivery_address[:30]} has been dispatched to {driver.full_name}. "
            "Waiting for driver acceptance."
        )
        Alert.objects.update_or_create(
            key=alert_key,
            defaults={
                "category": "dispatch",
                "severity": Alert.Severity.INFO,
                "message": alert_msg,
                "shipment": shipment,
                "vehicle": vehicle,
                "status": Alert.Status.OPEN,
            },
        )

        log_event(
            user,
            "shipment",
            shipment.id,
            f"Shipment dispatched to driver {driver.full_name} ({vehicle.registration_number}). Awaiting acceptance.",
        )

    # Perform SMS dispatch outside the tight database lock, then record status
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
        dispatch.sms_error = sms_meta.get("error", "Failed to deliver SMS notification.")

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

    return dispatch, True


def driver_accept_dispatch(*, dispatch_id: Optional[int] = None, token: Optional[str] = None, user=None):
    """
    Driver accepts the assigned dispatch request.
    """
    with transaction.atomic():
        qs = DispatchRequest.objects.select_for_update().select_related("shipment", "vehicle", "driver")
        if token:
            dispatch = get_object_or_404(qs, token=token)
        elif dispatch_id:
            dispatch = get_object_or_404(qs, pk=dispatch_id)
        else:
            raise ValidationError("Either dispatch_id or token must be provided.")

        # Security check: if authenticated user is a driver, verify ownership
        if user and user.is_authenticated and hasattr(user, "profile") and user.profile.role == "driver":
            if hasattr(dispatch.driver, "user") and dispatch.driver.user and dispatch.driver.user != user:
                raise PermissionDenied("You do not have permission to respond to this assignment.")

        if dispatch.status != DispatchRequest.Status.PENDING:
            raise ValidationError(
                f"Assignment cannot be accepted because its status is '{dispatch.get_status_display()}'."
            )

        shipment = Shipment.objects.select_for_update().get(pk=dispatch.shipment_id)

        now = timezone.now()
        dispatch.status = DispatchRequest.Status.ACCEPTED
        dispatch.responded_at = now
        dispatch.save(update_fields=["status", "responded_at"])

        shipment.status = Shipment.Status.ACCEPTED
        shipment.save(update_fields=["status", "updated_at"])

        # Update manager alert
        alert_key = f"dispatch:{shipment.id}"
        alert_msg = f"Driver {dispatch.driver.full_name} accepted shipment {shipment.reference}. Awaiting trip start."
        Alert.objects.update_or_create(
            key=alert_key,
            defaults={
                "category": "dispatch",
                "severity": Alert.Severity.INFO,
                "message": alert_msg,
                "shipment": shipment,
                "vehicle": dispatch.vehicle,
                "status": Alert.Status.OPEN,
            },
        )

        log_event(
            user,
            "shipment",
            shipment.id,
            f"Driver {dispatch.driver.full_name} accepted assignment. Ready for trip start.",
        )

    return dispatch


def driver_reject_dispatch(
    *,
    reason: str,
    dispatch_id: Optional[int] = None,
    token: Optional[str] = None,
    user=None,
    notes: str = "",
):
    """
    Driver rejects the assigned dispatch request with required reason.
    """
    if not reason or not reason.strip():
        raise ValidationError({"reason": "A reason is required to reject the assignment."})


    with transaction.atomic():
        qs = DispatchRequest.objects.select_for_update().select_related("shipment", "vehicle", "driver")
        if token:
            dispatch = get_object_or_404(qs, token=token)
        elif dispatch_id:
            dispatch = get_object_or_404(qs, pk=dispatch_id)
        else:
            raise ValidationError("Either dispatch_id or token must be provided.")

        if user and user.is_authenticated and hasattr(user, "profile") and user.profile.role == "driver":
            if hasattr(dispatch.driver, "user") and dispatch.driver.user and dispatch.driver.user != user:
                raise PermissionDenied("You do not have permission to respond to this assignment.")

        if dispatch.status != DispatchRequest.Status.PENDING:
            raise ValidationError(
                f"Assignment cannot be rejected because its status is '{dispatch.get_status_display()}'."
            )

        shipment = Shipment.objects.select_for_update().get(pk=dispatch.shipment_id)
        vehicle = Vehicle.objects.select_for_update().get(pk=dispatch.vehicle_id)
        driver = Driver.objects.select_for_update().get(pk=dispatch.driver_id)

        now = timezone.now()
        dispatch.status = DispatchRequest.Status.REJECTED
        dispatch.rejection_reason = reason.strip()
        dispatch.rejection_notes = notes.strip()
        dispatch.responded_at = now
        dispatch.save(update_fields=["status", "rejection_reason", "rejection_notes", "responded_at"])

        shipment.status = Shipment.Status.REJECTED
        shipment.save(update_fields=["status", "updated_at"])

        # Release vehicle and driver so they can be reassigned
        vehicle.status = Vehicle.Status.AVAILABLE
        vehicle.save(update_fields=["status"])

        driver.status = Driver.Status.AVAILABLE
        driver.save(update_fields=["status"])

        # Create manager alert for rejection
        alert_key = f"dispatch:{shipment.id}"
        alert_msg = (
            f"Driver {driver.full_name} rejected shipment {shipment.reference}. "
            f"Reassignment required. Reason: {reason}"
        )
        Alert.objects.update_or_create(
            key=alert_key,
            defaults={
                "category": "dispatch",
                "severity": Alert.Severity.WARNING,
                "message": alert_msg,
                "shipment": shipment,
                "vehicle": vehicle,
                "status": Alert.Status.OPEN,
            },
        )

        log_event(
            user,
            "shipment",
            shipment.id,
            f"Driver {driver.full_name} rejected assignment. Reason: {reason}.",
        )

    return dispatch


def start_trip_from_dispatch(*, shipment_id: int, user):
    """
    Starts physical trip after driver acceptance.
    Validates acceptance and resource availability, then creates/activates the Trip.
    """
    with transaction.atomic():
        shipment = get_object_or_404(
            Shipment.objects.select_for_update(),
            pk=shipment_id,
        )

        if shipment.status != Shipment.Status.ACCEPTED:
            raise ValidationError(
                f"Trip can only be started for accepted shipments (currently: {shipment.get_status_display()})."
            )

        dispatch = (
            DispatchRequest.objects.select_for_update()
            .filter(shipment=shipment, status=DispatchRequest.Status.ACCEPTED)
            .order_by("-dispatched_at")
            .first()
        )
        if not dispatch:
            raise ValidationError("No accepted dispatch record found for this shipment.")

        vehicle = Vehicle.objects.select_for_update().get(pk=dispatch.vehicle_id)
        driver = Driver.objects.select_for_update().get(pk=dispatch.driver_id)

        # Calculate or reuse route
        try:
            route = get_route(
                shipment.pickup_lat,
                shipment.pickup_lng,
                shipment.delivery_lat,
                shipment.delivery_lng,
            )
        except RouteError:
            route = None

        now = timezone.now()
        duration_min = route["duration_min"] if route else 120
        distance_km = route["distance_km"] if route else None

        # Check or create trip
        trip = Trip.objects.filter(shipment=shipment).first()
        if not trip:
            trip = Trip.objects.create(
                shipment=shipment,
                vehicle=vehicle,
                driver=driver,
                status=Trip.Status.IN_TRANSIT,
                started_at=now,
                planned_duration_min=duration_min,
                distance_km=distance_km,
                estimated_arrival=now + timedelta(minutes=duration_min),
                created_by=user,
            )
        else:
            trip.vehicle = vehicle
            trip.driver = driver
            trip.status = Trip.Status.IN_TRANSIT
            trip.started_at = now
            trip.planned_duration_min = duration_min
            trip.distance_km = distance_km
            trip.estimated_arrival = now + timedelta(minutes=duration_min)
            trip.save()

        # Update shipment status and start time
        shipment.status = Shipment.Status.IN_TRANSIT
        shipment.started_at = now
        shipment.save(update_fields=["status", "started_at", "updated_at"])

        # Vehicle is in transit, initial location is pickup
        vehicle.status = Vehicle.Status.IN_TRANSIT
        vehicle.current_lat = shipment.pickup_lat
        vehicle.current_lng = shipment.pickup_lng
        vehicle.save(update_fields=["status", "current_lat", "current_lng"])

        # Driver is on trip
        driver.status = Driver.Status.ON_TRIP
        driver.save(update_fields=["status"])

        # Resolve dispatch waiting alert
        Alert.objects.filter(key=f"dispatch:{shipment.id}").update(
            status=Alert.Status.RESOLVED,
            resolution="started",
            resolved_at=now,
        )

        log_event(
            user,
            "shipment",
            shipment.id,
            f"Trip #{trip.id} started. Vehicle {vehicle.registration_number} in transit.",
        )

    return trip
