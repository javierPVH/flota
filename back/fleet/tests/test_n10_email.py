"""N10 — emails de alertas: enrutado, plantillas, saneado y gestor (API)."""

from datetime import date, timedelta

from django.core import mail
from django.test import override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import (
    Assignment,
    Contract,
    EmailLog,
    EmailSignature,
    EmailTemplate,
    EmailTemplateKey,
    Renting,
    Vehicle,
)
from fleet.models.enums import AssignmentStatus
from fleet.services import alerts, mailer

from .helpers import make_user

TODAY = date(2026, 7, 15)

EMAIL_ON = override_settings(
    FLEET_EMAIL_ENABLED=True,
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
)


class RenderTests(APITestCase):
    def test_render_escapes_and_allowlists(self):
        out = mailer.render(
            "Hola {{conductor}} {{desconocida}} {{matricula}}",
            {"conductor": "<b>Eva</b>", "matricula": "1234KLM", "desconocida": "x"},
        )
        self.assertEqual(out, "Hola &lt;b&gt;Eva&lt;/b&gt;  1234KLM")


class InsuranceRoutingTests(APITestCase):
    def setUp(self):
        self.driver = make_user("carlos", Role.DRIVER)
        self.driver.email = "carlos@flota.dev"
        self.driver.save(update_fields=["email"])
        self.renting = Renting.objects.create(name="ALD", email="flota@ald.example")
        self.vehicle = Vehicle.objects.create(plate="1234KLM", brand="a", model="b")
        Contract.objects.create(
            vehicle=self.vehicle,
            renting=self.renting,
            start_date=TODAY - timedelta(days=100),
            planned_end_date=TODAY + timedelta(days=265),
        )
        Assignment.objects.create(
            vehicle=self.vehicle,
            driver=self.driver,
            start_date=TODAY - timedelta(days=100),
            status=AssignmentStatus.ACCEPTED,
        )
        EmailSignature.objects.all().delete()
        EmailTemplate.objects.all().delete()

    @EMAIL_ON
    def test_insurance_alert_mails_renting(self):
        self.vehicle.insurance_expiry_date = TODAY + timedelta(days=5)
        self.vehicle.save(update_fields=["insurance_expiry_date"])
        created = alerts.check_insurance(today=TODAY)
        self.assertEqual(created, 1)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["flota@ald.example"])
        log = EmailLog.objects.get()
        self.assertEqual(log.status, EmailLog.Status.SENT)
        self.assertEqual(log.recipient, "flota@ald.example")

    @EMAIL_ON
    def test_km_pending_alert_mails_driver_with_template(self):
        EmailTemplate.objects.create(
            key=EmailTemplateKey.KM_READING_PENDING,
            subject="Falta tu lectura · {{matricula}}",
            body_html="<p>Hola {{conductor}}</p>",
        )
        created = alerts.check_km_readings(today=TODAY)
        self.assertEqual(created, 1)
        self.assertEqual(mail.outbox[0].to, ["carlos@flota.dev"])
        self.assertIn("1234KLM", mail.outbox[0].subject)
        self.assertIn("carlos", mail.outbox[0].alternatives[0][0])

    def test_disabled_email_logs_skip_and_never_raises(self):
        # Sin FLEET_EMAIL_ENABLED: no envía, no lanza, deja traza SKIPPED.
        self.vehicle.insurance_expiry_date = TODAY + timedelta(days=5)
        self.vehicle.save(update_fields=["insurance_expiry_date"])
        alerts.check_insurance(today=TODAY)
        self.assertEqual(len(mail.outbox), 0)
        self.assertEqual(EmailLog.objects.get().status, EmailLog.Status.SKIPPED)

    @EMAIL_ON
    def test_itv_alert_sends_no_email(self):
        self.vehicle.next_itv_date = TODAY + timedelta(days=5)
        self.vehicle.save(update_fields=["next_itv_date"])
        alerts.check_itv(today=TODAY)
        self.assertEqual(len(mail.outbox), 0)


class TemplateApiTests(APITestCase):
    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.supervisor = make_user("sup", Role.SUPERVISOR)
        self.client.force_authenticate(self.admin)

    def test_body_html_is_sanitized(self):
        resp = self.client.post(
            reverse("emailtemplate-list"),
            {
                "key": "generic",
                "subject": "Aviso",
                "body_html": '<p onclick="x()">Hola</p><script>alert(1)</script><b>ok</b>',
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertNotIn("script", resp.data["body_html"])
        self.assertNotIn("onclick", resp.data["body_html"])
        self.assertIn("<b>ok</b>", resp.data["body_html"])

    def test_preview_renders_sample_context(self):
        template = EmailTemplate.objects.create(
            key=EmailTemplateKey.GENERIC,
            subject="{{matricula}}",
            body_html="<p>{{conductor}}</p>",
        )
        resp = self.client.post(reverse("emailtemplate-preview", args=[template.pk]))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["subject"], "1234KLM")
        self.assertIn("Carlos Ruiz", resp.data["body_html"])

    @EMAIL_ON
    def test_send_test_to_my_email(self):
        self.admin.email = "admin@flota.dev"
        self.admin.save(update_fields=["email"])
        template = EmailTemplate.objects.create(
            key=EmailTemplateKey.GENERIC, subject="Aviso", body_html="<p>hola</p>"
        )
        resp = self.client.post(reverse("emailtemplate-test", args=[template.pk]))
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertEqual(mail.outbox[0].to, ["admin@flota.dev"])
        self.assertTrue(mail.outbox[0].subject.startswith("[PRUEBA]"))

    def test_supervisor_cannot_manage_templates(self):
        self.client.force_authenticate(self.supervisor)
        self.assertEqual(
            self.client.get(reverse("emailtemplate-list")).status_code,
            status.HTTP_403_FORBIDDEN,
        )
