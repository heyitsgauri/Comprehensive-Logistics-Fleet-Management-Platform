from django.conf import settings
from django.db import models


class Role(models.TextChoices):
    ADMIN = "admin", "Administrator"
    FLEET_MANAGER = "fleet_manager", "Fleet Manager"
    COORDINATOR = "coordinator", "Logistics Coordinator"
    DRIVER = "driver", "Driver"


class Profile(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="profile",
    )
    role = models.CharField(
        max_length=20,
        choices=Role.choices,
        default=Role.COORDINATOR,
    )

    def __str__(self):
        return f"{self.user.username} ({self.role})"


class AuditEvent(models.Model):
    entity = models.CharField(max_length=30)
    entity_id = models.PositiveIntegerField()
    action = models.CharField(max_length=255)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [models.Index(fields=["entity", "entity_id"])]
