"""Auditoría de ciberseguridad (2026-09-21), fase 1 y 2 del backend.

AUTH-1 (campos de Drive y estado del documento), AUTH-2 (destinatarios
externos), AUTH-9 (reparto acotado), AUTH-11 (comunicados de gestión),
INP-2 (techo del JSON libre), INP-3 (firma del fichero), INP-6 (`verify`
con id no numérico) y FE-5 (saneado del HTML de plantillas).
"""

from datetime import date

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import Assignment, Document, Vehicle
from fleet.models.enums import AssignmentStatus, DocumentStatus
from fleet.serializers import file_signature_matches, limit_json_payload, sanitize_email_html

from .helpers import make_user

PDF = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj\n"
JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00" + b"\x00" * 8
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 8
WEBP = b"RIFF\x00\x00\x00\x00WEBPVP8 "
HEIC = b"\x00\x00\x00\x18ftypheic\x00\x00\x00\x00"


def _pdf(name="doc.pdf", content=PDF):
    return SimpleUploadedFile(name, content, content_type="application/pdf")


def _errors(resp) -> dict:
    """El manejador de errores envuelve los de validación en `errors`."""
    data = resp.data
    return data.get("errors", data) if isinstance(data, dict) else data


class Auth1DocumentWriteFieldsTests(APITestCase):
    """AUTH-1: `drive_file_id` solo lo escribe el archivador; `status`, la gestión."""

    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.driver = make_user("driver", Role.DRIVER)
        self.vehicle = Vehicle.objects.create(plate="1234ABC", brand="a", model="b")
        Assignment.objects.create(
            vehicle=self.vehicle,
            driver=self.driver,
            start_date=date(2026, 1, 1),
            status=AssignmentStatus.ACCEPTED,
        )
        self.url = reverse("document-list")

    def _post(self, user, **extra):
        self.client.force_authenticate(user)
        return self.client.post(
            self.url,
            {"vehicle": self.vehicle.pk, "type": "other", "file": _pdf(), **extra},
            format="multipart",
        )

    def test_auth1_driver_cannot_point_a_document_at_a_foreign_drive_file(self):
        resp = self._post(self.driver, drive_file_id="1AbCdEfAjeno", status=DocumentStatus.VALID)
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        doc = Document.objects.get(pk=resp.data["id"])
        self.assertEqual(doc.drive_file_id, "")
        self.assertNotEqual(doc.status, DocumentStatus.VALID)

    def test_auth1_not_even_an_admin_sets_drive_file_id_by_api(self):
        resp = self._post(self.admin, drive_file_id="1AbCdEfAjeno")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(Document.objects.get(pk=resp.data["id"]).drive_file_id, "")

    def test_auth1_driver_cannot_patch_a_document_at_all(self):
        """El PATCH de un conductor lo corta ya el permiso; el alta era la puerta."""
        doc = Document.objects.create(
            vehicle=self.vehicle,
            type="other",
            drive_url="https://drive.google.com/x",
            uploaded_by=self.driver,
            status=DocumentStatus.PENDING_ARCHIVE,
        )
        self.client.force_authenticate(self.driver)
        resp = self.client.patch(
            reverse("document-detail", args=[doc.pk]),
            {"status": DocumentStatus.VALID, "drive_file_id": "otro"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        doc.refresh_from_db()
        self.assertEqual(doc.status, DocumentStatus.PENDING_ARCHIVE)
        self.assertEqual(doc.drive_file_id, "")

    def test_auth1_supervisor_patch_of_drive_file_id_is_ignored(self):
        sup = make_user("sup", Role.SUPERVISOR)
        self.vehicle.supervisor = sup
        self.vehicle.save(update_fields=["supervisor"])
        doc = Document.objects.create(
            vehicle=self.vehicle,
            type="other",
            drive_url="https://drive.google.com/x",
            uploaded_by=sup,
            status=DocumentStatus.PENDING_ARCHIVE,
        )
        self.client.force_authenticate(sup)
        resp = self.client.patch(
            reverse("document-detail", args=[doc.pk]),
            {"drive_file_id": "otro", "notes": "nota"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        doc.refresh_from_db()
        self.assertEqual(doc.drive_file_id, "")
        self.assertEqual(doc.notes, "nota")


class Inp3FileSignatureTests(APITestCase):
    """INP-3: la extensión la pone quien sube; la firma la pone el fichero."""

    def setUp(self):
        self.driver = make_user("driver", Role.DRIVER)
        self.vehicle = Vehicle.objects.create(plate="1234ABC", brand="a", model="b")
        Assignment.objects.create(
            vehicle=self.vehicle,
            driver=self.driver,
            start_date=date(2026, 1, 1),
            status=AssignmentStatus.ACCEPTED,
        )
        self.client.force_authenticate(self.driver)

    def test_inp3_html_renamed_to_pdf_is_rejected(self):
        resp = self.client.post(
            reverse("document-list"),
            {
                "vehicle": self.vehicle.pk,
                "type": "other",
                "file": _pdf(content=b"<html><script>alert(1)</script></html>"),
            },
            format="multipart",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("file", _errors(resp))

    def test_inp3_real_pdf_passes(self):
        resp = self.client.post(
            reverse("document-list"),
            {"vehicle": self.vehicle.pk, "type": "other", "file": _pdf()},
            format="multipart",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)

    def test_inp3_signatures_per_extension(self):
        casos = [
            ("jpg", JPEG, True),
            ("jpeg", JPEG, True),
            ("png", PNG, True),
            ("webp", WEBP, True),
            ("heic", HEIC, True),
            ("pdf", PDF, True),
            ("jpg", PNG, False),
            ("png", JPEG, False),
            ("pdf", b"MZ\x90\x00", False),
            ("webp", b"RIFF\x00\x00\x00\x00WAVEfmt ", False),
            ("heic", b"\x00\x00\x00\x18ftypmp42", False),
            ("exe", b"MZ\x90\x00\x03", False),
        ]
        for ext, content, esperado in casos:
            with self.subTest(ext=ext):
                f = SimpleUploadedFile(f"a.{ext}", content)
                f.read(3)  # el puntero no tiene por qué estar al principio
                self.assertIs(file_signature_matches(f, ext), esperado)
                self.assertEqual(f.tell(), 3)  # y se deja donde estaba


class Inp2JsonPayloadTests(SimpleTestCase):
    """INP-2: el JSON libre de partes y peticiones tiene techo."""

    def test_inp2_normal_accident_report_passes(self):
        limit_json_payload(
            {
                "report_version": 1,
                "third_parties": [{"name": "A", "plate": "1111AAA"}] * 5,
                "injured_people": [{"name": "B"}] * 3,
                "description": "x" * 1000,
            },
            field="details",
        )

    def test_inp2_too_many_list_items(self):
        with self.assertRaises(ValidationError):
            limit_json_payload({"third_parties": [{"n": 1}] * 21}, field="details")

    def test_inp2_text_too_long(self):
        with self.assertRaises(ValidationError):
            limit_json_payload({"description": "x" * 4001}, field="details")

    def test_inp2_too_deep(self):
        nodo: dict = {}
        raiz = nodo
        for _ in range(8):
            nodo["a"] = {}
            nodo = nodo["a"]
        with self.assertRaises(ValidationError):
            limit_json_payload(raiz, field="details")

    def test_inp2_total_size(self):
        with self.assertRaises(ValidationError):
            limit_json_payload({f"k{i}": "x" * 3000 for i in range(30)}, field="details")


class Inp2IncidentDetailsTests(APITestCase):
    def test_inp2_incident_details_go_through_the_limit(self):
        from fleet.serializers import IncidentSerializer

        vehicle = Vehicle.objects.create(plate="1234ABC", brand="a", model="b")
        s = IncidentSerializer(
            data={
                "vehicle": vehicle.pk,
                "type": "general",
                "description": "hola",
                "details": {"lista": list(range(50))},
            }
        )
        self.assertFalse(s.is_valid())
        self.assertIn("details", s.errors)


class Inp6VerifyTests(APITestCase):
    def test_inp6_non_numeric_id_is_a_400_not_a_500(self):
        self.client.force_authenticate(make_user("admin", Role.ADMIN))
        resp = self.client.post(reverse("document-verify"), {"vehicle": "abc"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("vehicle", _errors(resp))


class Auth9SplitScopeTests(APITestCase):
    """AUTH-9: quien supervisa reparte entre SU gente, no entre toda la empresa."""

    def setUp(self):
        self.sup = make_user("sup", Role.SUPERVISOR)
        self.mine = make_user("mine", Role.DRIVER)
        self.other = make_user("other", Role.DRIVER)
        self.vehicle = Vehicle.objects.create(
            plate="5678BCD", brand="a", model="b", supervisor=self.sup
        )
        Assignment.objects.create(
            vehicle=self.vehicle,
            driver=self.mine,
            start_date=date(2026, 1, 1),
            status=AssignmentStatus.ACCEPTED,
        )
        self.client.force_authenticate(self.sup)

    def _split(self, driver):
        return self.client.post(
            reverse("vehicleusage-set"),
            {
                "vehicle": self.vehicle.pk,
                "start_date": "2026-08-01",
                "items": [{"driver": driver.pk, "usage_percent": "100"}],
            },
            format="json",
        )

    def test_auth9_driver_outside_scope_is_forbidden(self):
        self.assertEqual(self._split(self.other).status_code, status.HTTP_403_FORBIDDEN)

    def test_auth9_own_driver_is_fine(self):
        self.assertEqual(self._split(self.mine).status_code, status.HTTP_201_CREATED)


class Auth11NotifyTests(APITestCase):
    """AUTH-11: asunto, cuerpo y destinatarios privilegiados, solo administración."""

    def setUp(self):
        self.sup = make_user("sup", Role.SUPERVISOR)
        self.sup.email = "sup@gransolar.com"
        self.sup.save(update_fields=["email"])
        self.vehicle = Vehicle.objects.create(
            plate="5678BCD", brand="a", model="b", supervisor=self.sup
        )
        self.url = reverse("vehicle-notify", args=[self.vehicle.pk])
        self.client.force_authenticate(self.sup)

    def test_auth11_supervisor_cannot_write_to_all_admins(self):
        resp = self.client.post(self.url, {"message": "hola", "to_admin": True})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_auth11_supervisor_cannot_write_to_renting(self):
        resp = self.client.post(self.url, {"message": "hola", "to_renting": True})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_auth11_supervisor_cannot_set_free_subject_or_body(self):
        for extra in ({"subject": "URGENTE: cambio de cuenta"}, {"body": "<p>x</p>"}):
            with self.subTest(extra=extra):
                resp = self.client.post(
                    self.url, {"message": "hola", "to_supervisor": True, **extra}
                )
                self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    @override_settings(
        FLEET_EMAIL_ENABLED=True, EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend"
    )
    def test_auth11_supervisor_still_writes_to_their_vehicle_people(self):
        resp = self.client.post(self.url, {"message": "hola", "to_supervisor": True})
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)


@override_settings(FLEET_EMAIL_ALLOWED_DOMAINS=["gransolar.com"])
class Auth2ExternalRecipientsTests(APITestCase):
    """AUTH-2: informes con datos personales solo a dominios corporativos salvo admin."""

    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.sup = make_user("sup", Role.SUPERVISOR)
        self.url = reverse("notificationschedule-list")

    def _post(self, user, **extra):
        self.client.force_authenticate(user)
        return self.client.post(
            self.url,
            {
                "name": "Usuarios",
                "content": "summary",
                "frequency": "daily",
                "send_at": "07:00",
                "send_email": True,
                **extra,
            },
        )

    def test_auth2_supervisor_external_domain_is_rejected(self):
        resp = self._post(self.sup, extra_recipients="alguien@externo.com")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST, resp.data)
        self.assertIn("extra_recipients", _errors(resp))

    def test_auth2_supervisor_corporate_domain_is_fine(self):
        resp = self._post(self.sup, extra_recipients="alguien@gransolar.com, Otro@GRANSOLAR.com")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)

    def test_auth2_admin_may_add_external_recipients(self):
        resp = self._post(self.admin, extra_recipients="alguien@externo.com")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)

    def test_auth2_supervisor_cannot_choose_the_drive_folder(self):
        resp = self._post(self.sup, drive_folder="1CarpetaCualquiera")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST, resp.data)
        self.assertIn("drive_folder", _errors(resp))


class Fe5EmailHtmlTests(SimpleTestCase):
    """FE-5: el HTML de plantillas sin `style` peligroso ni imágenes por http."""

    def test_fe5_http_image_is_dropped_https_is_kept(self):
        out = sanitize_email_html('<img src="http://x/pixel.gif"><img src="https://x/logo.png">')
        self.assertNotIn("http://x/pixel.gif", out)
        self.assertIn("https://x/logo.png", out)

    def test_fe5_style_is_reduced_to_the_allowlist(self):
        out = sanitize_email_html(
            '<p style="color: #c00; background: url(http://x/a); position: fixed">Hola</p>'
        )
        self.assertIn("color: #c00", out)
        self.assertNotIn("url(", out)
        self.assertNotIn("position", out)

    def test_fe5_links_open_without_opener(self):
        out = sanitize_email_html('<a href="https://x" target="_blank">x</a>')
        self.assertIn("noopener", out)
        self.assertIn("noreferrer", out)


class Inp7PlateNormalizationTests(APITestCase):
    """INP-7: el validador de matrícula no puede rechazar lo que se teclea en minúsculas."""

    def test_inp7_plate_is_normalized_before_validation(self):
        self.client.force_authenticate(make_user("admin", Role.ADMIN))
        resp = self.client.post(
            reverse("vehicle-list"),
            {"plate": " 1234 abc ", "brand": "Seat", "model": "León"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(resp.data["plate"], "1234ABC")

    def test_inp7_path_traversal_plate_is_rejected(self):
        self.client.force_authenticate(make_user("admin", Role.ADMIN))
        resp = self.client.post(
            reverse("vehicle-list"),
            {"plate": "../../fuera", "brand": "Seat", "model": "León"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("plate", _errors(resp))
