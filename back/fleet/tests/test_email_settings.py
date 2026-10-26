"""Ajustes del correo (Ajustes → Correo): calendario del recordatorio de km,
maquetación corporativa y su API."""

from datetime import date

from django.core import mail
from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import Alert, EmailSettings, EmailTemplate, EmailTemplateKey, Vehicle
from fleet.models.enums import AlertType
from fleet.services import alerts, email_layout, mailer

from .helpers import make_user

PNG_1PX = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00"
    b"\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n\x2d\xb4"
    b"\x00\x00\x00\x00IEND\xaeB`\x82"
)


class KmRemindScheduleTests(TestCase):
    def cfg(self, **kw):
        c = EmailSettings.get_solo()
        for k, v in kw.items():
            setattr(c, k, v)
        c.save()
        return c

    def test_defaults_come_from_the_environment(self):
        c = EmailSettings.get_solo()
        self.assertEqual(
            (c.km_remind_from_day, c.km_remind_until_day, c.km_remind_emails), (20, 5, 2)
        )

    def test_two_emails_open_and_close_the_window(self):
        c = self.cfg()
        self.assertEqual(
            email_layout.km_remind_schedule(date(2026, 10, 1), c),
            [date(2026, 10, 20), date(2026, 11, 5)],
        )

    def test_emails_are_spread_evenly(self):
        c = self.cfg(km_remind_emails=3)
        self.assertEqual(
            email_layout.km_remind_schedule(date(2026, 10, 1), c),
            [date(2026, 10, 20), date(2026, 10, 28), date(2026, 11, 5)],
        )

    def test_window_without_tail_ends_at_month_end(self):
        c = self.cfg(km_remind_until_day=0, km_remind_emails=2)
        self.assertEqual(
            email_layout.km_remind_schedule(date(2026, 2, 1), c),
            [date(2026, 2, 20), date(2026, 2, 28)],
        )

    def test_short_window_never_repeats_a_date(self):
        c = self.cfg(km_remind_from_day=28, km_remind_until_day=0, km_remind_emails=6)
        fechas = email_layout.km_remind_schedule(date(2026, 2, 1), c)
        self.assertEqual(fechas, [date(2026, 2, 28)])

    def test_period_follows_the_configured_window(self):
        c = self.cfg(km_remind_from_day=15, km_remind_until_day=10)
        self.assertEqual(email_layout.km_remind_period(date(2026, 10, 15), c), date(2026, 10, 1))
        self.assertEqual(email_layout.km_remind_period(date(2026, 11, 10), c), date(2026, 10, 1))
        self.assertIsNone(email_layout.km_remind_period(date(2026, 11, 11), c))

    @override_settings(FLEET_EMAIL_ENABLED=True)
    def test_three_rounds_send_three_emails_at_their_dates(self):
        from fleet.models import Assignment, EmailOutbox

        self.cfg(km_remind_emails=3)
        driver = make_user("km-rounds", Role.DRIVER)
        driver.email = "km-rounds@flota.dev"
        driver.save(update_fields=["email"])
        vehicle = Vehicle.objects.create(plate="KMR1", brand="a", model="b")
        Assignment.objects.create(
            vehicle=vehicle, driver=driver, start_date=date(2026, 1, 1), status="accepted"
        )
        for d in (20, 21, 27, 28, 28, 31):
            alerts.check_km_readings(date(2026, 10, d))
        alert = Alert.objects.get(type=AlertType.KM_READING_PENDING)
        self.assertEqual(EmailOutbox.objects.filter(alert=alert).count(), 2)
        self.assertEqual(alert.message_args["reminded"], [0, 1])
        for d in (1, 5, 5):
            alerts.check_km_readings(date(2026, 11, d))
        self.assertEqual(EmailOutbox.objects.filter(alert=alert).count(), 3)
        alert.refresh_from_db()
        self.assertEqual(alert.message_args["reminded"], [0, 1, 2])


class EmailLayoutTests(TestCase):
    def test_wrap_puts_the_body_in_the_corporate_box_with_the_logo(self):
        html, images = email_layout.wrap("<p>Hola</p>", title="Asunto")
        self.assertIn("<p>Hola</p>", html)
        self.assertIn("cid:logo@flota", html)
        self.assertIn("#009491", html)
        self.assertIn("Gestión de flota", html)
        self.assertEqual(len(images), 1)
        self.assertEqual(images[0].mime, "image/png")

    def test_preview_embeds_the_logo_as_data_uri(self):
        html, images = email_layout.wrap("<p>Hola</p>", preview=True)
        self.assertIn("data:image/png;base64,", html)
        self.assertEqual(images, [])

    def test_layout_can_be_switched_off(self):
        c = EmailSettings.get_solo()
        c.layout_enabled = False
        c.save()
        html, images = email_layout.wrap("<p>Hola</p>")
        self.assertEqual(html, "<p>Hola</p>")
        self.assertEqual(images, [])

    @override_settings(
        FLEET_EMAIL_ENABLED=True, EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend"
    )
    def test_delivered_mail_carries_the_inline_logo(self):
        message = mailer.build_message("Asunto", "<p>Cuerpo</p>", ["a@flota.dev"])
        message.send()
        sent = mail.outbox[0]
        html = sent.alternatives[0][0]
        self.assertIn("cid:logo@flota", html)
        self.assertIn("<p>Cuerpo</p>", html)
        # Estructura MIME: related[ alternative, imagen ] (sin ficheros, no hay mixed).
        mime = sent.message()
        self.assertEqual(mime.get_content_type(), "multipart/related")
        tipos = [p.get_content_type() for p in mime.get_payload()]
        self.assertEqual(tipos, ["multipart/alternative", "image/png"])
        self.assertEqual(mime.get_payload()[1]["Content-ID"], "<logo@flota>")

    @override_settings(
        FLEET_EMAIL_ENABLED=True, EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend"
    )
    def test_a_file_attachment_stays_outside_the_related_part(self):
        message = mailer.build_message("Informe", "<p>Adjunto</p>", ["a@flota.dev"])
        message.attach("flota.csv", b"a;b", "text/csv")
        message.send()
        mime = mail.outbox[0].message()
        self.assertEqual(mime.get_content_type(), "multipart/mixed")
        tipos = [p.get_content_type() for p in mime.get_payload()]
        self.assertEqual(tipos, ["multipart/related", "text/csv"])
        self.assertEqual(len(mail.outbox[0].attachments), 1)


class EmailSettingsApiTests(APITestCase):
    def setUp(self):
        self.admin = make_user("cfg-admin", Role.ADMIN)
        self.client.force_authenticate(self.admin)

    def test_get_returns_the_singleton_with_dates_and_logo(self):
        resp = self.client.get(reverse("email-settings"))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["km_remind_emails"], 2)
        self.assertEqual(len(resp.data["km_remind_dates"]), 2)
        self.assertTrue(resp.data["logo_data_url"].startswith("data:image/png;base64,"))
        self.assertFalse(resp.data["has_custom_logo"])

    def test_post_changes_the_schedule_and_the_job_follows(self):
        resp = self.client.post(
            reverse("email-settings"),
            {"km_remind_from_day": 10, "km_remind_until_day": 0, "km_remind_emails": 4},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertEqual(len(resp.data["km_remind_dates"]), 4)
        Vehicle.objects.create(plate="CFG1", brand="a", model="b")
        self.assertEqual(alerts.check_km_readings(date(2026, 10, 10)), 1)
        self.assertEqual(alerts.check_km_readings(date(2026, 11, 2)), 0)
        self.assertEqual(Alert.objects.filter(type=AlertType.KM_READING_PENDING).count(), 1)

    def test_validation(self):
        resp = self.client.post(
            reverse("email-settings"),
            {"km_remind_emails": 9, "brand_color": "verde"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("km_remind_emails", resp.data["errors"])
        self.assertIn("brand_color", resp.data["errors"])

    def test_logo_upload_and_clear(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        resp = self.client.post(
            reverse("email-settings"),
            {"brand_name": "Flota GS", "logo": SimpleUploadedFile("l.png", PNG_1PX, "image/png")},
            format="multipart",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertTrue(resp.data["has_custom_logo"])
        self.assertEqual(resp.data["brand_name"], "Flota GS")
        html, images = email_layout.wrap("<p>x</p>")
        self.assertEqual(images[0].content, PNG_1PX)
        resp = self.client.post(reverse("email-settings"), {"logo_clear": "1"}, format="multipart")
        self.assertFalse(resp.data["has_custom_logo"])

    def test_bad_logo_is_rejected(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        resp = self.client.post(
            reverse("email-settings"),
            {"logo": SimpleUploadedFile("l.txt", b"hola", "text/plain")},
            format="multipart",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_admin_only(self):
        sup = make_user("cfg-sup", Role.SUPERVISOR)
        self.client.force_authenticate(sup)
        self.assertEqual(self.client.get(reverse("email-settings")).status_code, 403)

    def test_template_preview_returns_the_full_document(self):
        tpl = EmailTemplate.objects.create(
            key=EmailTemplateKey.KM_READING_PENDING,
            subject="Falta tu lectura · {{matricula}}",
            body_html="<p>Llevas {{dias_sin_lectura}} días sin lectura.</p>",
        )
        resp = self.client.post(reverse("emailtemplate-preview", args=[tpl.pk]), {}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertIn("37 días sin lectura", resp.data["body_html"])
        self.assertIn("data:image/png;base64,", resp.data["document_html"])
        self.assertIn("37 días sin lectura", resp.data["document_html"])
