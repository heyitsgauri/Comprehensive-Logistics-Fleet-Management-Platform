from datetime import timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.alerts.services import refresh_alerts
from apps.expenses.models import Expense
from apps.fleet.models import Vehicle
from apps.maintenance.models import MaintenanceRecord
from apps.shipments.models import Warehouse


class Command(BaseCommand):
    help = "Add repeatable warehouse, maintenance, expense and alert demo data."

    def handle(self, *args, **options):
        today = timezone.localdate()
        warehouses = [
            ("Delhi Warehouse", "Delhi", 28.6139, 77.2090, "09:00-18:00"),
            ("Jaipur Hub", "Jaipur", 26.9124, 75.7873, "08:00-20:00"),
            ("Agra Depot", "Agra", 27.1767, 78.0081, "09:00-17:00"),
        ]
        for name, address, lat, lng, hours in warehouses:
            Warehouse.objects.update_or_create(
                name=name,
                defaults={
                    "address": address,
                    "lat": lat,
                    "lng": lng,
                    "operating_hours": hours,
                },
            )

        vehicles = list(
            Vehicle.objects.exclude(status=Vehicle.Status.INACTIVE).order_by("id")[:3]
        )
        for vehicle in vehicles:
            MaintenanceRecord.objects.get_or_create(
                vehicle=vehicle,
                description="Scheduled demo inspection",
                scheduled_date=today + timedelta(days=7),
                defaults={"kind": MaintenanceRecord.Kind.SCHEDULED},
            )
            Expense.objects.get_or_create(
                vehicle=vehicle,
                category=Expense.Category.FUEL,
                date=today,
                note="Demo fuel fill",
                defaults={
                    "amount": Decimal("2100.00"),
                    "litres": Decimal("30.00"),
                    "unit_price": Decimal("70.00"),
                },
            )

        open_alerts = refresh_alerts()
        self.stdout.write(
            self.style.SUCCESS(
                f"Extra demo data ready: {len(warehouses)} warehouses, "
                f"maintenance and fuel records for {len(vehicles)} vehicles, "
                f"{open_alerts} open alerts."
            )
        )
