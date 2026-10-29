from datetime import timedelta
from decimal import Decimal
from io import StringIO

from django.contrib.auth.models import User
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import AuditEvent
from apps.expenses.models import Expense
from apps.fleet.models import Driver, Vehicle
from apps.maintenance.models import MaintenanceRecord
from apps.shipments.models import Customer, Shipment, Warehouse
from apps.trips.models import Trip


class OperationsApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_superuser(
            username="operations-admin",
            email="operations@example.com",
            password="test-pass",
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.vehicle = Vehicle.objects.create(
            registration_number="EXT-100",
            vehicle_type="Truck",
            make="Tata",
            model="Test",
            capacity_kg=Decimal("5000"),
        )
        self.customer = Customer.objects.create(
            name="Operations Test",
            phone="9000000000",
            address="Delhi",
        )
        self.shipment = Shipment.objects.create(
            customer=self.customer,
            pickup_address="Delhi",
            pickup_lat=28.6,
            pickup_lng=77.2,
            delivery_address="Agra",
            delivery_lat=27.2,
            delivery_lng=78.0,
            cargo_description="Test cargo",
            weight_kg=Decimal("100"),
            deadline=timezone.now() - timedelta(hours=1),
        )

    def test_warehouse_can_be_created_through_api(self):
        response = self.client.post(
            "/api/v1/warehouses/",
            {
                "name": "Operations Depot",
                "address": "Delhi",
                "lat": 28.6,
                "lng": 77.2,
                "operating_hours": "09:00-18:00",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertTrue(Warehouse.objects.filter(name="Operations Depot").exists())

    def test_maintenance_lifecycle_records_expense_and_restores_vehicle(self):
        response = self.client.post(
            "/api/v1/maintenance/",
            {
                "vehicle": self.vehicle.id,
                "kind": "repair",
                "description": "Brake inspection",
                "scheduled_date": timezone.localdate().isoformat(),
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        record_id = response.data["id"]

        start = self.client.post(f"/api/v1/maintenance/{record_id}/start/")
        self.assertEqual(start.status_code, 200)
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.status, Vehicle.Status.MAINTENANCE)

        complete = self.client.post(
            f"/api/v1/maintenance/{record_id}/complete/",
            {"cost": "1250.00", "odometer_km": 550},
            format="json",
        )
        self.assertEqual(complete.status_code, 200)
        self.vehicle.refresh_from_db()
        record = MaintenanceRecord.objects.get(pk=record_id)
        self.assertEqual(self.vehicle.status, Vehicle.Status.AVAILABLE)
        self.assertEqual(self.vehicle.odometer_km, 550)
        self.assertEqual(record.status, MaintenanceRecord.Status.COMPLETED)
        self.assertTrue(
            Expense.objects.filter(
                vehicle=self.vehicle,
                category=Expense.Category.MAINTENANCE,
                amount=Decimal("1250.00"),
            ).exists()
        )
        self.assertEqual(AuditEvent.objects.count(), 3)

    def test_alert_refresh_creates_overdue_shipment_alert(self):
        response = self.client.post("/api/v1/alerts/refresh/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["open"], 1)
        self.assertTrue(
            self.shipment.reference in
            self.client.get("/api/v1/alerts/").data["results"][0]["message"]
        )

    def test_analytics_rejects_reversed_date_range(self):
        today = timezone.localdate()
        response = self.client.get(
            "/api/v1/analytics/trends/",
            {"from": (today + timedelta(days=1)).isoformat(), "to": today.isoformat()},
        )

        self.assertEqual(response.status_code, 400)

    def test_analytics_counts_deliveries_by_completion_date(self):
        now = timezone.now()
        driver = Driver.objects.create(
            full_name="Analytics Driver",
            phone="9000000001",
            license_number="ANALYTICS-1",
            license_expiry=timezone.localdate() + timedelta(days=365),
        )
        trip = Trip.objects.create(
            shipment=self.shipment,
            vehicle=self.vehicle,
            driver=driver,
            status=Trip.Status.COMPLETED,
            started_at=now - timedelta(hours=1),
            completed_at=now,
        )
        Trip.objects.filter(pk=trip.pk).update(
            created_at=now - timedelta(days=10)
        )

        today = timezone.localdate().isoformat()
        response = self.client.get(
            "/api/v1/analytics/trends/",
            {"from": today, "to": today},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["deliveries"], 1)

    def test_seed_extra_is_repeatable(self):
        call_command("seed_extra", stdout=StringIO())
        counts = (
            Warehouse.objects.count(),
            MaintenanceRecord.objects.count(),
            Expense.objects.count(),
        )

        call_command("seed_extra", stdout=StringIO())

        self.assertEqual(
            (
                Warehouse.objects.count(),
                MaintenanceRecord.objects.count(),
                Expense.objects.count(),
            ),
            counts,
        )
