"""Tests de la API de gestión de usuarios (HU-2.6, Fase A1) — /api/v1/auth/users/."""

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role, User, UserRole


def make_user(username, *roles):
    user = User.objects.create_user(username=username, password="test-pass-123")
    for role in roles:
        UserRole.objects.create(user=user, role=role)
    return user


class UsersApiTests(APITestCase):
    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.supervisor = make_user("sup", Role.SUPERVISOR)
        self.list_url = reverse("user-list")

    def test_admin_creates_driver_with_data(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post(
            self.list_url,
            {
                "username": "carlos",
                "first_name": "Carlos",
                "dni": "12345678Z",
                "license_type": "B",
                "fuel_card": True,
                "roles": [Role.DRIVER],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        user = User.objects.get(username="carlos")
        self.assertEqual(set(user.role_values), {Role.DRIVER})
        self.assertTrue(user.fuel_card)
        self.assertFalse(user.has_usable_password())  # sin password → inutilizable

    def test_create_without_roles_defaults_to_driver(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post(self.list_url, {"username": "ana"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(set(User.objects.get(username="ana").role_values), {Role.DRIVER})

    def test_update_syncs_roles(self):
        target = make_user("mixto", Role.DRIVER)
        self.client.force_authenticate(self.admin)
        resp = self.client.patch(
            reverse("user-detail", args=[target.pk]),
            {"roles": [Role.DRIVER, Role.SUPERVISOR]},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        target = User.objects.get(pk=target.pk)
        self.assertEqual(set(target.role_values), {Role.DRIVER, Role.SUPERVISOR})

    def test_delete_deactivates_instead_of_removing(self):
        target = make_user("baja", Role.DRIVER)
        self.client.force_authenticate(self.admin)
        resp = self.client.delete(reverse("user-detail", args=[target.pk]))
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)
        target.refresh_from_db()  # sigue existiendo (histórico intacto)
        self.assertFalse(target.is_active)
        # Y ya no sale en el desplegable de asignación.
        drivers = self.client.get(reverse("drivers")).data
        self.assertNotIn("baja", [d["username"] for d in drivers])

    def test_admin_cannot_deactivate_self(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.delete(reverse("user-detail", args=[self.admin.pk]))
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        patch = self.client.patch(
            reverse("user-detail", args=[self.admin.pk]), {"is_active": False}, format="json"
        )
        self.assertEqual(patch.status_code, status.HTTP_400_BAD_REQUEST)

    def test_admin_cannot_drop_own_admin_role(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.patch(
            reverse("user-detail", args=[self.admin.pk]), {"roles": [Role.DRIVER]}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_users_api_is_admin_only(self):
        self.client.force_authenticate(self.supervisor)
        self.assertEqual(self.client.get(self.list_url).status_code, status.HTTP_403_FORBIDDEN)

    def test_password_is_validated_and_set(self):
        self.client.force_authenticate(self.admin)
        weak = self.client.post(self.list_url, {"username": "p1", "password": "123"}, format="json")
        self.assertEqual(weak.status_code, status.HTTP_400_BAD_REQUEST)
        ok = self.client.post(
            self.list_url, {"username": "p2", "password": "correcto-y-largo-99"}, format="json"
        )
        self.assertEqual(ok.status_code, status.HTTP_201_CREATED)
        self.assertTrue(User.objects.get(username="p2").check_password("correcto-y-largo-99"))
