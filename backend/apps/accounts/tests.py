from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from .models import Profile, Role


class AuthenticationTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="driver",
            password="test-pass",
        )
        Profile.objects.create(user=self.user, role=Role.DRIVER)

    def test_token_login_and_logout(self):
        client = APIClient()
        response = client.post(
            "/api/v1/auth/login/",
            {"username": "driver", "password": "test-pass"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        client.credentials(
            HTTP_AUTHORIZATION=f"Token {response.data['token']}"
        )
        self.assertEqual(client.get("/api/v1/auth/me/").data["role"], Role.DRIVER)
        self.assertEqual(client.post("/api/v1/auth/logout/").status_code, 204)
        self.assertEqual(client.get("/api/v1/auth/me/").status_code, 401)

    def test_session_logout(self):
        client = APIClient()
        client.force_login(self.user)

        self.assertEqual(client.get("/api/v1/auth/me/").status_code, 200)
        self.assertEqual(client.post("/api/v1/auth/logout/").status_code, 204)
        self.assertEqual(client.get("/api/v1/auth/me/").status_code, 401)
