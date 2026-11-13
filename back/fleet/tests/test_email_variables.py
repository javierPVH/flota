"""Las variables de un correo dicen lo que es: la cifra del exceso es el
EXCESO, el saludo nombra a quien responde del coche y el aviso enviado desde
la ficha lleva la frase del aviso.

Revisión de la lógica de envío (2026-11-12): cada caso de aquí era un correo
que llegaba con un dato equivocado o con un hueco en mitad de la frase.
"""

from datetime import date, timedelta

from django.test import override_settings
from django.urls import reverse
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import (
    Alert,
    Assignment,
    Contract,
    EmailLog,
    EmailOutbox,
    EmailSettings,
    EmailTemplate,
    KmReading,
    Renting,
    Vehicle,
)
from fleet.models.enums import AlertLevel, AlertType, AssignmentStatus
from fleet.services import alerts, mailer

from .helpers import make_user

TODAY = date(2026, 7, 22)

EMAIL_ON = override_settings(
    FLEET_EMAIL_ENABLED=True,
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
)


def _user(username, role, name):
    user = make_user(username, role)
    user.first_name = name
    user.email = f"{username}@flota.dev"
    user.save(update_fields=["first_name", "email"])
    return user


class KmOverageFigureTests(APITestCase):
    """`{{km_exceso}}` es lo que SOBRA, no los km proyectados: la plantilla
    dice «la proyección es de X km de exceso»."""

    def setUp(self):
        EmailTemplate.objects.all().delete()
        self.driver = _user("carlos", Role.DRIVER, "Carlos")
        self.vehicle = Vehicle.objects.create(plate="1234KLM", brand="a", model="b", km_start=0)
        # 100 días de 1000: al ritmo de 200 km/día proyecta 200.000 km sobre
        # 100.000 contratados → 100.000 de exceso.
        Contract.objects.create(
            vehicle=self.vehicle,
            renting=Renting.objects.create(name="ALD", email="flota@ald.example"),
            start_date=TODAY - timedelta(days=100),
            planned_end_date=TODAY + timedelta(days=900),
            contract_km=100_000,
        )
        Assignment.objects.create(
            vehicle=self.vehicle,
            driver=self.driver,
            start_date=TODAY - timedelta(days=100),
            status=AssignmentStatus.ACCEPTED,
        )
        KmReading.objects.create(vehicle=self.vehicle, reading_date=TODAY, km_reading=20_000)

    @EMAIL_ON
    def test_alert_mail_says_the_overage_not_the_projection(self):
        self.assertEqual(alerts.check_km_overage(today=TODAY), 1)
        body = EmailOutbox.objects.get().body_html
        self.assertIn("<strong>100000 km</strong> de exceso", body)
        self.assertNotIn("<strong>200000 km</strong> de exceso", body)

    def test_manual_notice_says_the_same_figure(self):
        from fleet.services.metrics import vehicle_summary

        esperado = vehicle_summary(self.vehicle)["projection"]["overage_km"]
        contexto = mailer.vehicle_notice_context(self.vehicle, template_key="km_overage")
        self.assertEqual(contexto["km_exceso"], str(esperado))


class GreetingWithoutDriverTests(APITestCase):
    """Un multiusuario no tiene conductor: el correo cae en su supervisor, y
    el saludo tiene que nombrarle a él, no quedarse en «Hola :»."""

    def setUp(self):
        EmailTemplate.objects.all().delete()
        self.supervisor = _user("sara", Role.SUPERVISOR, "Sara")
        self.vehicle = Vehicle.objects.create(
            plate="3141PLM", brand="a", model="b", supervisor=self.supervisor, is_multiuser=True
        )
        cfg = EmailSettings.get_solo()
        cfg.km_remind_enabled = True
        cfg.save()

    @EMAIL_ON
    def test_km_reminder_greets_the_supervisor(self):
        alert = Alert.objects.create(
            dedup_key="km_pending:x:2026-07",
            type=AlertType.KM_READING_PENDING,
            level=AlertLevel.WARNING,
            message="Lectura pendiente",
            vehicle=self.vehicle,
        )
        self.assertTrue(mailer.queue_for_alert(alert))
        queued = EmailOutbox.objects.get()
        self.assertEqual(queued.recipient, "sara@flota.dev")
        self.assertIn("Hola Sara:", queued.body_html)

    def test_manual_notice_greets_the_supervisor(self):
        notice = mailer.render_vehicle_notice(self.vehicle, "state_notice", "Pasa por el taller")
        self.assertIn("Hola Sara:", notice.body_html)


class NoticeFromAlertTests(APITestCase):
    """El botón rápido de un aviso manda su plantilla sin texto: el
    `{{mensaje}}` es entonces la frase del propio aviso, o el comunicado de
    «sin conductor» salía con el párrafo vacío."""

    def setUp(self):
        EmailTemplate.objects.all().delete()
        self.admin = make_user("admin", Role.ADMIN)
        self.supervisor = _user("sara", Role.SUPERVISOR, "Sara")
        self.vehicle = Vehicle.objects.create(
            plate="1234KLM", brand="a", model="b", supervisor=self.supervisor
        )
        self.alert = Alert.objects.create(
            dedup_key="no_driver:x:2026-07",
            type=AlertType.NO_DRIVER,
            level=AlertLevel.WARNING,
            message="Vehículo sin conductor desde hace más de 7 días.",
            vehicle=self.vehicle,
        )
        self.client.force_authenticate(self.admin)

    def _notify(self, **extra):
        return self.client.post(
            reverse("vehicle-notify", args=[self.vehicle.pk]),
            {"template_key": "state_notice", "to_supervisor": True, **extra},
            format="json",
        )

    def test_alert_phrase_fills_the_message(self):
        self.assertEqual(self._notify(alert=self.alert.pk).status_code, 200)
        self.assertIn("sin conductor desde hace", EmailLog.objects.get().body_html)

    def test_written_message_still_wins(self):
        self._notify(alert=self.alert.pk, message="Texto escrito a mano")
        body = EmailLog.objects.get().body_html
        self.assertIn("Texto escrito a mano", body)
        self.assertNotIn("sin conductor desde hace", body)


class _FleetCase(APITestCase):
    def setUp(self):
        EmailTemplate.objects.all().delete()
        self.admin = make_user("admin", Role.ADMIN)
        self.driver = _user("carlos", Role.DRIVER, "Carlos")
        self.supervisor = _user("sara", Role.SUPERVISOR, "Sara")
        self.vehicle = Vehicle.objects.create(
            plate="1234KLM", brand="a", model="b", supervisor=self.supervisor
        )
        self.assignment = Assignment.objects.create(
            vehicle=self.vehicle,
            driver=self.driver,
            start_date=TODAY - timedelta(days=100),
            status=AssignmentStatus.ACCEPTED,
        )
        cfg = EmailSettings.get_solo()
        cfg.km_remind_enabled = True
        cfg.km_remind_to_driver = True
        cfg.km_remind_to_supervisor = True
        cfg.save()

    def _km_alert(self):
        return Alert.objects.create(
            dedup_key="km_pending:x:2026-07",
            type=AlertType.KM_READING_PENDING,
            level=AlertLevel.WARNING,
            message="Lectura pendiente",
            vehicle=self.vehicle,
        )


class CoveredVehicleTests(_FleetCase):
    """Al principal cubierto por un sustituto no se le reclama la lectura: el
    back no deja registrarla en él."""

    def test_blocked_main_vehicle_gets_no_km_reminder(self):
        from fleet.models import VehicleLink

        sustituto = Vehicle.objects.create(
            plate="9999SUS", brand="a", model="b", is_substitute=True, unlimited_km=True
        )
        VehicleLink.objects.create(
            main_vehicle=self.vehicle,
            substitute_vehicle=sustituto,
            reason="breakdown",
            start_date=TODAY - timedelta(days=3),
        )
        alerts.check_km_readings(today=TODAY)
        self.assertFalse(Alert.objects.filter(vehicle=self.vehicle).exists())

    def test_without_link_it_is_reminded(self):
        alerts.check_km_readings(today=TODAY)
        self.assertTrue(
            Alert.objects.filter(vehicle=self.vehicle, type=AlertType.KM_READING_PENDING).exists()
        )


class CopyNoteTests(_FleetCase):
    """Quien recibe el aviso en copia lo lee dicho; a quien va dirigido, no."""

    @EMAIL_ON
    def test_supervisor_copy_says_whose_notice_it_is(self):
        mailer.queue_for_alert(self._km_alert())
        por_rol = {e.recipient_role: e.body_html for e in EmailOutbox.objects.all()}
        self.assertNotIn("Recibes una copia", por_rol["driver"])
        self.assertIn("Recibes una copia de este aviso, dirigido a Carlos", por_rol["supervisor"])
        self.assertIn("Hola Carlos:", por_rol["supervisor"])


class WrittenNoteTests(_FleetCase):
    """La nota escrita a mano sale también en las plantillas de km y consumo."""

    def test_note_reaches_the_km_template(self):
        for key in ("km_reading_pending", "fuel_reading_pending"):
            notice = mailer.render_vehicle_notice(
                self.vehicle, key, "Recordatorio: registra los km. Pásate hoy", note="Pásate hoy"
            )
            self.assertIn("Pásate hoy", notice.body_html)
            self.assertNotIn("Recordatorio:", notice.body_html)

    @EMAIL_ON
    def test_automatic_mail_carries_no_note(self):
        mailer.queue_for_alert(self._km_alert())
        self.assertNotIn("Lectura pendiente", EmailOutbox.objects.first().body_html)


class MissingDataTests(_FleetCase):
    """Un envío a mano cuya frase saldría con el hueco se rechaza y dice por qué."""

    def _notify(self, key):
        self.client.force_authenticate(self.admin)
        return self.client.post(
            reverse("vehicle-notify", args=[self.vehicle.pk]),
            {"template_key": key, "to_driver": True},
            format="json",
        )

    def test_itv_without_date_is_rejected(self):
        res = self._notify("itv_due")
        self.assertEqual(res.status_code, 400)
        self.assertIn("no tiene ITV programada", res.data["detail"])
        self.assertFalse(EmailLog.objects.exists())

    def test_itv_with_date_goes_out(self):
        self.vehicle.next_itv_date = TODAY + timedelta(days=10)
        self.vehicle.save(update_fields=["next_itv_date"])
        self.assertEqual(self._notify("itv_due").status_code, 200)

    def test_overage_without_projection_is_rejected(self):
        self.assertEqual(self._notify("km_overage").status_code, 400)


class RentingOfClosedContractTests(_FleetCase):
    """Sin contrato abierto, `{{empresa}}` es la renting del último: la misma
    a la que se manda el correo."""

    def test_company_matches_the_recipient(self):
        Contract.objects.create(
            vehicle=self.vehicle,
            renting=Renting.objects.create(name="ALD", email="flota@ald.example"),
            start_date=TODAY - timedelta(days=400),
            planned_end_date=TODAY - timedelta(days=30),
            end_date=TODAY - timedelta(days=30),
        )
        contexto = mailer.vehicle_notice_context(self.vehicle, template_key="insurance_due")
        self.assertEqual(contexto["empresa"], "ALD")
        self.assertEqual(mailer.renting_for(self.vehicle).email, "flota@ald.example")


class DeliveryRefreshTests(_FleetCase):
    """Lo encolado se pone al día al entregarse: ni a quien ya no lleva el
    coche ni de un aviso que ya se cerró."""

    @EMAIL_ON
    def test_former_driver_does_not_get_it(self):
        from django.core import mail

        mailer.queue_for_alert(self._km_alert())
        self.assignment.end_date = TODAY - timedelta(days=1)
        self.assignment.save(update_fields=["end_date"])
        mailer.send_outbox()
        self.assertEqual([m.to for m in mail.outbox], [["sara@flota.dev"]])
        omitido = EmailLog.objects.get(status=EmailLog.Status.SKIPPED)
        self.assertEqual(omitido.recipient, "carlos@flota.dev")

    @EMAIL_ON
    def test_closed_alert_is_not_mailed(self):
        from django.core import mail

        from fleet.models.enums import AlertStatus

        alert = self._km_alert()
        mailer.queue_for_alert(alert)
        Alert.objects.filter(pk=alert.pk).update(status=AlertStatus.RESOLVED)
        self.assertEqual(mailer.send_outbox(), {"sent": 0, "failed": 0, "retry": 0})
        self.assertEqual(len(mail.outbox), 0)


class SecondPassTests(_FleetCase):
    """Lo que salió al repasar las correcciones de arriba."""

    def setUp(self):
        super().setUp()
        self.client.force_authenticate(self.admin)

    def test_alert_phrase_is_not_a_written_note(self):
        # El botón rápido del aviso de km: la frase del aviso rellena
        # `{{mensaje}}`, pero no es una nota de nadie y no va a `{{nota}}`.
        alert = self._km_alert()
        res = self.client.post(
            reverse("vehicle-notify", args=[self.vehicle.pk]),
            {"template_key": "km_reading_pending", "to_driver": True, "alert": alert.pk},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)
        self.assertNotIn("Lectura pendiente", EmailLog.objects.get().body_html)

    def test_renting_copy_of_a_driver_notice_says_so(self):
        Contract.objects.create(
            vehicle=self.vehicle,
            renting=Renting.objects.create(name="ALD", email="flota@ald.example"),
            start_date=TODAY - timedelta(days=100),
            planned_end_date=TODAY + timedelta(days=265),
        )
        self.client.post(
            reverse("vehicle-notify", args=[self.vehicle.pk]),
            {"template_key": "state_notice", "message": "Hola", "to_renting": True},
            format="json",
        )
        self.assertIn("Recibes una copia", EmailLog.objects.get().body_html)

    def test_rejected_field_reminder_leaves_no_alert(self):
        res = self.client.post(
            reverse("vehicle-remind", args=[self.vehicle.pk]),
            {"kind": "itv_due", "send_email": True, "create_alert": True},
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        self.assertFalse(Alert.objects.exists())
