"""Envíos programados por el usuario (Ajustes → Notificaciones).

Cubre las tres cosas que pueden salir mal sin que nadie se entere: el cálculo de
cuándo toca (que decide si el correo llega o no llega), el **ámbito** del
contenido (que decide si llega información que no le corresponde a quien lo
recibe) y el reparto a correo y Drive.
"""

from datetime import datetime, time, timedelta

from django.core import mail
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import EmailOutbox, NotificationSchedule, Vehicle
from fleet.services import notifications

from .helpers import make_user


def _aware(y, m, d, hh, mm=0):
    return timezone.make_aware(datetime(y, m, d, hh, mm), timezone.get_current_timezone())


def _user(username, *roles, email=""):
    """`make_user` no fija correo, y aquí el correo ES el destinatario."""
    user = make_user(username, *roles)
    if email:
        user.email = email
        user.save(update_fields=["email"])
    return user


class DueCalculationTests(APITestCase):
    """Cuándo toca. Sin esto, un envío se duplica o no sale nunca."""

    def setUp(self):
        self.user = _user("notif-admin", Role.ADMIN, email="admin@flota.dev")

    def _schedule(self, **kwargs):
        base = {
            "user": self.user,
            "name": "Prueba",
            "content": NotificationSchedule.Content.SUMMARY,
            "frequency": NotificationSchedule.Frequency.DAILY,
            "send_at": time(8, 0),
        }
        return NotificationSchedule.objects.create(**{**base, **kwargs})

    def test_daily_is_due_after_its_hour_and_only_once(self):
        schedule = self._schedule()
        antes = _aware(2026, 8, 20, 7, 30)
        despues = _aware(2026, 8, 20, 8, 15)

        # A las 7:30 el vencimiento vigente es el de AYER a las 8:00.
        self.assertEqual(notifications.previous_due(schedule, antes), _aware(2026, 8, 19, 8, 0))
        self.assertEqual(notifications.previous_due(schedule, despues), _aware(2026, 8, 20, 8, 0))

        self.assertTrue(notifications.is_due(schedule, despues))
        # Tras despacharlo, en la misma tanda ya no toca.
        schedule.last_run_at = despues
        self.assertFalse(notifications.is_due(schedule, despues))
        # Y al día siguiente vuelve a tocar.
        self.assertTrue(notifications.is_due(schedule, _aware(2026, 8, 21, 8, 5)))

    def test_weekly_only_on_its_weekday(self):
        # 2026-08-20 es jueves (weekday 3); el envío es de los lunes (0).
        schedule = self._schedule(
            frequency=NotificationSchedule.Frequency.WEEKLY, weekday=0, send_at=time(7, 0)
        )
        jueves = _aware(2026, 8, 20, 9, 0)
        self.assertEqual(notifications.previous_due(schedule, jueves), _aware(2026, 8, 17, 7, 0))
        # Ese lunes queda a más de MAX_DELAY: no se recupera con 3 días de retraso.
        self.assertFalse(notifications.is_due(schedule, jueves))
        # El propio lunes, pasada la hora, sí.
        self.assertTrue(notifications.is_due(schedule, _aware(2026, 8, 17, 7, 5)))

    def test_monthly_uses_its_day(self):
        schedule = self._schedule(
            frequency=NotificationSchedule.Frequency.MONTHLY, day_of_month=1, send_at=time(9, 0)
        )
        # El día 1 antes de la hora, el vencimiento vigente es el del mes anterior.
        self.assertEqual(
            notifications.previous_due(schedule, _aware(2026, 8, 1, 8, 0)),
            _aware(2026, 7, 1, 9, 0),
        )
        self.assertTrue(notifications.is_due(schedule, _aware(2026, 8, 1, 9, 10)))

    def test_stale_schedule_is_not_replayed(self):
        """Tras una caída larga se manda el último turno, no todos los perdidos."""
        schedule = self._schedule(last_run_at=_aware(2026, 1, 1, 8, 0))
        # Vencimiento vigente = ayer 8:00; el retraso es de horas, así que toca.
        self.assertTrue(notifications.is_due(schedule, _aware(2026, 8, 20, 8, 30)))
        # Pero un vencimiento de hace más de un día no se recupera.
        semanal = self._schedule(
            frequency=NotificationSchedule.Frequency.WEEKLY, weekday=0, send_at=time(7, 0)
        )
        self.assertFalse(notifications.is_due(semanal, _aware(2026, 8, 22, 7, 0)))

    def test_disabled_never_runs(self):
        schedule = self._schedule(enabled=False)
        self.assertFalse(notifications.is_due(schedule, _aware(2026, 8, 20, 8, 30)))

    def test_next_due_is_in_the_future(self):
        schedule = self._schedule()
        siguiente = notifications.next_due(schedule, _aware(2026, 8, 20, 9, 0))
        self.assertEqual(siguiente, _aware(2026, 8, 21, 8, 0))


@override_settings(
    FLEET_EMAIL_ENABLED=True, EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend"
)
class DispatchTests(APITestCase):
    """Reparto: cola de correo, adjunto y destinatarios."""

    def setUp(self):
        self.user = _user("notif-admin", Role.ADMIN, email="admin@flota.dev")
        Vehicle.objects.create(plate="NOTIF-1", brand="a", model="b")
        mail.outbox = []

    def test_summary_goes_in_the_body_without_attachment(self):
        schedule = NotificationSchedule.objects.create(
            user=self.user,
            name="Resumen",
            content=NotificationSchedule.Content.SUMMARY,
            frequency=NotificationSchedule.Frequency.DAILY,
            send_at=time(8, 0),
            extra_recipients="admin@flota.dev",
        )
        resultado = notifications.run_schedule(schedule)
        self.assertTrue(resultado["queued"])
        entrada = EmailOutbox.objects.get()
        self.assertFalse(entrada.attachment)
        self.assertIn("Resumen de la flota", entrada.body_html)
        self.assertEqual(entrada.recipient, "admin@flota.dev")

    def test_report_is_queued_with_its_file_attached(self):
        schedule = NotificationSchedule.objects.create(
            user=self.user,
            name="Flota",
            content=NotificationSchedule.Content.FLEET,
            frequency=NotificationSchedule.Frequency.DAILY,
            send_at=time(8, 0),
            extra_recipients="admin@flota.dev",
        )
        notifications.run_schedule(schedule)
        entrada = EmailOutbox.objects.get()
        self.assertTrue(entrada.attachment)
        # El fichero se llama como el envío, no `informe_<kind>`: así el que
        # recibe el correo reconoce lo que ha pedido. Y va en CSV, el único
        # formato de los envíos programados.
        self.assertEqual(entrada.attachment_name, "Flota.csv")

        # Y al entregarlo, el adjunto llega y el fichero se limpia de la cola.
        from fleet.services import mailer

        mailer.send_outbox()
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(len(mail.outbox[0].attachments), 1)
        self.assertEqual(mail.outbox[0].attachments[0][0], "Flota.csv")
        entrada.refresh_from_db()
        self.assertFalse(entrada.attachment)
        self.assertEqual(entrada.attachment_name, "Flota.csv")

    def test_only_the_listed_addresses_receive_it(self):
        """El correo del dueño no se añade solo: se programa para quien se diga."""
        schedule = NotificationSchedule.objects.create(
            user=self.user,  # su correo es admin@flota.dev
            name="Resumen",
            content=NotificationSchedule.Content.SUMMARY,
            frequency=NotificationSchedule.Frequency.DAILY,
            send_at=time(8, 0),
            extra_recipients="jefe@flota.dev, JEFE@flota.dev, taller@flota.dev",
        )
        # Sin repetidos (da igual la caja) y sin el dueño, que no está escrito.
        self.assertEqual(
            notifications.recipients_for(schedule), ["jefe@flota.dev", "taller@flota.dev"]
        )
        notifications.run_schedule(schedule)
        self.assertEqual(EmailOutbox.objects.get().recipient, "jefe@flota.dev, taller@flota.dev")

    def test_a_failing_schedule_records_the_error_and_does_not_raise(self):
        # El formulario lo impide; una fila así solo puede venir del admin de
        # Django o de un seed, y el despacho tiene que aguantarla.
        schedule = NotificationSchedule.objects.create(
            user=_user("sin-correo", Role.ADMIN, email=""),
            name="Sin destinatario",
            content=NotificationSchedule.Content.SUMMARY,
            frequency=NotificationSchedule.Frequency.DAILY,
            send_at=time(8, 0),
        )
        resultado = notifications.run_schedule(schedule)
        self.assertFalse(resultado["queued"])
        schedule.refresh_from_db()
        self.assertEqual(schedule.last_status, NotificationSchedule.Status.FAILED)
        self.assertIn("dirección de correo", schedule.last_error)

    def test_dispatch_only_touches_the_due_ones(self):
        vencido = NotificationSchedule.objects.create(
            user=self.user,
            name="Vencido",
            content=NotificationSchedule.Content.SUMMARY,
            frequency=NotificationSchedule.Frequency.DAILY,
            send_at=time(0, 1),
            extra_recipients="admin@flota.dev",
        )
        NotificationSchedule.objects.create(
            user=self.user,
            name="Desactivado",
            content=NotificationSchedule.Content.SUMMARY,
            frequency=NotificationSchedule.Frequency.DAILY,
            send_at=time(0, 1),
            enabled=False,
        )
        total = notifications.dispatch(timezone.now())
        self.assertEqual(total["run"], 1)
        vencido.refresh_from_db()
        self.assertEqual(vencido.last_status, NotificationSchedule.Status.OK)


class ScopeTests(APITestCase):
    """El contenido se genera con el ámbito del DUEÑO, no del que dispara."""

    def test_report_of_a_supervisor_only_covers_their_group(self):
        supervisor = _user("sup", Role.SUPERVISOR, email="sup@flota.dev")
        admin = _user("adm", Role.ADMIN, email="adm@flota.dev")
        Vehicle.objects.create(plate="SUYO", brand="a", model="b", supervisor=supervisor)
        Vehicle.objects.create(plate="AJENO", brand="a", model="b")

        schedule = NotificationSchedule.objects.create(
            user=supervisor,
            name="Flota",
            content=NotificationSchedule.Content.FLEET,
            frequency=NotificationSchedule.Frequency.DAILY,
            send_at=time(8, 0),
            extra_recipients="sup@flota.dev",
        )
        # Lo despacha el job (no el supervisor), y aun así el ámbito es el suyo.
        notifications.run_schedule(schedule)
        entrada = EmailOutbox.objects.get()
        contenido = entrada.attachment.read().decode("utf-8", "replace")
        self.assertIn("SUYO", contenido)
        self.assertNotIn("AJENO", contenido)
        self.assertTrue(admin.is_admin)  # el admin existe pero no interviene


class NotificationApiTests(APITestCase):
    """La API: cada uno ve solo los suyos y no puede regalarse el de otro."""

    def setUp(self):
        self.admin = _user("api-admin", Role.ADMIN, email="a@flota.dev")
        self.otro = _user("api-otro", Role.ADMIN, email="b@flota.dev")
        self.driver = _user("api-driver", Role.DRIVER, email="d@flota.dev")
        self.mio = NotificationSchedule.objects.create(
            user=self.admin,
            name="Mío",
            content=NotificationSchedule.Content.SUMMARY,
            frequency=NotificationSchedule.Frequency.DAILY,
            send_at=time(8, 0),
            extra_recipients="a@flota.dev",
        )
        self.ajeno = NotificationSchedule.objects.create(
            user=self.otro,
            name="Ajeno",
            content=NotificationSchedule.Content.SUMMARY,
            frequency=NotificationSchedule.Frequency.DAILY,
            send_at=time(8, 0),
        )

    def test_list_only_returns_mine(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get(reverse("notificationschedule-list"))
        self.assertEqual([r["name"] for r in resp.data["results"]], ["Mío"])

    def test_cannot_reach_someone_elses(self):
        self.client.force_authenticate(self.admin)
        url = reverse("notificationschedule-detail", args=[self.ajeno.pk])
        self.assertEqual(self.client.get(url).status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.client.delete(url).status_code, status.HTTP_404_NOT_FOUND)

    def test_create_ignores_the_user_field_and_takes_the_requester(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post(
            reverse("notificationschedule-list"),
            {
                "name": "Nuevo",
                "content": "summary",
                "frequency": "daily",
                "send_at": "07:00",
                "send_email": True,
                "extra_recipients": "a@flota.dev",
                "user": self.otro.pk,  # se ignora: `user` es de solo lectura
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(NotificationSchedule.objects.get(name="Nuevo").user, self.admin)

    def test_new_schedule_does_not_fire_immediately(self):
        """Crear con una hora ya pasada no debe disparar el envío en el acto."""
        self.client.force_authenticate(self.admin)
        self.client.post(
            reverse("notificationschedule-list"),
            {
                "name": "Madrugada",
                "content": "summary",
                "frequency": "daily",
                "send_at": "00:01",
                "send_email": True,
                "extra_recipients": "a@flota.dev",
            },
        )
        creado = NotificationSchedule.objects.get(name="Madrugada")
        self.assertIsNotNone(creado.last_run_at)
        self.assertFalse(notifications.is_due(creado, timezone.now()))

    def test_validation_rejects_incoherent_setups(self):
        self.client.force_authenticate(self.admin)
        correo = {"send_email": True, "extra_recipients": "a@flota.dev"}
        casos = [
            # Semanal sin día de la semana.
            {
                "name": "x",
                "content": "summary",
                "frequency": "weekly",
                "send_at": "08:00",
                **correo,
            },
            # Mensual sin día del mes.
            {
                "name": "x",
                "content": "summary",
                "frequency": "monthly",
                "send_at": "08:00",
                **correo,
            },
            # Por correo pero sin ninguna dirección: no hay a quién mandarlo.
            {
                "name": "x",
                "content": "summary",
                "frequency": "daily",
                "send_at": "08:00",
                "send_email": True,
                "extra_recipients": "",
            },
            # Sin ningún destino.
            {
                "name": "x",
                "content": "summary",
                "frequency": "daily",
                "send_at": "08:00",
                "send_email": False,
            },
            # Drive sin carpeta.
            {
                "name": "x",
                "content": "fleet",
                "frequency": "daily",
                "send_at": "08:00",
                "send_email": False,
                "save_to_drive": True,
            },
            # El resumen no genera fichero: no puede ir a Drive.
            {
                "name": "x",
                "content": "summary",
                "frequency": "daily",
                "send_at": "08:00",
                "save_to_drive": True,
                "drive_folder": "abc",
                **correo,
            },
            # Destinatario extra que no es un correo.
            {
                "name": "x",
                "content": "summary",
                "frequency": "daily",
                "send_at": "08:00",
                "extra_recipients": "esto-no-es-un-correo",
            },
        ]
        for payload in casos:
            with self.subTest(payload=payload):
                resp = self.client.post(reverse("notificationschedule-list"), payload)
                self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST, resp.data)

    def test_driver_cannot_use_the_endpoint(self):
        self.client.force_authenticate(self.driver)
        resp = self.client.get(reverse("notificationschedule-list"))
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    @override_settings(
        FLEET_EMAIL_ENABLED=True, EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend"
    )
    def test_run_now_sends_it(self):
        self.client.force_authenticate(self.admin)
        mail.outbox = []
        resp = self.client.post(reverse("notificationschedule-run", args=[self.mio.pk]))
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertTrue(resp.data["queued"])
        self.assertEqual(len(mail.outbox), 1)

    def test_delete_removes_it_for_real(self):
        """Es configuración personal: no va al espacio de erratas (ver el modelo)."""
        self.client.force_authenticate(self.admin)
        url = reverse("notificationschedule-detail", args=[self.mio.pk])
        self.assertEqual(self.client.delete(url).status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(NotificationSchedule.objects.filter(pk=self.mio.pk).exists())

    def test_next_run_is_reported_for_the_screen(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get(reverse("notificationschedule-detail", args=[self.mio.pk]))
        self.assertIsNotNone(resp.data["next_run_at"])
        # Desactivado no tiene próximo envío que mostrar.
        self.mio.enabled = False
        self.mio.save(update_fields=["enabled"])
        resp = self.client.get(reverse("notificationschedule-detail", args=[self.mio.pk]))
        self.assertIsNone(resp.data["next_run_at"])


class DriveTests(APITestCase):
    """La carpeta de Drive la escribe el usuario: hay que aceptar id o URL."""

    def test_folder_id_from_url_or_bare_id(self):
        from fleet.services.archiver import folder_id_from

        self.assertEqual(folder_id_from("1AbC_dEf-123"), "1AbC_dEf-123")
        self.assertEqual(
            folder_id_from("https://drive.google.com/drive/folders/1AbC_dEf-123?usp=sharing"),
            "1AbC_dEf-123",
        )
        self.assertEqual(
            folder_id_from("https://drive.google.com/open?id=1AbC_dEf-123"), "1AbC_dEf-123"
        )
        self.assertEqual(folder_id_from(""), "")
        self.assertEqual(folder_id_from("carpeta con espacios"), "")

    def test_upload_is_skipped_when_drive_is_off(self):
        """Sin Drive configurado no lanza: el correo del mismo envío debe salir."""
        from fleet.services.archiver import upload_bytes

        with override_settings(GOOGLE_DRIVE_ENABLED=False):
            self.assertIsNone(upload_bytes("x.xlsx", b"abc", "1AbC"))

    def test_report_still_reaches_the_email_when_drive_fails(self):
        user = _user("drive-user", Role.ADMIN, email="d@flota.dev")
        Vehicle.objects.create(plate="DRV-1", brand="a", model="b")
        schedule = NotificationSchedule.objects.create(
            user=user,
            name="Flota a Drive",
            content=NotificationSchedule.Content.FLEET,
            frequency=NotificationSchedule.Frequency.DAILY,
            send_at=time(8, 0),
            send_email=True,
            extra_recipients="d@flota.dev",
            save_to_drive=True,
            drive_folder="1AbC_dEf-123",
        )
        with override_settings(GOOGLE_DRIVE_ENABLED=False):
            resultado = notifications.run_schedule(schedule)
        self.assertIsNone(resultado["drive_url"])
        self.assertTrue(resultado["queued"])
        schedule.refresh_from_db()
        self.assertEqual(schedule.last_status, NotificationSchedule.Status.OK)


class ScheduleTimeWindowTests(APITestCase):
    """MAX_DELAY: un vencimiento viejo no se despacha."""

    def test_max_delay_is_one_day(self):
        self.assertEqual(notifications.MAX_DELAY, timedelta(days=1))


class ReportKindsAndFiltersTests(APITestCase):
    """Los siete informes de la pantalla de Informes, con sus filtros."""

    def setUp(self):
        self.admin = _user("rep-admin", Role.ADMIN, email="a@flota.dev")
        self.client.force_authenticate(self.admin)

    def test_every_report_of_the_reports_screen_can_be_scheduled(self):
        from fleet.services import reports

        programables = {c for c in NotificationSchedule.Content.values if c != "summary"}
        # Ni sobra ni falta ninguno: si se añade un informe, salta aquí.
        self.assertEqual(programables, set(reports.REPORT_KINDS))

    def test_filters_reach_the_report(self):
        Vehicle.objects.create(plate="ACTIVO-1", brand="Seat", model="Leon")
        Vehicle.objects.create(plate="AVERIADO", brand="Ford", model="Focus", state="broken")
        schedule = NotificationSchedule.objects.create(
            user=self.admin,
            name="Solo Seat",
            content=NotificationSchedule.Content.FLEET,
            frequency=NotificationSchedule.Frequency.DAILY,
            send_at=time(8, 0),
            extra_recipients="a@flota.dev",
            filters={"brand": "Seat"},
        )
        notifications.run_schedule(schedule)
        contenido = EmailOutbox.objects.get().attachment.read().decode("utf-8", "replace")
        self.assertIn("ACTIVO-1", contenido)
        self.assertNotIn("AVERIADO", contenido)

    def test_api_rejects_filters_the_report_does_not_accept(self):
        resp = self.client.post(
            reverse("notificationschedule-list"),
            {
                "name": "x",
                "content": "users",
                "frequency": "daily",
                "send_at": "08:00",
                "send_email": True,
                "extra_recipients": "a@flota.dev",
                # `users` solo admite `role`.
                "filters": {"vehicle": "3"},
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST, resp.data)
        self.assertIn("filters", resp.data["errors"])

    def test_api_drops_empty_filters(self):
        resp = self.client.post(
            reverse("notificationschedule-list"),
            {
                "name": "x",
                "content": "fleet",
                "frequency": "daily",
                "send_at": "08:00",
                "send_email": True,
                "extra_recipients": "a@flota.dev",
                "filters": {"brand": "", "state": "broken"},
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(NotificationSchedule.objects.get(name="x").filters, {"state": "broken"})

    def test_summary_admits_no_filters(self):
        resp = self.client.post(
            reverse("notificationschedule-list"),
            {
                "name": "x",
                "content": "summary",
                "frequency": "daily",
                "send_at": "08:00",
                "send_email": True,
                "filters": {"state": "broken"},
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST, resp.data)


class FormatTests(APITestCase):
    """CSV es el único formato de los envíos programados."""

    def setUp(self):
        self.admin = _user("fmt-admin", Role.ADMIN, email="a@flota.dev")
        self.client.force_authenticate(self.admin)

    def test_only_csv_is_offered(self):
        self.assertEqual(NotificationSchedule.Format.values, ["csv"])

    def test_api_rejects_another_format(self):
        resp = self.client.post(
            reverse("notificationschedule-list"),
            {
                "name": "x",
                "content": "fleet",
                "fmt": "xlsx",
                "frequency": "daily",
                "send_at": "08:00",
                "send_email": True,
                "extra_recipients": "a@flota.dev",
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST, resp.data)

    def test_default_is_csv(self):
        resp = self.client.post(
            reverse("notificationschedule-list"),
            {
                "name": "sin formato",
                "content": "fleet",
                "frequency": "daily",
                "send_at": "08:00",
                "send_email": True,
                "extra_recipients": "a@flota.dev",
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(NotificationSchedule.objects.get(name="sin formato").fmt, "csv")


class NameWithDateAndTimeTests(APITestCase):
    """Fecha y hora en el nombre: asunto y fichero distinguibles entre entregas."""

    def setUp(self):
        self.user = _user("name-admin", Role.ADMIN, email="a@flota.dev")

    def _schedule(self, **kwargs):
        base = {
            "user": self.user,
            "name": "Informe de flota",
            "content": NotificationSchedule.Content.FLEET,
            "frequency": NotificationSchedule.Frequency.DAILY,
            "send_at": time(8, 0),
            "extra_recipients": "a@flota.dev",
        }
        return NotificationSchedule.objects.create(**{**base, **kwargs})

    def test_plain_name(self):
        schedule = self._schedule()
        self.assertEqual(
            notifications.composed_name(schedule, _aware(2026, 8, 21, 8, 5)), "Informe de flota"
        )

    def test_with_date(self):
        schedule = self._schedule(name_with_date=True)
        self.assertEqual(
            notifications.composed_name(schedule, _aware(2026, 8, 21, 8, 5)),
            "Informe de flota 2026-08-21",
        )

    def test_with_time_uses_a_filename_safe_separator(self):
        schedule = self._schedule(name_with_time=True)
        nombre = notifications.composed_name(schedule, _aware(2026, 8, 21, 8, 5))
        self.assertEqual(nombre, "Informe de flota 08-05")
        self.assertNotIn(":", nombre)

    def test_with_both_reaches_the_attachment_and_the_subject(self):
        schedule = self._schedule(name_with_date=True, name_with_time=True)
        notifications.run_schedule(schedule, _aware(2026, 8, 21, 8, 5))
        entrada = EmailOutbox.objects.get()
        self.assertEqual(entrada.attachment_name, "Informe de flota 2026-08-21 08-05.csv")
        self.assertEqual(entrada.subject, "Informe de flota 2026-08-21 08-05")

    def test_a_name_with_odd_characters_still_yields_a_usable_file(self):
        schedule = self._schedule(name='Flota / "2026" *?')
        notifications.run_schedule(schedule)
        nombre = EmailOutbox.objects.get().attachment_name
        for prohibido in ("/", '"', "*", "?"):
            self.assertNotIn(prohibido, nombre)
        self.assertTrue(nombre.endswith(".csv"))
