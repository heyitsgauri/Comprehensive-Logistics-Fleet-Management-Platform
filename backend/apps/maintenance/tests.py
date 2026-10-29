from datetime import timedelta
from decimal import Decimal

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.expenses.models import Expense
from apps.fleet.models import Vehicle
from apps.trips.services import vehicle_issues

from .models import MaintenanceRecord


class MaintenanceApiTests(TestCase):
    def setUp(self):
        user = User.objects.create_superuser(
            username="maintenance-admin",
            email="maintenance@example.com",
            password="test-pass",
        )
        self.client = APIClient()
        self.client.force_authenticate(user)
        self.vehicle = Vehicle.objects.create(
            registration_number="MAINT-100",
            vehicle_type="Truck",
            make="Test",
            model="One",
            capacity_kg=Decimal("5000"),
        )

    def create_record(self):
        return self.client.post(
            "/api/v1/maintenance/",
            {
                "vehicle": self.vehicle.id,
                "kind": MaintenanceRecord.Kind.PREVENTIVE,
                "description": "Oil and filter service",
                "scheduled_date": (
                    timezone.localdate() + timedelta(days=1)
                ).isoformat(),
                "estimated_cost": "4500.00",
                "notes": "Use approved parts",
            },
            format="json",
        )

    def test_schedule_edit_and_cancel_preserve_record(self):
        created = self.create_record()
        self.assertEqual(created.status_code, 201)
        record_id = created.data["id"]

        edited = self.client.patch(
            f"/api/v1/maintenance/{record_id}/",
            {"description": "Updated oil service", "estimated_cost": "4700"},
            format="json",
        )
        self.assertEqual(edited.status_code, 200)
        self.assertEqual(edited.data["estimated_cost"], "4700.00")

        cancelled = self.client.post(
            f"/api/v1/maintenance/{record_id}/cancel/"
        )
        self.assertEqual(cancelled.status_code, 200)
        self.assertEqual(cancelled.data["status"], MaintenanceRecord.Status.CANCELLED)
        self.assertEqual(MaintenanceRecord.objects.count(), 1)

    def test_completed_maintenance_creates_one_source_linked_expense(self):
        created = self.create_record()
        record_id = created.data["id"]
        started = self.client.post(f"/api/v1/maintenance/{record_id}/start/")
        self.assertEqual(started.status_code, 200)
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.status, Vehicle.Status.MAINTENANCE)

        completed = self.client.post(
            f"/api/v1/maintenance/{record_id}/complete/",
            {"cost": "4200.00", "odometer_km": "1200"},
            format="json",
        )
        self.assertEqual(completed.status_code, 200)
        expense = Expense.objects.get(maintenance_record_id=record_id)
        self.assertEqual(expense.amount, Decimal("4200.00"))
        self.assertEqual(expense.vehicle_id, self.vehicle.id)

        retry = self.client.post(
            f"/api/v1/maintenance/{record_id}/complete/",
            {"cost": "4200.00"},
            format="json",
        )
        self.assertEqual(retry.status_code, 400)
        self.assertEqual(
            Expense.objects.filter(maintenance_record_id=record_id).count(),
            1,
        )
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.status, Vehicle.Status.AVAILABLE)

    def test_in_progress_maintenance_blocks_vehicle_assignment(self):
        created = self.create_record()
        record_id = created.data["id"]
        started = self.client.post(f"/api/v1/maintenance/{record_id}/start/")
        self.assertEqual(started.status_code, 200)
        self.vehicle.refresh_from_db()

        issues = vehicle_issues(
            self.vehicle,
            type("ShipmentWeight", (), {"weight_kg": Decimal("500")})(),
        )

        self.assertIn("Vehicle is in maintenance.", issues)
