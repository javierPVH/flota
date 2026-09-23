"""El exceso de km PROYECTADO es de gestión: al conductor no se le enseña.

La alerta `km_overage` se arregla cambiando quién lleva el coche, y eso lo
decide gestión —quien supervisa propone, administración cambia—. Por eso ni la
alerta (bandeja y push) ni la proyección de la que sale (resúmenes) viajan al
conductor: las ve el supervisor, el admin y HSE (que lee).
"""

from datetime import date
from unittest import mock

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import Alert, Assignment, Vehicle
from fleet.models.enums import AlertLevel, AlertType, AssignmentStatus
from fleet.services import alerts, metrics

from .helpers import make_user


class KmOverageVisibilityTests(APITestCase):
    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.supervisor = make_user("sup", Role.SUPERVISOR)
        self.driver = make_user("driver", Role.DRIVER)
        self.hse = make_user("hse", Role.HSE)
        self.vehicle = Vehicle.objects.create(
            plate="OVR1", brand="a", model="b", supervisor=self.supervisor
        )
        Assignment.objects.create(
            vehicle=self.vehicle,
            driver=self.driver,
            start_date=date(2026, 1, 1),
            status=AssignmentStatus.ACCEPTED,
        )
        self.overage = Alert.objects.create(
            type=AlertType.KM_OVERAGE,
            level=AlertLevel.WARNING,
            message="Proyección 70000 km supera los 60000 km contratados (117%).",
            vehicle=self.vehicle,
            dedup_key="km_overage:test",
        )
        self.itv = Alert.objects.create(
            type=AlertType.ITV_DUE,
            level=AlertLevel.WARNING,
            message="ITV próxima",
            vehicle=self.vehicle,
            dedup_key="itv:test",
        )

    def _types(self, user) -> set[str]:
        self.client.force_authenticate(user)
        resp = self.client.get(reverse("alert-list"), {"status": "open"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        return {row["type"] for row in resp.data["results"]}

    def test_driver_does_not_see_the_overage_alert(self):
        self.assertEqual(self._types(self.driver), {AlertType.ITV_DUE})
        # Tampoco por id: no existe para él.
        resp = self.client.get(reverse("alert-detail", args=[self.overage.pk]))
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_management_and_hse_see_it(self):
        for user in (self.supervisor, self.admin, self.hse):
            with self.subTest(user=user.username):
                self.assertIn(AlertType.KM_OVERAGE, self._types(user))

    def test_supervisor_plus_driver_still_sees_it(self):
        """Los roles se suman: quien supervisa y además conduce es gestión."""
        both = make_user("both", Role.SUPERVISOR, Role.DRIVER)
        Assignment.objects.filter(vehicle=self.vehicle).update(driver=both)
        self.assertIn(AlertType.KM_OVERAGE, self._types(both))

    def test_push_of_the_overage_goes_to_the_supervisor_not_the_driver(self):
        with (
            mock.patch.object(alerts.webpush, "push_enabled", return_value=True),
            mock.patch.object(alerts.webpush, "send_to_user") as send,
        ):
            alerts.upsert_alert(
                dedup_key="km_overage:push",
                type=AlertType.KM_OVERAGE,
                level=AlertLevel.WARNING,
                message="Proyección 70000 km supera los 60000 km contratados (117%).",
                vehicle=self.vehicle,
                queue_email=False,
            )
            recipients = {call.args[0] for call in send.call_args_list}
        self.assertEqual(recipients, {self.supervisor})
        # Y el resto de alertas siguen llegando al conductor vigente.
        with (
            mock.patch.object(alerts.webpush, "push_enabled", return_value=True),
            mock.patch.object(alerts.webpush, "send_to_user") as send,
        ):
            alerts.upsert_alert(
                dedup_key="itv:push",
                type=AlertType.ITV_DUE,
                level=AlertLevel.WARNING,
                message="ITV próxima",
                vehicle=self.vehicle,
                queue_email=False,
            )
            recipients = {call.args[0] for call in send.call_args_list}
        self.assertEqual(recipients, {self.driver, self.supervisor})

    def test_projection_visibility_rule(self):
        self.assertFalse(metrics.projection_visible(self.driver))
        self.assertTrue(metrics.projection_visible(self.supervisor))
        self.assertTrue(metrics.projection_visible(self.admin))
        self.assertTrue(metrics.projection_visible(self.hse))
        self.assertTrue(
            metrics.projection_visible(make_user("both2", Role.SUPERVISOR, Role.DRIVER))
        )
