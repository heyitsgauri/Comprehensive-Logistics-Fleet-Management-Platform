from datetime import timedelta

from django.utils import timezone

from apps.expenses.models import Expense
from apps.fleet.models import Driver, Vehicle
from apps.maintenance.models import MaintenanceRecord
from apps.shipments.models import Shipment

from .models import Alert

OPEN_SHIPMENTS = (
    Shipment.Status.PENDING,
    Shipment.Status.ASSIGNED,
    Shipment.Status.IN_TRANSIT,
    Shipment.Status.DELAYED,
)


def build_candidates():
    now = timezone.now()
    today = timezone.localdate()
    soon = today + timedelta(days=30)
    candidates = {}

    def add(key, category, severity, message, vehicle=None, shipment=None):
        candidates[key] = {
            "category": category,
            "severity": severity,
            "message": message,
            "vehicle": vehicle,
            "shipment": shipment,
        }

    for shipment in Shipment.objects.filter(status__in=OPEN_SHIPMENTS):
        if shipment.deadline < now:
            add(
                f"delayed:{shipment.id}",
                "delayed",
                "critical",
                f"{shipment.reference} is past its deadline "
                f"({timezone.localtime(shipment.deadline):%d %b %H:%M}).",
                shipment=shipment,
            )
        elif shipment.deadline < now + timedelta(hours=24):
            add(
                f"deadline:{shipment.id}",
                "deadline",
                "warning",
                f"{shipment.reference} is due within 24 hours.",
                shipment=shipment,
            )

    due_records = MaintenanceRecord.objects.filter(
        status__in=[
            MaintenanceRecord.Status.SCHEDULED,
            MaintenanceRecord.Status.IN_PROGRESS,
        ],
        scheduled_date__lte=today + timedelta(days=7),
    ).select_related("vehicle")
    for record in due_records:
        overdue = record.scheduled_date < today
        add(
            f"maintenance:{record.id}",
            "maintenance",
            "critical" if overdue else "warning",
            f"{record.vehicle.registration_number}: "
            f"{record.get_kind_display().lower()} "
            f"{'overdue since' if overdue else 'due on'} "
            f"{record.scheduled_date:%d %b}.",
            vehicle=record.vehicle,
        )

    for vehicle in Vehicle.objects.exclude(status=Vehicle.Status.INACTIVE):
        for label, expiry in (
            ("insurance", vehicle.insurance_expiry),
            ("permit", vehicle.permit_expiry),
        ):
            if expiry and expiry <= soon:
                expired = expiry < today
                add(
                    f"{label}:{vehicle.id}",
                    "document",
                    "critical" if expired else "warning",
                    f"{vehicle.registration_number}: {label} "
                    f"{'expired on' if expired else 'expires on'} "
                    f"{expiry:%d %b %Y}.",
                    vehicle=vehicle,
                )

    for driver in Driver.objects.exclude(status=Driver.Status.INACTIVE):
        if driver.license_expiry <= soon:
            expired = driver.license_expiry < today
            add(
                f"license:{driver.id}",
                "document",
                "critical" if expired else "warning",
                f"Driver {driver.full_name}: license "
                f"{'expired on' if expired else 'expires on'} "
                f"{driver.license_expiry:%d %b %Y}.",
            )

    for category in Expense.Category.values:
        records = list(
            Expense.objects.filter(category=category).select_related("vehicle")
        )
        if len(records) < 4:
            continue
        average = sum(record.amount for record in records) / len(records)
        for record in records:
            if (
                record.amount > 3 * average
                and record.date >= today - timedelta(days=30)
            ):
                add(
                    f"expense:{record.id}",
                    "expense",
                    "warning",
                    f"Unusual {category} expense of {record.amount} on "
                    f"{record.vehicle.registration_number} ({record.date:%d %b}).",
                    vehicle=record.vehicle,
                )
    return candidates


def refresh_alerts():
    candidates = build_candidates()
    existing = {alert.key: alert for alert in Alert.objects.all()}
    for key, data in candidates.items():
        if key not in existing:
            Alert.objects.create(key=key, **data)
        elif existing[key].status == Alert.Status.RESOLVED:
            alert = existing[key]
            alert.category = data["category"]
            alert.severity = data["severity"]
            alert.message = data["message"]
            alert.vehicle = data["vehicle"]
            alert.shipment = data["shipment"]
            alert.status = Alert.Status.OPEN
            alert.resolution = ""
            alert.resolved_at = None
            alert.save()
    for key, alert in existing.items():
        if key not in candidates and alert.status != Alert.Status.RESOLVED:
            alert.status = Alert.Status.RESOLVED
            alert.resolution = "auto"
            alert.resolved_at = now = timezone.now()
            alert.save(update_fields=["status", "resolution", "resolved_at"])
    return Alert.objects.filter(status=Alert.Status.OPEN).count()
