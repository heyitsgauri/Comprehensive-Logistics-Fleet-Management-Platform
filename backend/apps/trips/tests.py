from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIClient

from apps.fleet.models import Driver, Vehicle
from apps.shipments.models import Customer, Shipment

from . import services

FAKE_ROUTE = {"distance_km": 100.0, "duration_min": 120, "geometry": []}


def make_shipment(customer, weight="500"):
    return Shipment.objects.create(
        customer=customer,
        pickup_address="A",
        pickup_lat=28.6,
        pickup_lng=77.2,
        delivery_address="B",
        delivery_lat=27.1,
        delivery_lng=78.0,
        cargo_description="Boxes",
        weight_kg=Decimal(weight),
        deadline=timezone.now() + timedelta(days=1),
    )


@patch("apps.trips.services.get_route", return_value=FAKE_ROUTE)
class TripRulesTest(TestCase):
    def setUp(self):
        self.customer = Customer.objects.create(name="Acme", phone="1", address="x")
        self.vehicle = Vehicle.objects.create(
            registration_number="T1",
            vehicle_type="Truck",
            make="M",
            model="X",
            capacity_kg=Decimal("1000"),
        )
        self.driver = Driver.objects.create(
            full_name="D",
            phone="1",
            license_number="L1",
            license_expiry=timezone.localdate() + timedelta(days=365),
        )
        self.shipment = make_shipment(self.customer)
        user = User.objects.create_superuser(
            username="trip-admin",
            email="trip-admin@example.com",
            password="test-pass",
        )
        self.client = APIClient()
        self.client.force_authenticate(user)

    def assign(self, shipment=None, vehicle=None, driver=None):
        return services.create_trip(
            shipment_id=(shipment or self.shipment).id,
            vehicle_id=(vehicle or self.vehicle).id,
            driver_id=(driver or self.driver).id,
            user=None,
        )

    def test_full_lifecycle_keeps_statuses_consistent(self, _route):
        trip = self.assign()
        self.shipment.refresh_from_db()
        self.vehicle.refresh_from_db()
        self.driver.refresh_from_db()
        self.assertEqual(self.shipment.status, Shipment.Status.ASSIGNED)
        self.assertEqual(self.vehicle.status, Vehicle.Status.ASSIGNED)
        self.assertEqual(self.driver.status, Driver.Status.ASSIGNED)

        services.start_trip(trip.id)
        self.shipment.refresh_from_db()
        self.vehicle.refresh_from_db()
        self.assertEqual(self.shipment.status, Shipment.Status.IN_TRANSIT)
        self.assertEqual(self.vehicle.status, Vehicle.Status.IN_TRANSIT)

        services.complete_trip(trip.id)
        self.shipment.refresh_from_db()
        self.vehicle.refresh_from_db()
        self.driver.refresh_from_db()
        self.assertEqual(self.shipment.status, Shipment.Status.DELIVERED)
        self.assertEqual(self.vehicle.status, Vehicle.Status.AVAILABLE)
        self.assertEqual(self.driver.status, Driver.Status.AVAILABLE)
        self.assertEqual(self.vehicle.odometer_km, 100)

    def test_over_capacity_is_rejected(self, _route):
        heavy = make_shipment(self.customer, weight="5000")
        with self.assertRaises(ValidationError):
            self.assign(shipment=heavy)

    def test_vehicle_cannot_be_double_booked(self, _route):
        self.assign()
        other = make_shipment(self.customer)
        with self.assertRaises(ValidationError):
            self.assign(shipment=other)

    def test_expired_license_is_rejected(self, _route):
        self.driver.license_expiry = timezone.localdate() - timedelta(days=1)
        self.driver.save()
        with self.assertRaises(ValidationError):
            self.assign()

    def test_cannot_complete_a_trip_that_never_started(self, _route):
        trip = self.assign()
        with self.assertRaises(ValidationError):
            services.complete_trip(trip.id)

    def test_eligibility_endpoint_explains_capacity_and_exposes_vehicle_details(
        self, _route
    ):
        heavy = make_shipment(self.customer, weight="12000")

        response = self.client.get(f"/api/v1/shipments/{heavy.id}/eligible/")

        self.assertEqual(response.status_code, 200)
        vehicle = next(
            item
            for item in response.data["vehicles"]
            if item["id"] == self.vehicle.id
        )
        self.assertFalse(vehicle["eligible"])
        self.assertIn("below the shipment weight", vehicle["issues"][0])
        self.assertEqual(vehicle["registration_number"], self.vehicle.registration_number)
        self.assertEqual(vehicle["vehicle_type"], self.vehicle.vehicle_type)
        self.assertEqual(vehicle["make"], self.vehicle.make)
        self.assertEqual(vehicle["fuel_type"], self.vehicle.fuel_type)
        self.assertEqual(response.data["drivers"][0]["license_valid"], True)

    def test_eligibility_endpoint_reports_conflicting_active_trip(self, _route):
        self.assign()
        other = make_shipment(self.customer)

        response = self.client.get(f"/api/v1/shipments/{other.id}/eligible/")

        vehicle = next(
            item
            for item in response.data["vehicles"]
            if item["id"] == self.vehicle.id
        )
        driver = next(
            item
            for item in response.data["drivers"]
            if item["id"] == self.driver.id
        )
        self.assertFalse(vehicle["eligible"])
        self.assertEqual(vehicle["active_trip"]["shipment_ref"], self.shipment.reference)
        self.assertIn("assigned", vehicle["issues"][0])
        self.assertFalse(driver["eligible"])
        self.assertEqual(driver["active_trip"]["shipment_ref"], self.shipment.reference)
        self.assertIn("assigned", driver["issues"][0])
