from django.urls import path
from rest_framework.routers import SimpleRouter

from .views import (
    TripViewSet,
    assignment_options,
    eligible,
    geocode_view,
    live_fleet,
    route_preview,
    summary,
)

router = SimpleRouter()
router.register("trips", TripViewSet)

urlpatterns = [
    path("routes/preview/", route_preview),
    path("geocode/", geocode_view),
    path("assignment/options/", assignment_options),
    path("shipments/<int:pk>/eligible/", eligible),
    path("fleet/live/", live_fleet),
    path("analytics/summary/", summary),
] + router.urls
