"""Rol **HSE** (`hse`): solo lectura de la flota en gestión, nada de personas.

Lo que se prueba aquí es el CONTRATO del rol en `accounts`: el valor del
enumerado, los helpers del usuario, lo que viaja en `/auth/me/`, el permiso
`HseReadOnly` y que los endpoints de personas (`/auth/users/`,
`/auth/drivers/`) le quedan cerrados. Lo que HSE lee de la flota se prueba en
`fleet/tests/test_hse_readonly.py`.
"""

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIRequestFactory, APITestCase

from accounts.models import Role, UserRole
from accounts.permissions import HseReadOnly, IsManagement

User = get_user_model()


def make_user(username, *roles):
    user = User.objects.create_user(username=username, password="test-pass-123")
    for role in roles:
        UserRole.objects.create(user=user, role=role)
    return user


class HseRoleModelTests(APITestCase):
    def test_role_value_and_helpers(self):
        self.assertEqual(Role.HSE, "hse")
        self.assertIn(("hse", "HSE"), Role.choices)
        hse = make_user("hse", Role.HSE)
        self.assertTrue(hse.is_hse)
        self.assertFalse(hse.is_admin)
        self.assertFalse(hse.is_supervisor)
        self.assertFalse(hse.is_driver)
        # HSE NO es gestión: `is_management` no cambia.
        self.assertFalse(hse.is_management)
        self.assertEqual(hse.role_values, {"hse"})

    def test_roles_add_up(self):
        admin_hse = make_user("admin_hse", Role.ADMIN, Role.HSE)
        self.assertTrue(admin_hse.is_admin)
        self.assertTrue(admin_hse.is_hse)
        self.assertTrue(admin_hse.is_management)
        driver_hse = make_user("driver_hse", Role.DRIVER, Role.HSE)
        self.assertTrue(driver_hse.is_driver)
        self.assertTrue(driver_hse.is_hse)
        self.assertFalse(driver_hse.is_management)

    def test_me_includes_hse(self):
        hse = make_user("hse", Role.HSE)
        self.client.force_authenticate(hse)
        resp = self.client.get(reverse("me"))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["roles"], ["hse"])
        admin_hse = make_user("admin_hse", Role.ADMIN, Role.HSE)
        self.client.force_authenticate(admin_hse)
        self.assertEqual(self.client.get(reverse("me")).data["roles"], ["admin", "hse"])


class HseReadOnlyPermissionTests(APITestCase):
    """`HseReadOnly` vale solo con métodos seguros y solo para HSE."""

    def setUp(self):
        self.factory = APIRequestFactory()
        self.hse = make_user("hse", Role.HSE)
        self.driver = make_user("driver", Role.DRIVER)

    def _allowed(self, permission, user, method) -> bool:
        request = getattr(self.factory, method)("/x/")
        request.user = user
        return permission().has_permission(request, view=None)

    def test_safe_methods_only_for_hse(self):
        for method in ("get", "head", "options"):
            with self.subTest(method=method):
                self.assertTrue(self._allowed(HseReadOnly, self.hse, method))
                self.assertFalse(self._allowed(HseReadOnly, self.driver, method))
        for method in ("post", "put", "patch", "delete"):
            with self.subTest(method=method):
                self.assertFalse(self._allowed(HseReadOnly, self.hse, method))

    def test_is_management_does_not_include_hse(self):
        # El candado de todo lo que NO se le abre a HSE: si esto cambiara,
        # se abrirían `/auth/drivers/`, las bandejas y las escrituras.
        self.assertFalse(self._allowed(IsManagement, self.hse, "get"))


class HseAccountsEndpointsTests(APITestCase):
    """Nada de personas: ni la gestión de usuarios ni el desplegable de conductores."""

    def setUp(self):
        self.hse = make_user("hse", Role.HSE)
        self.admin_hse = make_user("admin_hse", Role.ADMIN, Role.HSE)
        self.driver = make_user("driver", Role.DRIVER)

    def test_users_api_is_closed_to_hse(self):
        self.client.force_authenticate(self.hse)
        self.assertEqual(
            self.client.get(reverse("user-list")).status_code, status.HTTP_403_FORBIDDEN
        )
        self.assertEqual(
            self.client.get(reverse("user-detail", args=[self.driver.pk])).status_code,
            status.HTTP_403_FORBIDDEN,
        )
        resp = self.client.post(
            reverse("user-list"), {"username": "x", "roles": ["driver"]}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_drivers_list_is_closed_to_hse(self):
        self.client.force_authenticate(self.hse)
        self.assertEqual(self.client.get(reverse("drivers")).status_code, status.HTTP_403_FORBIDDEN)

    def test_admin_with_hse_keeps_everything(self):
        self.client.force_authenticate(self.admin_hse)
        self.assertEqual(self.client.get(reverse("user-list")).status_code, status.HTTP_200_OK)
        self.assertEqual(self.client.get(reverse("drivers")).status_code, status.HTTP_200_OK)

    def test_admin_can_grant_the_role(self):
        self.client.force_authenticate(self.admin_hse)
        resp = self.client.post(
            reverse("user-list"),
            {"username": "prevencion", "email": "prev@example.com", "roles": ["hse"]},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(resp.data["roles"], ["hse"])
        self.assertTrue(User.objects.get(username="prevencion").is_hse)
