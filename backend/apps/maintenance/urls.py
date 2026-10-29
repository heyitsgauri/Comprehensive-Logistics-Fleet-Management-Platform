from rest_framework.routers import SimpleRouter

from .views import MaintenanceViewSet

router = SimpleRouter()
router.register("maintenance", MaintenanceViewSet)

urlpatterns = router.urls
