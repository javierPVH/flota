"""N5 — catálogos Marca / Modelo (dependiente) / Sociedad (PLAN_EVOLUCION.md)."""

from django.db import IntegrityError
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import Brand, Company, Vehicle, VehicleModel

from .helpers import make_user


class CatalogModelTests(APITestCase):
    def test_model_requires_brand_and_is_unique_per_brand(self):
        brand = Brand.objects.create(name="Toyota")
        VehicleModel.objects.create(brand=brand, name="Corolla")
        with self.assertRaises(IntegrityError):
            VehicleModel.objects.create(brand=brand, name="Corolla")

    def test_company_code_unique(self):
        Company.objects.create(code="GS-ES", name="Gransolar España")
        with self.assertRaises(IntegrityError):
            Company.objects.create(code="GS-ES", name="Otra")


class CatalogApiTests(APITestCase):
    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.supervisor = make_user("sup", Role.SUPERVISOR)
        self.toyota = Brand.objects.create(name="Toyota")
        self.ford = Brand.objects.create(name="Ford")
        self.corolla = VehicleModel.objects.create(brand=self.toyota, name="Corolla")
        VehicleModel.objects.create(brand=self.ford, name="Transit")

    def test_model_create_requires_brand(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post(reverse("vehiclemodel-list"), {"name": "Yaris"})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("brand", resp.data["errors"])

    def test_models_filter_by_brand(self):
        # El desplegable dependiente del alta pide /vehicle-models/?brand=<id>.
        self.client.force_authenticate(self.supervisor)
        resp = self.client.get(reverse("vehiclemodel-list"), {"brand": self.toyota.pk})
        names = [m["name"] for m in resp.data["results"]]
        self.assertEqual(names, ["Corolla"])

    def test_supervisor_cannot_write_catalog(self):
        self.client.force_authenticate(self.supervisor)
        resp = self.client.post(reverse("brand-list"), {"name": "Seat"})
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_vehicle_create_with_refs_denormalizes_text(self):
        self.client.force_authenticate(self.admin)
        company = Company.objects.create(code="GS-ES", name="Gransolar España")
        resp = self.client.post(
            reverse("vehicle-list"),
            {
                "plate": "1234ABC",
                "brand_ref": self.toyota.pk,
                "model_ref": self.corolla.pk,
                "company": company.pk,
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        vehicle = Vehicle.objects.get(plate="1234ABC")
        self.assertEqual(vehicle.brand, "Toyota")
        self.assertEqual(vehicle.model, "Corolla")
        self.assertEqual(resp.data["company_display"], "GS-ES · Gransolar España")

    def test_vehicle_rejects_model_of_other_brand(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post(
            reverse("vehicle-list"),
            {"plate": "1234ABC", "brand_ref": self.ford.pk, "model_ref": self.corolla.pk},
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("model_ref", resp.data["errors"])

    def test_vehicle_create_with_legacy_text_still_works(self):
        # Transición: el alta con texto libre sigue funcionando (p. ej. seeds).
        self.client.force_authenticate(self.admin)
        resp = self.client.post(
            reverse("vehicle-list"), {"plate": "5678XYZ", "brand": "Seat", "model": "León"}
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)

    def test_brand_with_models_is_protected(self):
        # PROTECT: no se puede borrar una marca con modelos colgando.
        from django.db.models import ProtectedError

        with self.assertRaises(ProtectedError):
            self.toyota.delete()
        self.assertTrue(Brand.objects.filter(pk=self.toyota.pk).exists())
