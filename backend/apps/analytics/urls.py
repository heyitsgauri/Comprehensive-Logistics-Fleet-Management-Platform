from django.urls import path

from . import views

urlpatterns = [
    path("trends/", views.trends),
    path("export/", views.export_csv),
]
