"""Histórico de supervisores con fechas (`SupervisorPeriod`).

Lo que se prueba aquí es la regla que le da sentido: **un coche tiene un
supervisor a la vez**, también hacia atrás. Y las dos caras del dato —el
vigente en `Vehicle.supervisor` y los tramos— no pueden separarse: tocar un
periodo que cubre hoy mueve el vigente, y cambiar el vigente por otra vía
mueve los periodos.
"""

from datetime import timedelta

from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import Assignment, SupervisorPeriod, Vehicle
from fleet.models.enums import AssignmentStatus

from .helpers import make_user

HOY = timezone.localdate()


class SupervisorPeriodApiTests(APITestCase):
    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.sara = make_user("sara", Role.SUPERVISOR)
        self.marta = make_user("marta", Role.SUPERVISOR)
        self.carlos = make_user("carlos", Role.DRIVER)
        self.vehicle = Vehicle.objects.create(plate="1234ABC", state="active")
        self.url = reverse("supervisorperiod-list")
        self.client.force_authenticate(self.admin)

    def test_crear_periodo_pone_el_supervisor_vigente_del_vehiculo(self):
        """Un periodo que cubre hoy ES el supervisor del coche."""
        resp = self.client.post(
            self.url,
            {
                "vehicle": self.vehicle.pk,
                "supervisor": self.sara.pk,
                "start_date": str(HOY - timedelta(days=10)),
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.supervisor, self.sara)

    def test_un_periodo_pasado_no_toca_al_vigente(self):
        """Corregir el histórico no cambia quién responde hoy del coche."""
        resp = self.client.post(
            self.url,
            {
                "vehicle": self.vehicle.pk,
                "supervisor": self.marta.pk,
                "start_date": str(HOY - timedelta(days=100)),
                "end_date": str(HOY - timedelta(days=50)),
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.vehicle.refresh_from_db()
        self.assertIsNone(self.vehicle.supervisor)

    def test_dos_supervisores_en_las_mismas_fechas_no(self):
        """La regla: un coche, un supervisor a la vez — y lo dice con nombre."""
        SupervisorPeriod.objects.create(
            vehicle=self.vehicle,
            supervisor=self.sara,
            start_date=HOY - timedelta(days=100),
            end_date=HOY - timedelta(days=50),
        )
        resp = self.client.post(
            self.url,
            {
                "vehicle": self.vehicle.pk,
                "supervisor": self.marta.pk,
                "start_date": str(HOY - timedelta(days=80)),
                "end_date": str(HOY - timedelta(days=20)),
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("sara", str(resp.data).lower())

    def test_el_relevo_no_es_solape(self):
        """Fin == inicio del siguiente: se releva, no se pisa."""
        SupervisorPeriod.objects.create(
            vehicle=self.vehicle,
            supervisor=self.sara,
            start_date=HOY - timedelta(days=100),
            end_date=HOY - timedelta(days=50),
        )
        resp = self.client.post(
            self.url,
            {
                "vehicle": self.vehicle.pk,
                "supervisor": self.marta.pk,
                "start_date": str(HOY - timedelta(days=50)),
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)

    def test_mover_la_fecha_de_fin_recalcula_el_vigente(self):
        """Cerrar ayer el periodo en curso deja al coche sin supervisor."""
        periodo = SupervisorPeriod.objects.create(
            vehicle=self.vehicle, supervisor=self.sara, start_date=HOY - timedelta(days=30)
        )
        self.vehicle.supervisor = self.sara
        self.vehicle.save(update_fields=["supervisor"])
        resp = self.client.patch(
            reverse("supervisorperiod-detail", args=[periodo.pk]),
            {"end_date": str(HOY - timedelta(days=1))},
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.vehicle.refresh_from_db()
        self.assertIsNone(self.vehicle.supervisor)

    def test_solo_supervisores(self):
        resp = self.client.post(
            self.url,
            {"vehicle": self.vehicle.pk, "supervisor": self.carlos.pk, "start_date": str(HOY)},
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_cambiar_el_supervisor_del_vehiculo_abre_su_periodo(self):
        """El cambio entra por «Cambiar conductor» y el histórico lo sigue."""
        SupervisorPeriod.objects.create(
            vehicle=self.vehicle, supervisor=self.sara, start_date=HOY - timedelta(days=30)
        )
        self.vehicle.supervisor = self.sara
        self.vehicle.save(update_fields=["supervisor"])
        resp = self.client.post(
            reverse("vehicle-set-driver", args=[self.vehicle.pk]),
            {"supervisor": self.marta.pk},
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        periodos = list(
            SupervisorPeriod.objects.filter(vehicle=self.vehicle, is_active=True).order_by(
                "start_date"
            )
        )
        self.assertEqual(len(periodos), 2)
        self.assertEqual(periodos[0].supervisor, self.sara)
        self.assertEqual(periodos[0].end_date, HOY)
        self.assertEqual(periodos[1].supervisor, self.marta)
        self.assertIsNone(periodos[1].end_date)

    def test_la_gestion_lee_pero_no_escribe(self):
        self.client.force_authenticate(self.sara)
        self.assertEqual(self.client.get(self.url).status_code, status.HTTP_200_OK)
        resp = self.client.post(
            self.url,
            {"vehicle": self.vehicle.pk, "supervisor": self.sara.pk, "start_date": str(HOY)},
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)


class AssignmentOverlapTests(APITestCase):
    """La misma regla para el conductor: un coche, uno a la vez."""

    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.carlos = make_user("carlos", Role.DRIVER)
        self.lucia = make_user("lucia", Role.DRIVER)
        self.vehicle = Vehicle.objects.create(plate="5678DEF", state="active")
        self.url = reverse("assignment-list")
        self.client.force_authenticate(self.admin)

    def test_dos_conductores_en_las_mismas_fechas_no(self):
        Assignment.objects.create(
            vehicle=self.vehicle,
            driver=self.carlos,
            start_date=HOY - timedelta(days=100),
            end_date=HOY - timedelta(days=50),
            status=AssignmentStatus.ACCEPTED,
        )
        resp = self.client.post(
            self.url,
            {
                "vehicle": self.vehicle.pk,
                "driver": self.lucia.pk,
                "start_date": str(HOY - timedelta(days=70)),
                "end_date": str(HOY - timedelta(days=20)),
                "status": AssignmentStatus.ACCEPTED,
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("carlos", str(resp.data).lower())

    def test_tambien_choca_con_una_finalizada(self):
        """Un tramo cerrado es un tramo: el relevo lo deja «finalizado»."""
        Assignment.objects.create(
            vehicle=self.vehicle,
            driver=self.carlos,
            start_date=HOY - timedelta(days=100),
            end_date=HOY - timedelta(days=50),
            status=AssignmentStatus.FINISHED,
        )
        resp = self.client.post(
            self.url,
            {
                "vehicle": self.vehicle.pk,
                "driver": self.lucia.pk,
                "start_date": str(HOY - timedelta(days=70)),
                "end_date": str(HOY - timedelta(days=20)),
                "status": AssignmentStatus.ACCEPTED,
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("carlos", str(resp.data).lower())

    def test_el_hueco_libre_si(self):
        Assignment.objects.create(
            vehicle=self.vehicle,
            driver=self.carlos,
            start_date=HOY - timedelta(days=100),
            end_date=HOY - timedelta(days=50),
            status=AssignmentStatus.ACCEPTED,
        )
        resp = self.client.post(
            self.url,
            {
                "vehicle": self.vehicle.pk,
                "driver": self.lucia.pk,
                "start_date": str(HOY - timedelta(days=50)),
                "end_date": str(HOY - timedelta(days=20)),
                "status": AssignmentStatus.ACCEPTED,
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
