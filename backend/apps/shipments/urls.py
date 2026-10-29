from django.urls import path
from rest_framework.routers import SimpleRouter

from .views import (
    CustomerViewSet,
    DispatchRequestViewSet,
    ShipmentViewSet,
    WarehouseViewSet,
    driver_token_portal,
)

router = SimpleRouter()
router.register("customers", CustomerViewSet)
router.register("warehouses", WarehouseViewSet)
router.register("shipments", ShipmentViewSet)
router.register("dispatches", DispatchRequestViewSet, basename="dispatch")

urlpatterns = router.urls + [
    path("driver/portal/", driver_token_portal, name="driver-portal"),
]
