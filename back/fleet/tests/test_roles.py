from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from accounts.models import Role

from .helpers import make_user

User = get_user_model()


class RoleModelTests(APITestCase):
    def test_multi_role_and_helpers(self):
        u = make_user("mix", Role.SUPERVISOR, Role.DRIVER)
        self.assertTrue(u.is_supervisor)
        self.assertTrue(u.is_driver)
        self.assertTrue(u.is_management)  # supervisor cuenta como gestión
        self.assertFalse(u.is_admin)
        self.assertEqual(u.role_values, {"supervisor", "driver"})

    def test_superuser_is_admin(self):
        su = User.objects.create_superuser("root", "r@x.com", "test-pass-123")
        self.assertTrue(su.is_admin)
        self.assertTrue(su.is_management)
