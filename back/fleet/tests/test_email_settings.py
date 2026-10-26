"""Ajustes del correo (Ajustes → Correo): calendario del recordatorio de km,
maquetación corporativa y su API."""

import base64
from datetime import date

from django.core import mail
from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import (
    Alert,
    EmailSettings,
    EmailTemplate,
    EmailTemplateKey,
    KmRemindMode,
    Vehicle,
)
from fleet.models.enums import AlertType
from fleet.services import alerts, email_defaults, email_layout, mailer

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

    def test_daily_mode_sends_every_day_of_the_window(self):
        c = self.cfg(km_remind_mode=KmRemindMode.DAILY, km_remind_until_day=2)
        fechas = email_layout.km_remind_schedule(date(2026, 10, 1), c)
        self.assertEqual(len(fechas), 14)  # 20..31 de octubre + 1 y 2 de noviembre
        self.assertEqual((fechas[0], fechas[-1]), (date(2026, 10, 20), date(2026, 11, 2)))

    def test_odd_and_even_modes_follow_the_calendar_day(self):
        impares = self.cfg(km_remind_mode=KmRemindMode.ODD, km_remind_until_day=2)
        self.assertEqual(
            [d.day for d in email_layout.km_remind_schedule(date(2026, 10, 1), impares)],
            [21, 23, 25, 27, 29, 31, 1],
        )
        pares = self.cfg(km_remind_mode=KmRemindMode.EVEN, km_remind_until_day=5)
        self.assertEqual(
            [d.day for d in email_layout.km_remind_schedule(date(2026, 10, 1), pares)],
            [20, 22, 24, 26, 28, 30, 2, 4],
        )

    def test_count_mode_never_exceeds_the_days_of_the_window(self):
        # El tope es el plazo en el mes más corto: del 20 al 28 (9 días) + 5.
        self.assertEqual(email_layout.km_remind_max_emails(20, 5), 14)
        self.assertEqual(email_layout.km_remind_max_emails(28, 0), 1)
        c = self.cfg(km_remind_emails=14)
        fechas = email_layout.km_remind_schedule(date(2026, 2, 1), c)
        self.assertEqual(len(fechas), 14)
        self.assertEqual(len(set(fechas)), 14)

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
            {"km_remind_emails": 0, "brand_color": "verde"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("km_remind_emails", resp.data["errors"])
        self.assertIn("brand_color", resp.data["errors"])

    def test_emails_cannot_exceed_the_days_of_the_window(self):
        # Con el plazo por defecto (20 → 5) caben 14 como mucho.
        resp = self.client.post(reverse("email-settings"), {"km_remind_emails": 15}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("14", str(resp.data["errors"]["km_remind_emails"]))
        # Y la validación mira la ventana que QUEDA tras el cambio.
        resp = self.client.post(
            reverse("email-settings"),
            {"km_remind_from_day": 10, "km_remind_emails": 15},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertEqual(resp.data["km_remind_max_emails"], 24)

    def test_mode_changes_the_calendar(self):
        resp = self.client.post(
            reverse("email-settings"), {"km_remind_mode": "daily"}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertGreater(len(resp.data["km_remind_dates"]), 10)

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

    def test_preview_shows_unsaved_layout_settings(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        resp = self.client.post(
            reverse("emailtemplate-preview-default"),
            {
                "key": "generic",
                "brand_name": "Flota de prueba",
                "brand_color": "#123456",
                "footer_text": "Pie provisional",
                "logo": SimpleUploadedFile("l.png", PNG_1PX, "image/png"),
            },
            format="multipart",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        html = resp.data["document_html"]
        self.assertIn("Flota de prueba", html)
        self.assertIn("#123456", html)
        self.assertIn("Pie provisional", html)
        self.assertIn(base64.b64encode(PNG_1PX).decode("ascii"), html)
        # Nada de eso se ha guardado.
        cfg = EmailSettings.get_solo()
        self.assertEqual((cfg.brand_name, cfg.brand_color), ("Gestión de flota", "#009491"))
        self.assertFalse(cfg.logo)
        # Con la maquetación apagada en la petición, sale el cuerpo a secas.
        resp = self.client.post(
            reverse("emailtemplate-preview-default"),
            {"key": "generic", "layout_enabled": "false"},
            format="json",
        )
        self.assertNotIn("<table", resp.data["document_html"])

    def test_preview_takes_the_unsaved_editor_text(self):
        from fleet.models import EmailSignature

        firma = EmailSignature.objects.create(name="F", body_html="<p>— Firma</p>")
        resp = self.client.post(
            reverse("emailtemplate-preview-default"),
            {
                "key": "generic",
                "subject": "Borrador · {{matricula}}",
                "body_html": "<p>Nuevo <script>alert(1)</script>texto</p>",
                "signature": firma.pk,
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertEqual(resp.data["subject"], "Borrador · 1234KLM")
        self.assertIn("Nuevo", resp.data["body_html"])
        self.assertNotIn("<script", resp.data["body_html"])
        self.assertIn("— Firma", resp.data["body_html"])

    def test_reminder_can_be_switched_off(self):
        resp = self.client.post(
            reverse("email-settings"), {"km_remind_enabled": False}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertFalse(resp.data["km_remind_enabled"])
        Vehicle.objects.create(plate="OFF1", brand="a", model="b")
        self.assertEqual(alerts.check_km_readings(date(2026, 10, 25)), 0)
        self.assertEqual(Alert.objects.filter(type=AlertType.KM_READING_PENDING).count(), 0)
        self.client.post(reverse("email-settings"), {"km_remind_enabled": True}, format="json")
        self.assertEqual(alerts.check_km_readings(date(2026, 10, 25)), 1)

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


class EmailDefaultsTests(APITestCase):
    """Cada tipo de correo tiene su versión genérica; la personalizada manda."""

    def setUp(self):
        self.admin = make_user("def-admin", Role.ADMIN)
        self.client.force_authenticate(self.admin)

    def test_every_key_has_a_default_in_both_languages(self):
        for key in EmailTemplateKey.values:
            tpl = email_defaults.template_for(key)
            self.assertTrue(tpl.subject and tpl.body_html, key)
            self.assertTrue(tpl.has_en, key)

    def test_alert_mail_uses_the_default_of_its_type_when_nothing_is_customised(self):
        tpl = mailer._template_for(EmailTemplateKey.KM_READING_PENDING)
        self.assertIsNone(tpl.pk)
        self.assertIn("{{dias_sin_lectura}}", tpl.body_html)
        # Un tipo de alerta sin plantilla propia va por la genérica de todo.
        self.assertEqual(mailer._template_for("no_driver").key, EmailTemplateKey.GENERIC)

    def test_custom_template_wins_over_the_default(self):
        EmailTemplate.objects.create(
            key=EmailTemplateKey.KM_READING_PENDING, subject="Mía", body_html="<p>mía</p>"
        )
        self.assertEqual(mailer._template_for(EmailTemplateKey.KM_READING_PENDING).subject, "Mía")

    def test_vehicle_notice_without_custom_template_uses_the_default(self):
        vehicle = Vehicle.objects.create(plate="DEF1", brand="a", model="b")
        notice = mailer.render_vehicle_notice(vehicle, EmailTemplateKey.STATE_NOTICE, "hola", "en")
        self.assertEqual(notice.used_key, "")
        self.assertIn("Notice about vehicle DEF1", notice.subject)
        self.assertIn("hola", notice.body_html)

    def test_defaults_endpoint_and_its_preview(self):
        resp = self.client.get(reverse("emailtemplate-defaults"))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual({r["key"] for r in resp.data}, set(EmailTemplateKey.values))
        resp = self.client.post(
            reverse("emailtemplate-preview-default"),
            {"key": "km_reading_pending", "lang": "en"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertIn("37 days", resp.data["body_html"])
        self.assertIn("data:image/png;base64,", resp.data["document_html"])
        resp = self.client.post(
            reverse("emailtemplate-preview-default"), {"key": "otra"}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_retiring_a_custom_template_goes_back_to_the_default_and_can_be_customised_again(
        self,
    ):
        tpl = EmailTemplate.objects.create(
            key=EmailTemplateKey.ITV_DUE, subject="Mía", body_html="<p>mía</p>"
        )
        resp = self.client.delete(reverse("emailtemplate-detail", args=[tpl.pk]))
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)
        self.assertIsNone(mailer._template_for(EmailTemplateKey.ITV_DUE).pk)
        # Volver a personalizarla restaura la fila (key es única) en vez de chocar.
        resp = self.client.post(
            reverse("emailtemplate-list"),
            {"key": "itv_due", "subject": "Otra", "body_html": "<p>otra</p>"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(resp.data["id"], tpl.pk)
        self.assertEqual(mailer._template_for(EmailTemplateKey.ITV_DUE).subject, "Otra")
