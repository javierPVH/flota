"""Importación masiva de usuarios/conductores (IMPORTACION_MASIVA.md)."""

import json

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role, UserRole

User = get_user_model()


def make_user(username, *roles):
    user = User.objects.create_user(username=username, password="test-pass-123")
    for role in roles:
        UserRole.objects.create(user=user, role=role)
    return user


def csv_file(text: str, name: str = "conductores.csv") -> SimpleUploadedFile:
    return SimpleUploadedFile(name, text.encode("utf-8"), content_type="text/csv")


class UserBulkImportTests(APITestCase):
    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.client.force_authenticate(self.admin)

    def test_detect_columns_auto_maps(self):
        resp = self.client.post(
            reverse("user-detect-columns"),
            {"file": csv_file("Email;Nombre;Apellidos;Roles\na@b.com;Ana;García;conductor\n")},
            format="multipart",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        mapping = resp.data["auto_mapping"]
        self.assertEqual(mapping["email"], 0)
        self.assertEqual(mapping["first_name"], 1)
        self.assertEqual(mapping["last_name"], 2)
        self.assertEqual(mapping["roles"], 3)

    def test_preview_and_bulk_create_roundtrip(self):
        text = (
            "Email;Nombre;Apellidos;Roles;Carné\n"
            "ana.import@example.com;Ana;García;conductor, supervisor;B\n"
            "admin@example.com;Otro;Usuario;conductor;B\n"  # username 'admin' NO choca (email≠username)
            ";Sin;Email;conductor;B\n"  # email obligatorio
        )
        mapping = {"email": 0, "first_name": 1, "last_name": 2, "roles": 3, "license_type": 4}
        resp = self.client.post(
            reverse("user-preview-import"),
            {"file": csv_file(text), "mapping": json.dumps(mapping)},
            format="multipart",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["ready_count"], 2)
        self.assertEqual(resp.data["warnings"]["data_errors"][0]["field"], "email")
        record = resp.data["records"][0]
        self.assertEqual(record["username"], "ana.import@example.com")  # email como username
        self.assertEqual(record["roles"], ["driver", "supervisor"])
        self.assertEqual(record["license_type"], "B")

        bulk = self.client.post(
            reverse("user-bulk-create"), {"rows": resp.data["records"]}, format="json"
        )
        self.assertEqual(bulk.status_code, status.HTTP_200_OK)
        self.assertEqual(bulk.data["created"], 2)
        created = User.objects.get(username="ana.import@example.com")
        self.assertEqual(sorted(created.role_values), ["driver", "supervisor"])
        self.assertFalse(created.has_usable_password())  # sin contraseña → Google/admin

    def test_preview_flags_existing_username_and_dni(self):
        existing = make_user("ana@example.com", Role.DRIVER)
        existing.dni = "12345678Z"
        existing.save(update_fields=["dni"])
        text = (
            "Email;Nombre;Apellidos;DNI\n"
            "ana@example.com;Ana;García;\n"  # username (email) ya existe
            "otra@example.com;Otra;Pérez;12345678z\n"  # dni ya existe (insensible)
        )
        resp = self.client.post(
            reverse("user-preview-import"),
            {
                "file": csv_file(text),
                "mapping": json.dumps({"email": 0, "first_name": 1, "last_name": 2, "dni": 3}),
            },
            format="multipart",
        )
        self.assertEqual(resp.data["ready_count"], 0)
        fields = {e["field"] for e in resp.data["warnings"]["data_errors"]}
        self.assertIn("usuario", fields)
        self.assertIn("dni", fields)

    def test_bulk_import_requires_admin(self):
        driver = make_user("driver1", Role.DRIVER)
        self.client.force_authenticate(driver)
        resp = self.client.post(
            reverse("user-detect-columns"),
            {"file": csv_file("Email\nx@y.com\n")},
            format="multipart",
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
