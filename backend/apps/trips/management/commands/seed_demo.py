from datetime import timedelta
from decimal import Decimal

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.accounts.models import Profile, Role
from apps.fleet.models import Driver, Vehicle
from apps.shipments.models import Customer, Shipment
from apps.trips.models import Trip

PASSWORD = "Demo@12345"
DELHI = ("Delhi Warehouse", 28.6139, 77.2090)
JAIPUR = ("Jaipur Hub", 26.9124, 75.7873)
AGRA = ("Agra Depot", 27.1767, 78.0081)
CHANDIGARH = ("Chandigarh Store", 30.7333, 76.7794)
LUCKNOW = ("Lucknow Centre", 26.8467, 80.9462)
GURUGRAM = ("Gurugram Plant", 28.4595, 77.0266)


class Command(BaseCommand):
    help = "Create repeatable demo data. Safe to run more than once."

    def handle(self, *args, **options):
        today = timezone.localdate()
        now = timezone.now()

        users = [
            ("admin", "Admin", "User", Role.ADMIN, True),
            ("manager", "Fleet", "Manager", Role.FLEET_MANAGER, False),
            ("coordinator", "Logistics", "Coordinator", Role.COORDINATOR, False),
            ("driver1", "Ravi", "Kumar", Role.DRIVER, False),
        ]
        for username, first, last, role, superuser in users:
            user, created = User.objects.get_or_create(
                username=username,
                defaults={
                    "first_name": first,
                    "last_name": last,
                    "is_staff": superuser,
                    "is_superuser": superuser,
                },
            )
            if created:
                user.set_password(PASSWORD)
                user.save()
            Profile.objects.update_or_create(user=user, defaults={"role": role})

        vehicles = [
            ("DL01AB1001", "Truck", "Tata", "Ultra 1918", 9000, "diesel", 48200, 300, "available"),
            ("DL01AB1002", "Truck", "Ashok Leyland", "Boss 1415", 14000, "diesel", 91500, 20, "available"),
            ("DL01AB1003", "Mini Truck", "Mahindra", "Jayo", 1500, "diesel", 22300, 250, "available"),
            ("DL01AB1004", "Van", "Maruti", "Eeco Cargo", 600, "petrol", 15400, 180, "available"),
            ("DL01AB1005", "Truck", "Eicher", "Pro 3015", 10000, "diesel", 66700, 200, "maintenance"),
            ("DL01AB1006", "Mini Truck", "Tata", "Ace Gold", 900, "cng", 30100, 330, "available"),
        ]
        for index, (reg, vtype, make, model, capacity, fuel, odometer, insurance_days, status) in enumerate(vehicles):
            Vehicle.objects.get_or_create(
                registration_number=reg,
                defaults={
                    "vehicle_type": vtype,
                    "make": make,
                    "model": model,
                    "capacity_kg": Decimal(capacity),
                    "fuel_type": fuel,
                    "odometer_km": odometer,
                    "status": status,
                    "insurance_expiry": today + timedelta(days=insurance_days),
                    "permit_expiry": today + timedelta(days=400),
                    "current_lat": DELHI[1] + 0.01 * index,
                    "current_lng": DELHI[2] + 0.01 * index,
                },
            )

        drivers = [
            ("Ravi Kumar", "9810000001", "DL0420190001", 700, "available"),
            ("Amit Singh", "9810000002", "DL0420190002", 15, "available"),
            ("Suresh Yadav", "9810000003", "DL0420190003", 900, "available"),
            ("Mohan Lal", "9810000004", "DL0420190004", 500, "off_duty"),
            ("Imran Khan", "9810000005", "DL0420190005", 650, "available"),
        ]
        for name, phone, license_number, days, status in drivers:
            Driver.objects.get_or_create(
                license_number=license_number,
                defaults={
                    "full_name": name,
                    "phone": phone,
                    "license_expiry": today + timedelta(days=days),
                    "status": status,
                },
            )

        customers = [
            ("Sharma Traders", "Anil Sharma", "9820000001", "Karol Bagh, Delhi"),
            ("FreshMart Retail", "Neha Gupta", "9820000002", "Sector 18, Noida"),
            ("BuildRight Supplies", "Vikram Rao", "9820000003", "MG Road, Gurugram"),
        ]
        customer_by_name = {}
        for name, contact, phone, address in customers:
            customer_by_name[name], _ = Customer.objects.get_or_create(
                name=name,
                defaults={
                    "contact_name": contact,
                    "phone": phone,
                    "address": address,
                },
            )

        if Shipment.objects.exists():
            self.stdout.write("Shipments already exist, skipping shipment/trip demo data.")
        else:
            def make(customer, source, destination, description, weight, deadline, status=Shipment.Status.PENDING):
                return Shipment.objects.create(
                    customer=customer_by_name[customer],
                    pickup_address=source[0],
                    pickup_lat=source[1],
                    pickup_lng=source[2],
                    delivery_address=destination[0],
                    delivery_lat=destination[1],
                    delivery_lng=destination[2],
                    cargo_description=description,
                    weight_kg=Decimal(weight),
                    deadline=deadline,
                    status=status,
                )

            vehicle = Vehicle.objects.get(registration_number="DL01AB1001")
            driver = Driver.objects.get(license_number="DL0420190001")
            history = [
                ("Sharma Traders", DELHI, JAIPUR, 6, 330, True),
                ("FreshMart Retail", DELHI, AGRA, 4, 240, True),
                ("BuildRight Supplies", GURUGRAM, LUCKNOW, 2, 520, False),
            ]
            for customer, source, destination, days_ago, minutes, on_time in history:
                started = now - timedelta(days=days_ago)
                finished = started + timedelta(minutes=minutes)
                shipment = make(
                    customer,
                    source,
                    destination,
                    "Palletised goods",
                    800,
                    finished + timedelta(hours=2 if on_time else -1),
                    Shipment.Status.DELIVERED,
                )
                Trip.objects.create(
                    shipment=shipment,
                    vehicle=vehicle,
                    driver=driver,
                    status=Trip.Status.COMPLETED,
                    distance_km=minutes * 0.8,
                    planned_duration_min=minutes,
                    started_at=started,
                    estimated_arrival=finished,
                    completed_at=finished,
                )

            make(
                "Sharma Traders",
                DELHI,
                JAIPUR,
                "Textile rolls",
                4200,
                now + timedelta(days=1),
            )
            make(
                "FreshMart Retail",
                DELHI,
                AGRA,
                "Packaged food cartons",
                1200,
                now + timedelta(hours=20),
            )
            make(
                "BuildRight Supplies",
                GURUGRAM,
                CHANDIGARH,
                "Steel fittings",
                8000,
                now + timedelta(days=2),
            )
            make(
                "Sharma Traders",
                DELHI,
                LUCKNOW,
                "Electronics",
                700,
                now - timedelta(hours=2),
            )

        self.stdout.write(
            self.style.SUCCESS(
                f"Demo data ready. Logins: admin / manager / coordinator / driver1, "
                f"password {PASSWORD}"
            )
        )
