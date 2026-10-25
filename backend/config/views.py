from django.db import connection
from rest_framework.decorators import api_view
from rest_framework.response import Response


@api_view(["GET"])
def health(request):
    """Confirms the API is up and can query PostgreSQL."""
    with connection.cursor() as cursor:
        cursor.execute("SELECT current_database(), version()")
        db_name, version = cursor.fetchone()
    return Response({
        "status": "ok",
        "database": db_name,
        "postgres_version": version.split(",")[0],
    })