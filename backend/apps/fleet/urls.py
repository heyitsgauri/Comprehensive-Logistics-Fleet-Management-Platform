from rest_framework.routers import SimpleRouter

from .views import DriverViewSet, VehicleViewSet

router = SimpleRouter()
router.register("vehicles", VehicleViewSet)
router.register("drivers", DriverViewSet)

urlpatterns = router.urls
