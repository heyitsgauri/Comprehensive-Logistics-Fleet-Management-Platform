from .models import AuditEvent


def log_event(user, entity, entity_id, action):
    AuditEvent.objects.create(
        entity=entity,
        entity_id=entity_id,
        action=action,
        user=user if getattr(user, "is_authenticated", False) else None,
    )
