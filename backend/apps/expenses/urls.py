from django.urls import path
from rest_framework.routers import SimpleRouter

from .views import ExpenseViewSet, expense_summary

router = SimpleRouter()
router.register("expenses", ExpenseViewSet)

urlpatterns = [path("expenses/summary/", expense_summary)] + router.urls
