"""N10 — emails de alertas: enrutado, plantillas, saneado y gestor (API)."""

from datetime import date, timedelta
from io import StringIO
from unittest import mock

from django.core import mail
from django.core.management import call_command
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import (
    Assignment,
    Contract,
    EmailLog,
    EmailOutbox,
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
        # M6: el chequeo NO abre el SMTP; deja el correo en la cola.
        self.assertEqual(len(mail.outbox), 0)
        queued = EmailOutbox.objects.get()
        self.assertEqual(queued.recipient, "flota@ald.example")
        self.assertEqual(queued.status, EmailOutbox.Status.PENDING)
        self.assertFalse(EmailLog.objects.exists())
        # La entrega es el paso siguiente (comando / final de run_all).
        self.assertEqual(mailer.send_outbox()["sent"], 1)
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
        # El recordatorio solo sale dentro de su ventana (del 20 al 5).
        created = alerts.check_km_readings(today=TODAY.replace(day=20))
        self.assertEqual(created, 1)
        mailer.send_outbox()
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
        # Deshabilitado: no se encola nada que reintentar más adelante.
        self.assertFalse(EmailOutbox.objects.exists())

    @EMAIL_ON
    def test_itv_alert_sends_no_email(self):
        self.vehicle.next_itv_date = TODAY + timedelta(days=5)
        self.vehicle.save(update_fields=["next_itv_date"])
        alerts.check_itv(today=TODAY)
        self.assertEqual(len(mail.outbox), 0)
        self.assertFalse(EmailOutbox.objects.exists())


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


class NoticeLanguageTests(APITestCase):
    """Aviso de vehículo en castellano, inglés o los dos, y sin plantilla."""

    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.admin.email = "admin@flota.dev"
        self.admin.save(update_fields=["email"])
        self.client.force_authenticate(self.admin)
        self.vehicle = Vehicle.objects.create(plate="1234KLM", brand="a", model="b")
        self.template = EmailTemplate.objects.create(
            key=EmailTemplateKey.STATE_NOTICE,
            subject="Aviso {{matricula}}",
            body_html="<p>Hola</p>",
            subject_en="Notice {{matricula}}",
            body_html_en="<p>Hello</p>",
        )

    def preview(self, **data):
        resp = self.client.post(
            reverse("vehicle-notice-preview", args=[self.vehicle.pk]),
            {"template_key": EmailTemplateKey.STATE_NOTICE, **data},
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        return resp.data

    def test_preview_brings_the_whole_document_in_the_corporate_box(self):
        data = self.preview()
        self.assertIn("<p>Hola</p>", data["body_html"])
        self.assertIn("<p>Hola</p>", data["document_html"])
        self.assertIn("<html", data["document_html"])
        self.assertIn("data:image/png;base64,", data["document_html"])

    def test_km_variables_come_from_the_vehicle_when_there_is_no_alert(self):
        from fleet.models import EmailSettings, KmReading
        from fleet.services import email_layout

        hoy = timezone.localdate()
        ultima = hoy - timedelta(days=12)
        KmReading.objects.create(vehicle=self.vehicle, reading_date=ultima, km_reading=1000)
        data = self.preview(
            template_key=EmailTemplateKey.KM_READING_PENDING,
            body="<p>{{dias_sin_lectura}} | {{ultima_lectura}} | {{periodo}}</p>",
        )
        mes = email_layout.km_remind_period(hoy, EmailSettings.get_solo()) or hoy.replace(day=1)
        self.assertIn(
            f"<p>12 | {ultima.isoformat()} | {mes.year:04d}-{mes.month:02d}</p>",
            data["body_html"],
        )

    def test_any_template_key_renders_from_its_generic(self):
        # El modal ofrece las ocho plantillas: las que no tienen versión
        # personalizada salen de su genérica, con sus variables resueltas (el
        # exceso de km, sin contrato ni lecturas, queda vacío y no rompe).
        for key in EmailTemplateKey.values:
            data = self.preview(template_key=key, body="<p>{{matricula}}|{{km_exceso}}</p>")
            self.assertIn("<p>1234KLM|</p>", data["body_html"], key)

    def test_email_activity_says_what_went_out_and_what_can_still_go(self):
        """La ficha evalúa al abrir el correo: lo mandado (a mano o por el
        motor), lo que está en cola y los avisos abiertos que admiten correo."""
        from fleet.models import Alert, EmailLog, EmailOutbox
        from fleet.models.enums import AlertLevel, AlertStatus, AlertType

        itv = Alert.objects.create(
            vehicle=self.vehicle,
            type=AlertType.ITV_DUE,
            level=AlertLevel.WARNING,
            status=AlertStatus.OPEN,
            message="ITV en 10 días",
            dedup_key="itv:test",
        )
        km = Alert.objects.create(
            vehicle=self.vehicle,
            type=AlertType.KM_READING_PENDING,
            level=AlertLevel.INFO,
            status=AlertStatus.OPEN,
            message="Lectura pendiente",
            dedup_key="km:test",
        )
        # Una automatización del motor, ya enviada (fila antigua: solo con alerta).
        EmailLog.objects.create(
            alert=itv,
            template_key=EmailTemplateKey.ITV_DUE,
            recipient="c@flota.dev",
            recipient_role="driver",
            subject="ITV",
            status=EmailLog.Status.SENT,
        )
        # Y otra en cola por salir.
        EmailOutbox.objects.create(
            alert=km,
            vehicle=self.vehicle,
            template_key=EmailTemplateKey.KM_READING_PENDING,
            recipient="c@flota.dev",
            recipient_role="driver",
            subject="Lectura",
            body_html="<p>x</p>",
        )
        resp = self.client.get(reverse("vehicle-email-activity", args=[self.vehicle.pk]))
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        por_tipo = {a["type"]: a for a in resp.data["alerts"]}
        self.assertEqual(set(por_tipo), {"itv_due", "km_reading_pending"})
        self.assertIsNotNone(por_tipo["itv_due"]["last_sent_at"])
        self.assertEqual(por_tipo["itv_due"]["sent_count"], 1)
        self.assertFalse(por_tipo["itv_due"]["pending"])
        self.assertIsNone(por_tipo["km_reading_pending"]["last_sent_at"])
        self.assertTrue(por_tipo["km_reading_pending"]["pending"])
        self.assertEqual([f["alert"] for f in resp.data["pending"]], [km.pk])
        self.assertEqual(len(resp.data["sent"]), 1)
        self.assertFalse(resp.data["sent"][0]["manual"])

        # X1: el seguro es de administración. Un supervisor del coche ve lo
        # suyo, pero ni el aviso de seguro ni sus correos a la renting.
        seguro = Alert.objects.create(
            vehicle=self.vehicle,
            type=AlertType.INSURANCE_DUE,
            level=AlertLevel.WARNING,
            status=AlertStatus.OPEN,
            dedup_key="ins:test",
        )
        EmailLog.objects.create(
            alert=seguro,
            vehicle=self.vehicle,
            template_key=EmailTemplateKey.INSURANCE_DUE,
            recipient="flota@ald.example",
            recipient_role="renting",
            subject="Seguro",
            status=EmailLog.Status.SENT,
        )
        supervisor = make_user("sup-act", Role.SUPERVISOR)
        self.vehicle.supervisor = supervisor
        self.vehicle.save(update_fields=["supervisor"])
        self.client.force_authenticate(supervisor)
        resp = self.client.get(reverse("vehicle-email-activity", args=[self.vehicle.pk]))
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertEqual(
            {a["type"] for a in resp.data["alerts"]}, {"itv_due", "km_reading_pending"}
        )
        self.assertEqual({f["template_key"] for f in resp.data["sent"]}, {"itv_due"})
        self.client.force_authenticate(self.admin)
        resp = self.client.get(reverse("vehicle-email-activity", args=[self.vehicle.pk]))
        self.assertIn("insurance_due", {f["template_key"] for f in resp.data["sent"]})
        seguro.delete()

        # El botón rápido: un comunicado ligado al aviso, que queda a mano y del coche.
        resp = self.client.post(
            reverse("vehicle-notify", args=[self.vehicle.pk]),
            {"template_key": EmailTemplateKey.ITV_DUE, "to_admin": True, "alert": itv.pk},
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        fila = EmailLog.objects.filter(manual=True).latest("created_at")
        self.assertEqual((fila.vehicle_id, fila.alert_id), (self.vehicle.pk, itv.pk))
        # (En tests no hay SMTP: la fila queda omitida, y lo que se cuenta
        # como enviado al aviso sigue siendo la automatización.)
        resp = self.client.get(reverse("vehicle-email-activity", args=[self.vehicle.pk]))
        self.assertEqual({a["type"]: a["sent_count"] for a in resp.data["alerts"]}["itv_due"], 1)
        self.assertTrue(resp.data["sent"][0]["manual"])
        self.assertEqual(resp.data["sent"][0]["alert"], itv.pk)
        self.assertEqual(resp.data["sent"][0]["status"], "skipped")
        # Un aviso de otro coche o cerrado no vale.
        otro = Vehicle.objects.create(plate="9999ZZZ", brand="a", model="b")
        ajena = Alert.objects.create(
            vehicle=otro,
            type=AlertType.ITV_DUE,
            level=AlertLevel.WARNING,
            status=AlertStatus.OPEN,
            dedup_key="itv:otro",
        )
        resp = self.client.post(
            reverse("vehicle-notify", args=[self.vehicle.pk]),
            {"template_key": EmailTemplateKey.ITV_DUE, "to_admin": True, "alert": ajena.pk},
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_cuerpo_retocado_sustituye_al_de_la_plantilla(self):
        # Lo que se retoca en el modal es el correo de ESTE envío: se rinde con
        # las mismas variables que la plantilla, que no se toca.
        data = self.preview(body="<p>Buenos días, {{matricula}}</p>")
        self.assertIn("Buenos días, 1234KLM", data["body_html"])
        self.assertNotIn("Hola", data["body_html"])
        # El asunto sigue saliendo de la plantilla: ahí no se ha tocado nada.
        self.assertEqual(data["subject"], "Aviso 1234KLM")
        self.template.refresh_from_db()
        self.assertEqual(self.template.body_html, "<p>Hola</p>")

    def test_cuerpo_retocado_manda_sobre_los_dos_idiomas(self):
        # Es UN texto, el que se ha leído y corregido: no se duplica en dos.
        data = self.preview(lang="both", body="<p>Único</p>")
        self.assertIn("Único", data["body_html"])
        self.assertNotIn("Hello", data["body_html"])

    def test_cuerpo_retocado_se_sanea(self):
        # Acaba en un correo tal cual: pasa por el mismo nh3 que las plantillas.
        data = self.preview(body="<p>Hola</p><script>alert(1)</script>")
        self.assertNotIn("<script>", data["body_html"])

    def test_spanish_is_the_default(self):
        data = self.preview()
        self.assertEqual(data["subject"], "Aviso 1234KLM")
        self.assertIn("Hola", data["body_html"])
        self.assertNotIn("Hello", data["body_html"])
        self.assertTrue(data["has_en"])

    def test_english_uses_its_own_version(self):
        data = self.preview(lang="en")
        self.assertEqual(data["subject"], "Notice 1234KLM")
        self.assertIn("Hello", data["body_html"])
        self.assertNotIn("Hola", data["body_html"])

    def test_both_sends_the_two_versions_in_one_email(self):
        data = self.preview(lang="both")
        self.assertEqual(data["subject"], "Aviso 1234KLM / Notice 1234KLM")
        self.assertIn("Hola", data["body_html"])
        self.assertIn("Hello", data["body_html"])

    def test_english_falls_back_field_by_field(self):
        # Solo se traduce el asunto: el cuerpo debe seguir siendo el castellano
        # en vez de quedarse vacío.
        self.template.body_html_en = ""
        self.template.save(update_fields=["body_html_en"])
        data = self.preview(lang="en")
        self.assertEqual(data["subject"], "Notice 1234KLM")
        self.assertIn("Hola", data["body_html"])

    def test_untranslated_template_reports_it_and_does_not_duplicate(self):
        self.template.subject_en = ""
        self.template.body_html_en = ""
        self.template.save(update_fields=["subject_en", "body_html_en"])
        data = self.preview(lang="both")
        self.assertFalse(data["has_en"])
        # Las dos versiones son la misma: no se manda dos veces lo mismo.
        self.assertEqual(data["subject"], "Aviso 1234KLM")
        self.assertEqual(data["body_html"].count("Hola"), 1)

    def test_signature_is_added_once_with_both_languages(self):
        self.template.signature = EmailSignature.objects.create(
            name="Flota", body_html="<p>-- Flota</p>"
        )
        self.template.save(update_fields=["signature"])
        data = self.preview(lang="both")
        self.assertEqual(data["body_html"].count("-- Flota"), 1)

    @EMAIL_ON
    def test_notify_logs_the_role_and_the_batch_of_each_recipient(self):
        resp = self.client.post(
            reverse("vehicle-notify", args=[self.vehicle.pk]),
            {"message": "Hola", "to_driver": True, "to_admin": True, "email": "x@flota.dev"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        filas = EmailLog.objects.filter(template_key="comunicado")
        self.assertEqual(len({f.batch for f in filas}), 1)
        self.assertTrue(filas.first().batch)
        papeles = set(filas.values_list("recipient_role", flat=True))
        self.assertIn("driver", papeles)
        self.assertIn("other", papeles)

    @EMAIL_ON
    def test_notify_without_template_sends_only_the_message(self):
        resp = self.client.post(
            reverse("vehicle-notify", args=[self.vehicle.pk]),
            {"template_key": "", "message": "Texto suelto", "to_admin": True},
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertIn("Texto suelto", mail.outbox[0].alternatives[0][0])
        self.assertNotIn("Hola", mail.outbox[0].alternatives[0][0])

    @EMAIL_ON
    def test_notify_sends_inside_the_corporate_layout(self):
        """Lo que sale por el modal del vehículo lleva la misma caja que la
        vista previa: era el único envío que montaba el mensaje a mano y el
        correo llegaba con el cuerpo pelado (sin logotipo ni pie)."""
        resp = self.client.post(
            reverse("vehicle-notify", args=[self.vehicle.pk]),
            {"template_key": "", "message": "Texto suelto", "to_admin": True},
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        html = mail.outbox[0].alternatives[0][0]
        self.assertIn("cid:logo@flota", html)
        self.assertIn("border-bottom:4px solid", html)
        self.assertTrue(
            any(p.get("Content-ID") == "<logo@flota>" for p in mail.outbox[0].message().walk())
        )

    def test_notify_without_template_needs_a_message(self):
        resp = self.client.post(
            reverse("vehicle-notify", args=[self.vehicle.pk]),
            {"template_key": "", "message": "", "to_admin": True},
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_notify_rejects_an_unknown_language(self):
        resp = self.client.post(
            reverse("vehicle-notify", args=[self.vehicle.pk]),
            {"template_key": EmailTemplateKey.STATE_NOTICE, "lang": "fr", "to_admin": True},
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_english_body_is_sanitized_too(self):
        resp = self.client.post(
            reverse("emailtemplate-list"),
            {
                "key": "generic",
                "subject": "Aviso",
                "body_html": "<b>ok</b>",
                "body_html_en": '<p onclick="x()">Hi</p><script>alert(1)</script>',
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertNotIn("script", resp.data["body_html_en"])
        self.assertNotIn("onclick", resp.data["body_html_en"])


class ManyRecipientsTests(APITestCase):
    """Varias direcciones en un mismo envío (los informes programados las llevan)."""

    @EMAIL_ON
    def test_immediate_send_splits_a_comma_list(self):
        enviado, motivo = mailer.send_notice_now(
            to="sara@flota.dev, marta@flota.dev",
            subject="Informe mensual de flota",
            body_html="<p>Ahí va.</p>",
            template_key=EmailTemplateKey.GENERIC,
        )

        self.assertTrue(enviado, motivo)
        # Una sola entrega, con las DOS direcciones en el «Para» (antes viajaba
        # la lista entera como si fuese una dirección).
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["sara@flota.dev", "marta@flota.dev"])
        # Y la traza guarda la lista, que es lo que enseña la pantalla de envíos.
        log = EmailLog.objects.get()
        self.assertEqual(log.recipient, "sara@flota.dev, marta@flota.dev")
        self.assertEqual(log.status, EmailLog.Status.SENT)


class EmailOutboxTests(APITestCase):
    """M6 — la cola: reintento acotado, tandas y entrega fuera de los chequeos."""

    def setUp(self):
        self.renting = Renting.objects.create(name="ALD", email="flota@ald.example")
        self.vehicle = Vehicle.objects.create(plate="1234KLM", brand="a", model="b")
        Contract.objects.create(
            vehicle=self.vehicle,
            renting=self.renting,
            start_date=TODAY - timedelta(days=100),
            planned_end_date=TODAY + timedelta(days=265),
        )
        EmailTemplate.objects.all().delete()
        EmailSignature.objects.all().delete()

    def _queue_one(self):
        self.vehicle.insurance_expiry_date = TODAY + timedelta(days=5)
        self.vehicle.save(update_fields=["insurance_expiry_date"])
        alerts.check_insurance(today=TODAY)
        return EmailOutbox.objects.get()

    @EMAIL_ON
    def test_smtp_failure_is_retried_and_then_given_up(self):
        entry = self._queue_one()
        boom = mock.patch.object(mailer, "_deliver", side_effect=OSError("conexión rechazada"))
        with boom:
            # Dos primeras pasadas: sigue pendiente, con el error anotado.
            self.assertEqual(mailer.send_outbox(max_attempts=3)["retry"], 1)
            entry.refresh_from_db()
            self.assertEqual(entry.status, EmailOutbox.Status.PENDING)
            self.assertEqual(entry.attempts, 1)
            self.assertIn("conexión rechazada", entry.last_error)
            self.assertFalse(EmailLog.objects.exists())  # aún no es un fallo final
            mailer.send_outbox(max_attempts=3)
            # Tercera: se agotan los intentos y pasa a fallido con su traza.
            self.assertEqual(mailer.send_outbox(max_attempts=3)["failed"], 1)
        entry.refresh_from_db()
        self.assertEqual(entry.status, EmailOutbox.Status.FAILED)
        self.assertEqual(entry.attempts, 3)
        self.assertEqual(EmailLog.objects.get().status, EmailLog.Status.FAILED)
        # Y ya no se vuelve a tocar.
        self.assertEqual(mailer.send_outbox(max_attempts=3), {"sent": 0, "failed": 0, "retry": 0})

    @EMAIL_ON
    def test_transient_failure_ends_up_delivered(self):
        # Lo que antes se perdía en el primer intento: ahora sale a la segunda.
        entry = self._queue_one()
        with mock.patch.object(mailer, "_deliver", side_effect=OSError("timeout")):
            mailer.send_outbox(max_attempts=3)
        self.assertEqual(len(mail.outbox), 0)
        self.assertEqual(mailer.send_outbox(max_attempts=3)["sent"], 1)
        entry.refresh_from_db()
        self.assertEqual(entry.status, EmailOutbox.Status.SENT)
        self.assertIsNotNone(entry.sent_at)
        self.assertEqual(entry.last_error, "")
        self.assertEqual(len(mail.outbox), 1)

    @EMAIL_ON
    def test_batch_limit_leaves_the_rest_pending(self):
        for n in range(3):
            EmailOutbox.objects.create(
                recipient=f"destino{n}@example.com", subject=f"s{n}", body_html="<p>x</p>"
            )
        self.assertEqual(mailer.send_outbox(limit=2)["sent"], 2)
        self.assertEqual(EmailOutbox.objects.filter(status=EmailOutbox.Status.PENDING).count(), 1)

    @EMAIL_ON
    def test_run_all_delivers_at_the_end(self):
        self.vehicle.insurance_expiry_date = TODAY + timedelta(days=5)
        self.vehicle.save(update_fields=["insurance_expiry_date"])
        summary = alerts.run_all(today=TODAY)
        self.assertEqual(summary["insurance"], 1)
        self.assertEqual(summary["emails_sent"], 1)
        self.assertEqual(len(mail.outbox), 1)

    @EMAIL_ON
    def test_command_delivers_the_queue(self):
        self._queue_one()
        out = StringIO()
        call_command("send_email_outbox", stdout=out)
        self.assertIn("1 enviados", out.getvalue())
        self.assertEqual(len(mail.outbox), 1)

    @EMAIL_ON
    def test_claimed_rows_are_not_delivered_twice(self):
        """R3-08: una fila reclamada por otra pasada en curso no se re-entrega.

        La entrega se dispara desde tres procesos (jobs, «enviar ahora» del
        worker web y el despacho de notificaciones): sin el claim, dos pasadas
        solapadas seleccionaban las mismas filas y el correo salía dos veces.
        """
        entry = EmailOutbox.objects.create(
            recipient="destino@example.com", subject="s", body_html="<p>x</p>"
        )
        # Otra pasada la reclamó hace un momento (claim FRESCO).
        EmailOutbox.objects.filter(pk=entry.pk).update(status=EmailOutbox.Status.SENDING)
        self.assertEqual(mailer.send_outbox(), {"sent": 0, "failed": 0, "retry": 0})
        self.assertEqual(len(mail.outbox), 0)
        entry.refresh_from_db()
        self.assertEqual(entry.status, EmailOutbox.Status.SENDING)  # sigue siendo suya

    @EMAIL_ON
    def test_stale_claim_is_rescued_and_delivered(self):
        """R3-08: una fila colgada en `sending` (proceso muerto) se rescata."""
        entry = EmailOutbox.objects.create(
            recipient="destino@example.com", subject="s", body_html="<p>x</p>"
        )
        stale = timezone.now() - mailer.STALE_CLAIM - timedelta(minutes=1)
        EmailOutbox.objects.filter(pk=entry.pk).update(
            status=EmailOutbox.Status.SENDING, updated_at=stale
        )
        self.assertEqual(mailer.send_outbox()["sent"], 1)
        entry.refresh_from_db()
        self.assertEqual(entry.status, EmailOutbox.Status.SENT)
        self.assertEqual(len(mail.outbox), 1)

    def test_disabled_email_keeps_the_queue_untouched(self):
        # Sin FLEET_EMAIL_ENABLED no se gasta ningún intento (el interruptor
        # puede apagarse DESPUÉS de encolar; el correo espera, no muere).
        entry = EmailOutbox.objects.create(
            recipient="destino@example.com", subject="s", body_html="<p>x</p>"
        )
        self.assertEqual(mailer.send_outbox(), {"sent": 0, "failed": 0, "retry": 0})
        entry.refresh_from_db()
        self.assertEqual(entry.attempts, 0)
        self.assertEqual(entry.status, EmailOutbox.Status.PENDING)
