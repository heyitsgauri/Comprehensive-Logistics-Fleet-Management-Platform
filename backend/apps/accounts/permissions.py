from rest_framework.permissions import SAFE_METHODS, BasePermission

from .models import Role


def get_role(user):
    if not user or not user.is_authenticated:
        return None
    if user.is_superuser:
        return Role.ADMIN.value
    profile = getattr(user, "profile", None)
    return profile.role if profile else None


class RolePermission(BasePermission):
    """Allow authenticated reads; restrict writes to the roles declared by a view."""

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        if request.method in SAFE_METHODS:
            return True
        return get_role(request.user) in getattr(view, "write_roles", ())
