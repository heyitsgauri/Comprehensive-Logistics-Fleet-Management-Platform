from django.contrib import admin
from django.urls import include, path

from config.views import health

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/health/", health),
    path("api/v1/auth/", include("apps.accounts.urls")),
    path("api/v1/", include("apps.fleet.urls")),
    path("api/v1/", include("apps.shipments.urls")),
    path("api/v1/", include("apps.trips.urls")),
    path("api/v1/", include("apps.maintenance.urls")),
    path("api/v1/", include("apps.expenses.urls")),
    path("api/v1/", include("apps.alerts.urls")),
    path("api/v1/analytics/", include("apps.analytics.urls")),
]