from django.contrib.auth import authenticate, logout as django_logout
from rest_framework.authtoken.models import Token
from rest_framework.decorators import (
    api_view,
    authentication_classes,
    permission_classes,
)
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from .models import AuditEvent
from .permissions import get_role


def user_payload(user):
    return {
        "id": user.id,
        "username": user.username,
        "full_name": user.get_full_name() or user.username,
        "role": get_role(user),
    }


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
def login(request):
    user = authenticate(
        username=request.data.get("username"),
        password=request.data.get("password"),
    )
    if user is None:
        return Response({"detail": "Invalid username or password."}, status=400)
    token, _ = Token.objects.get_or_create(user=user)
    return Response({"token": token.key, "user": user_payload(user)})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def me(request):
    return Response(user_payload(request.user))


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def logout(request):
    if request.auth is not None and hasattr(request.auth, "delete"):
        request.auth.delete()
    else:
        django_logout(request)
    return Response(status=204)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def audit(request):
    events = AuditEvent.objects.select_related("user")
    entity = request.query_params.get("entity")
    entity_id = request.query_params.get("entity_id", "")
    if entity:
        events = events.filter(entity=entity)
    if entity_id.isdigit():
        events = events.filter(entity_id=entity_id)
    return Response(
        [
            {
                "id": event.id,
                "action": event.action,
                "user": (
                    event.user.get_full_name() or event.user.username
                    if event.user
                    else None
                ),
                "created_at": event.created_at,
            }
            for event in events[:200]
        ]
    )
