from datetime import timedelta

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.fleet.models import Driver, Vehicle
from apps.shipments.models import Shipment

from .models import Trip
from .routing import RouteError, get_route


def vehicle_issues(vehicle, shipment):
    issues = []
    today = timezone.localdate()
    if vehicle.status != Vehicle.Status.AVAILABLE:
        status_text = "in maintenance" if vehicle.status == Vehicle.Status.MAINTENANCE else vehicle.get_status_display().lower()
        issues.append(f"Vehicle is {status_text}.")
    if vehicle.capacity_kg < shipment.weight_kg:
        issues.append(
            f"Capacity {vehicle.capacity_kg} kg is below the shipment "
            f"weight {shipment.weight_kg} kg."
        )
    if vehicle.insurance_expiry and vehicle.insurance_expiry < today:
        issues.append("Insurance has expired.")
    if vehicle.permit_expiry and vehicle.permit_expiry < today:
        issues.append("Permit has expired.")
    return issues


def driver_issues(driver):
    issues = []
    if driver.status != Driver.Status.AVAILABLE:
        issues.append(f"Driver is {driver.get_status_display().lower()}.")
    if driver.license_expiry < timezone.localdate():
        issues.append("Driving license has expired.")
    return issues


def create_trip(*, shipment_id, vehicle_id, driver_id, user):
    shipment = get_object_or_404(Shipment, pk=shipment_id)
    try:
        route = get_route(
            shipment.pickup_lat,
            shipment.pickup_lng,
            shipment.delivery_lat,
            shipment.delivery_lng,
        )
    except RouteError:
        route = None

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

        if shipment.status != Shipment.Status.PENDING:
            raise ValidationError(
                {
                    "shipment": (
                        f"Shipment is {shipment.get_status_display().lower()}, "
                        "not pending assignment."
                    )
                }
            )
        if issues := vehicle_issues(vehicle, shipment):
            raise ValidationError({"vehicle": issues})
        if issues := driver_issues(driver):
            raise ValidationError({"driver": issues})

        trip = Trip.objects.create(
            shipment=shipment,
            vehicle=vehicle,
            driver=driver,
            created_by=user,
            distance_km=route["distance_km"] if route else None,
            planned_duration_min=route["duration_min"] if route else None,
        )
        shipment.status = Shipment.Status.ASSIGNED
        shipment.save(update_fields=["status", "updated_at"])
        vehicle.status = Vehicle.Status.ASSIGNED
        vehicle.save(update_fields=["status"])
        driver.status = Driver.Status.ASSIGNED
        driver.save(update_fields=["status"])
    return trip


def start_trip(trip_id):
    with transaction.atomic():
        trip = get_object_or_404(Trip.objects.select_for_update(), pk=trip_id)
        if trip.status != Trip.Status.PLANNED:
            raise ValidationError("Only planned trips can be started.")
        shipment = Shipment.objects.select_for_update().get(pk=trip.shipment_id)
        vehicle = Vehicle.objects.select_for_update().get(pk=trip.vehicle_id)
        driver = Driver.objects.select_for_update().get(pk=trip.driver_id)

        now = timezone.now()
        trip.status = Trip.Status.IN_TRANSIT
        trip.started_at = now
        if trip.planned_duration_min:
            trip.estimated_arrival = now + timedelta(
                minutes=trip.planned_duration_min
            )
        trip.save()

        shipment.status = Shipment.Status.IN_TRANSIT
        shipment.save(update_fields=["status", "updated_at"])
        vehicle.status = Vehicle.Status.IN_TRANSIT
        vehicle.current_lat, vehicle.current_lng = (
            shipment.pickup_lat,
            shipment.pickup_lng,
        )
        vehicle.save(update_fields=["status", "current_lat", "current_lng"])
        driver.status = Driver.Status.ON_TRIP
        driver.save(update_fields=["status"])
    return trip


def complete_trip(trip_id):
    with transaction.atomic():
        trip = get_object_or_404(Trip.objects.select_for_update(), pk=trip_id)
        if trip.status != Trip.Status.IN_TRANSIT:
            raise ValidationError("Only trips in transit can be completed.")
        shipment = Shipment.objects.select_for_update().get(pk=trip.shipment_id)
        vehicle = Vehicle.objects.select_for_update().get(pk=trip.vehicle_id)
        driver = Driver.objects.select_for_update().get(pk=trip.driver_id)

        trip.status = Trip.Status.COMPLETED
        trip.completed_at = timezone.now()
        trip.save()

        shipment.status = Shipment.Status.DELIVERED
        shipment.save(update_fields=["status", "updated_at"])
        vehicle.status = Vehicle.Status.AVAILABLE
        vehicle.odometer_km += round(trip.distance_km or 0)
        vehicle.current_lat, vehicle.current_lng = (
            shipment.delivery_lat,
            shipment.delivery_lng,
        )
        vehicle.save(
            update_fields=[
                "status",
                "odometer_km",
                "current_lat",
                "current_lng",
            ]
        )
        driver.status = Driver.Status.AVAILABLE
        driver.save(update_fields=["status"])
    return trip


def cancel_trip(trip_id):
    with transaction.atomic():
        trip = get_object_or_404(Trip.objects.select_for_update(), pk=trip_id)
        if trip.status != Trip.Status.PLANNED:
            raise ValidationError("Only planned trips can be cancelled.")
        shipment = Shipment.objects.select_for_update().get(pk=trip.shipment_id)
        vehicle = Vehicle.objects.select_for_update().get(pk=trip.vehicle_id)
        driver = Driver.objects.select_for_update().get(pk=trip.driver_id)

        trip.status = Trip.Status.CANCELLED
        trip.save()
        shipment.status = Shipment.Status.PENDING
        shipment.save(update_fields=["status", "updated_at"])
        vehicle.status = Vehicle.Status.AVAILABLE
        vehicle.save(update_fields=["status"])
        driver.status = Driver.Status.AVAILABLE
        driver.save(update_fields=["status"])
    return trip
