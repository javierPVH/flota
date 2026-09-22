from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role

from .helpers import make_user


class DriversEndpointTests(APITestCase):
    def setUp(self):
        self.supervisor = make_user("sup", Role.SUPERVISOR)
        self.driver = make_user("driver", Role.DRIVER)
        self.driver.first_name = "Ana"
        self.driver.save()
        self.admin = make_user("admin", Role.ADMIN)
        self.url = reverse("drivers")

    def test_management_lists_only_drivers(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get(self.url)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(len(resp.data), 1)
        self.assertEqual(resp.data[0]["name"], "Ana")

    def test_supervisor_sees_only_their_own_drivers(self):
        """AUTH-9: sin coches a su cargo, quien supervisa no ve el directorio."""
        self.client.force_authenticate(self.supervisor)
        resp = self.client.get(self.url)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data, [])

    def test_driver_forbidden(self):
        self.client.force_authenticate(self.driver)
        self.assertEqual(self.client.get(self.url).status_code, status.HTTP_403_FORBIDDEN)
