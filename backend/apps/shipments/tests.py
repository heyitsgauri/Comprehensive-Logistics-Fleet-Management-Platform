from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.exceptions import ValidationError, PermissionDenied
from rest_framework.test import APIClient

from apps.accounts.models import Profile, Role
from apps.fleet.models import Driver, Vehicle
from apps.shipments import dispatch_service
from apps.shipments.models import Customer, DispatchRequest, Shipment
from apps.trips.models import Trip

FAKE_ROUTE = {"distance_km": 120.0, "duration_min": 150, "geometry": [[77.2, 28.6], [78.0, 27.1]]}


def create_sample_shipment(customer, weight="400"):
    return Shipment.objects.create(
        customer=customer,
        pickup_address="Warehouse Alpha, Delhi",
        pickup_lat=28.6139,
        pickup_lng=77.2090,
        delivery_address="Customer Facility, Agra",
        delivery_lat=27.1767,
        delivery_lng=78.0081,
        cargo_description="Electronic Equipment",
        weight_kg=Decimal(weight),
        deadline=timezone.now() + timedelta(days=2),
        scheduled_departure=timezone.now() + timedelta(hours=2),
    )


@patch("apps.trips.routing.get_route", return_value=FAKE_ROUTE)
@patch("apps.shipments.dispatch_service.get_route", return_value=FAKE_ROUTE)
class DispatchWorkflowTests(TestCase):
    def setUp(self):
        self.customer = Customer.objects.create(
            name="HCL Technologies Ltd",
            phone="+919876543210",
            address="Noida Special Economic Zone",
        )
        self.vehicle = Vehicle.objects.create(
            registration_number="UP16-BT-4521",
            vehicle_type="Heavy Truck",
            make="Tata",
            model="Signa 4825.TK",
            capacity_kg=Decimal("1500"),
            status=Vehicle.Status.AVAILABLE,
        )
        self.driver_user = User.objects.create_user(
            username="driver_amit",
            password="driver-password-123",
            first_name="Amit",
            last_name="Kumar",
        )
        Profile.objects.create(user=self.driver_user, role=Role.DRIVER)
        self.driver = Driver.objects.create(
            full_name="Amit Kumar",
            phone="+919876543299",
            license_number="DL-1420110012345",
            license_expiry=timezone.localdate() + timedelta(days=365),
            status=Driver.Status.AVAILABLE,
            user=self.driver_user,
        )
        self.shipment = create_sample_shipment(self.customer)

        self.manager_user = User.objects.create_user(
            username="manager_neha",
            password="manager-password-123",
            first_name="Neha",
            last_name="Verma",
        )
        Profile.objects.create(user=self.manager_user, role=Role.FLEET_MANAGER)

        self.client = APIClient()
        self.client.force_authenticate(self.manager_user)

    def test_dispatch_validation_rejects_under_capacity(self, _route1, _route2):
        heavy = create_sample_shipment(self.customer, weight="3000")
        with self.assertRaises(ValidationError):
            dispatch_service.dispatch_shipment(
                shipment_id=heavy.id,
                vehicle_id=self.vehicle.id,
                driver_id=self.driver.id,
                user=self.manager_user,
            )

    def test_dispatch_validation_rejects_maintenance_vehicle(self, _route1, _route2):
        self.vehicle.status = Vehicle.Status.MAINTENANCE
        self.vehicle.save()
        with self.assertRaises(ValidationError):
            dispatch_service.dispatch_shipment(
                shipment_id=self.shipment.id,
                vehicle_id=self.vehicle.id,
                driver_id=self.driver.id,
                user=self.manager_user,
            )

    def test_dispatch_validation_rejects_expired_driver_license(self, _route1, _route2):
        self.driver.license_expiry = timezone.localdate() - timedelta(days=5)
        self.driver.save()
        with self.assertRaises(ValidationError):
            dispatch_service.dispatch_shipment(
                shipment_id=self.shipment.id,
                vehicle_id=self.vehicle.id,
                driver_id=self.driver.id,
                user=self.manager_user,
            )

    def test_dispatch_creates_record_and_sets_awaiting_acceptance(self, _route1, _route2):
        dispatch, newly_sent = dispatch_service.dispatch_shipment(
            shipment_id=self.shipment.id,
            vehicle_id=self.vehicle.id,
            driver_id=self.driver.id,
            user=self.manager_user,
        )
        self.assertTrue(newly_sent)
        self.assertEqual(dispatch.status, DispatchRequest.Status.PENDING)
        self.assertEqual(dispatch.sms_status, DispatchRequest.SmsStatus.SENT)

        self.shipment.refresh_from_db()
        self.vehicle.refresh_from_db()
        self.driver.refresh_from_db()

        self.assertEqual(self.shipment.status, Shipment.Status.AWAITING_DRIVER_ACCEPTANCE)
        self.assertEqual(self.vehicle.status, Vehicle.Status.ASSIGNED)
        self.assertEqual(self.driver.status, Driver.Status.ASSIGNED)

    def test_dispatch_is_idempotent(self, _route1, _route2):
        # First call
        d1, sent1 = dispatch_service.dispatch_shipment(
            shipment_id=self.shipment.id,
            vehicle_id=self.vehicle.id,
            driver_id=self.driver.id,
            user=self.manager_user,
        )
        # Second identical call
        d2, sent2 = dispatch_service.dispatch_shipment(
            shipment_id=self.shipment.id,
            vehicle_id=self.vehicle.id,
            driver_id=self.driver.id,
            user=self.manager_user,
            retry_sms=False,
        )
        self.assertEqual(d1.id, d2.id)
        self.assertFalse(sent2)
        self.assertEqual(DispatchRequest.objects.filter(shipment=self.shipment).count(), 1)

    def test_driver_accept_updates_status(self, _route1, _route2):
        dispatch, _ = dispatch_service.dispatch_shipment(
            shipment_id=self.shipment.id,
            vehicle_id=self.vehicle.id,
            driver_id=self.driver.id,
            user=self.manager_user,
        )
        accepted = dispatch_service.driver_accept_dispatch(
            dispatch_id=dispatch.id,
            user=self.driver_user,
        )
        self.assertEqual(accepted.status, DispatchRequest.Status.ACCEPTED)
        self.assertIsNotNone(accepted.responded_at)

        self.shipment.refresh_from_db()
        self.assertEqual(self.shipment.status, Shipment.Status.ACCEPTED)

    def test_driver_reject_releases_resources_and_records_reason(self, _route1, _route2):
        dispatch, _ = dispatch_service.dispatch_shipment(
            shipment_id=self.shipment.id,
            vehicle_id=self.vehicle.id,
            driver_id=self.driver.id,
            user=self.manager_user,
        )
        rejected = dispatch_service.driver_reject_dispatch(
            dispatch_id=dispatch.id,
            user=self.driver_user,
            reason="Schedule conflict with medical appointment",
        )
        self.assertEqual(rejected.status, DispatchRequest.Status.REJECTED)
        self.assertEqual(rejected.rejection_reason, "Schedule conflict with medical appointment")

        self.shipment.refresh_from_db()
        self.vehicle.refresh_from_db()
        self.driver.refresh_from_db()

        self.assertEqual(self.shipment.status, Shipment.Status.REJECTED)
        self.assertEqual(self.vehicle.status, Vehicle.Status.AVAILABLE)
        self.assertEqual(self.driver.status, Driver.Status.AVAILABLE)

    def test_start_trip_requires_driver_acceptance(self, _route1, _route2):
        dispatch, _ = dispatch_service.dispatch_shipment(
            shipment_id=self.shipment.id,
            vehicle_id=self.vehicle.id,
            driver_id=self.driver.id,
            user=self.manager_user,
        )
        # Cannot start trip when shipment is still awaiting acceptance
        with self.assertRaises(ValidationError):
            dispatch_service.start_trip_from_dispatch(
                shipment_id=self.shipment.id,
                user=self.manager_user,
            )

        # Driver accepts
        dispatch_service.driver_accept_dispatch(dispatch_id=dispatch.id, user=self.driver_user)

        # Now manager can start the trip
        trip = dispatch_service.start_trip_from_dispatch(
            shipment_id=self.shipment.id,
            user=self.manager_user,
        )
        self.assertEqual(trip.status, Trip.Status.IN_TRANSIT)
        self.shipment.refresh_from_db()
        self.vehicle.refresh_from_db()
        self.driver.refresh_from_db()

        self.assertEqual(self.shipment.status, Shipment.Status.IN_TRANSIT)
        self.assertIsNotNone(self.shipment.started_at)
        self.assertEqual(self.vehicle.status, Vehicle.Status.IN_TRANSIT)
        self.assertEqual(self.driver.status, Driver.Status.ON_TRIP)

    def test_dispatch_api_endpoints(self, _route1, _route2):
        # 1. Dispatch API call
        resp = self.client.post(
            f"/api/v1/shipments/{self.shipment.id}/dispatch/",
            {"vehicle_id": self.vehicle.id, "driver_id": self.driver.id},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["status"], "awaiting_acceptance")
        dispatch_token = resp.data["dispatch"]["token"]

        # 2. Token portal view
        portal_resp = self.client.get(f"/api/v1/driver/portal/?token={dispatch_token}")
        self.assertEqual(portal_resp.status_code, 200)
        self.assertEqual(portal_resp.data["shipment_ref"], self.shipment.reference)

        # 3. Accept via token
        accept_resp = self.client.post(
            "/api/v1/driver/portal/",
            {"token": dispatch_token, "action": "accept"},
            format="json",
        )
        self.assertEqual(accept_resp.status_code, 200)
        self.assertEqual(accept_resp.data["status"], "accepted")

        # 4. Start trip via manager API
        start_resp = self.client.post(f"/api/v1/shipments/{self.shipment.id}/start_trip/")
        self.assertEqual(start_resp.status_code, 200)
        self.assertEqual(start_resp.data["status"], "in_transit")

    def test_driver_portal_lists_in_transit_and_hides_delivered_shipments(
        self, _route1, _route2
    ):
        dispatch, _ = dispatch_service.dispatch_shipment(
            shipment_id=self.shipment.id,
            vehicle_id=self.vehicle.id,
            driver_id=self.driver.id,
            user=self.manager_user,
        )
        dispatch_service.driver_accept_dispatch(
            dispatch_id=dispatch.id,
            user=self.driver_user,
        )
        dispatch_service.start_trip_from_dispatch(
            shipment_id=self.shipment.id,
            user=self.manager_user,
        )

        self.client.force_authenticate(self.driver_user)
        response = self.client.get("/api/v1/dispatches/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["results"]), 1)
        self.assertEqual(response.data["results"][0]["shipment_status"], "in_transit")
        self.assertIsNotNone(response.data["results"][0]["shipment_started_at"])

        from apps.trips.services import complete_trip

        trip = Trip.objects.get(shipment=self.shipment)
        complete_trip(trip.id)

        response = self.client.get("/api/v1/dispatches/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["results"], [])
