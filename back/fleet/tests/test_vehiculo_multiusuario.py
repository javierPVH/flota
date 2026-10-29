"""El vehículo MULTIUSUARIO: coche de pool, sin conductor y con su supervisor.

Lo que hay que fijar aquí no es que exista un booleano, sino las tres cosas que
ese booleano cambia y que, de romperse, no darían error sino **acceso**:

- que un conductor con asignación sobre el coche **no lo ve ni escribe en él**,
  que es lo que separa este coche de cualquier otro;
- que su supervisor sí, y la administración también;
- y que el coche no puede quedarse sin supervisor ni acumular un conductor
  vigente, porque entonces sería un coche al que no entra nadie.

El resto —el solape del histórico, la alerta que no se abre— cuelga de lo mismo.
"""

from datetime import date, timedelta

from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import Assignment, Vehicle
from fleet.models.enums import AssignmentStatus
from fleet.services import alerts

from .helpers import make_user


def _coche(plate, supervisor=None, **extra):
    return Vehicle.objects.create(
        plate=plate, brand="Seat", model="León", supervisor=supervisor, **extra
    )


class MultiuserScopeTests(APITestCase):
    """Quién alcanza el coche: el supervisor y el admin; el conductor no."""

    def setUp(self):
        self.supervisor = make_user("mu-sup", Role.SUPERVISOR)
        self.chofer = make_user("mu-drv", Role.DRIVER)
        self.admin = make_user("mu-adm", Role.ADMIN)
        self.pool = _coche("MUL0001", supervisor=self.supervisor, is_multiuser=True)
        # Una asignación que por fechas SERÍA vigente: es justo el caso que no
        # puede dar acceso. Se crea en bruto (el serializer exige fin cerrado).
        Assignment.objects.create(
            vehicle=self.pool,
            driver=self.chofer,
            status=AssignmentStatus.ACCEPTED,
            start_date=timezone.localdate() - timedelta(days=10),
            end_date=timezone.localdate() + timedelta(days=10),
        )

    def _matriculas(self, usuario):
        self.client.force_authenticate(usuario)
        resp = self.client.get(reverse("vehicle-list"))
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        filas = resp.data["results"] if isinstance(resp.data, dict) else resp.data
        return {f["plate"] for f in filas}

    def test_el_conductor_del_historico_no_recibe_el_coche(self):
        self.assertNotIn("MUL0001", self._matriculas(self.chofer))

    def test_su_supervisor_y_el_admin_si(self):
        self.assertIn("MUL0001", self._matriculas(self.supervisor))
        self.assertIn("MUL0001", self._matriculas(self.admin))

    def test_en_un_coche_normal_esa_misma_asignacion_si_da_acceso(self):
        """La diferencia está en la marca, no en las fechas ni en el rol."""
        normal = _coche("NRM0001", supervisor=self.supervisor)
        Assignment.objects.create(
            vehicle=normal,
            driver=self.chofer,
            status=AssignmentStatus.ACCEPTED,
            start_date=timezone.localdate() - timedelta(days=10),
        )
        self.assertIn("NRM0001", self._matriculas(self.chofer))

    def test_el_coche_no_dice_tener_conductor(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get(reverse("vehicle-detail", args=[self.pool.pk]))
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertIsNone(resp.data.get("driver_id"))
        self.assertTrue(resp.data["is_multiuser"])


class MultiuserWritesTests(APITestCase):
    """Km y combustible: el supervisor y la administración, nadie más."""

    def setUp(self):
        self.supervisor = make_user("muw-sup", Role.SUPERVISOR)
        self.chofer = make_user("muw-drv", Role.DRIVER)
        self.admin = make_user("muw-adm", Role.ADMIN)
        self.pool = _coche("MUL0002", supervisor=self.supervisor, is_multiuser=True)
        Assignment.objects.create(
            vehicle=self.pool,
            driver=self.chofer,
            status=AssignmentStatus.ACCEPTED,
            start_date=timezone.localdate() - timedelta(days=10),
            end_date=timezone.localdate() + timedelta(days=10),
        )

    def _anotar_km(self, usuario, km):
        self.client.force_authenticate(usuario)
        return self.client.post(
            reverse("kmreading-list"),
            {
                "vehicle": self.pool.pk,
                "km_reading": km,
                "reading_date": str(timezone.localdate()),
            },
            format="json",
        )

    def _anotar_combustible(self, usuario):
        self.client.force_authenticate(usuario)
        return self.client.post(
            reverse("fuelconsumption-add"),
            {
                "vehicle": self.pool.pk,
                "avg_consumption": "6.4",
                "reading_date": str(timezone.localdate()),
            },
            format="json",
        )

    def test_el_conductor_no_puede_anotar_ni_km_ni_combustible(self):
        # No es un permiso por rol: el coche está fuera de su ámbito, así que
        # para él ni existe.
        self.assertIn(
            self._anotar_km(self.chofer, 1000).status_code,
            (status.HTTP_403_FORBIDDEN, status.HTTP_400_BAD_REQUEST),
        )
        self.assertEqual(
            self._anotar_combustible(self.chofer).status_code, status.HTTP_403_FORBIDDEN
        )

    def test_el_admin_anota_las_dos_cosas(self):
        self.assertEqual(self._anotar_km(self.admin, 1000).status_code, status.HTTP_201_CREATED)
        self.assertEqual(self._anotar_combustible(self.admin).status_code, status.HTTP_201_CREATED)


class MultiuserInvariantTests(APITestCase):
    """Sin supervisor no hay multiusuario, y con conductor tampoco."""

    def setUp(self):
        self.admin = make_user("mui-adm", Role.ADMIN)
        self.supervisor = make_user("mui-sup", Role.SUPERVISOR)
        self.client.force_authenticate(self.admin)

    def test_marcarlo_sin_supervisor_se_rechaza(self):
        coche = _coche("MUL0003")
        resp = self.client.patch(
            reverse("vehicle-detail", args=[coche.pk]), {"is_multiuser": True}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("is_multiuser", resp.data["errors"])

    def test_quitarle_el_supervisor_a_uno_marcado_se_rechaza(self):
        coche = _coche("MUL0004", supervisor=self.supervisor, is_multiuser=True)
        resp = self.client.post(
            reverse("vehicle-set-driver", args=[coche.pk]), {"supervisor": None}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        coche.refresh_from_db()
        self.assertEqual(coche.supervisor, self.supervisor)

    def test_marcarlo_con_conductor_vigente_se_rechaza_y_dice_quien(self):
        """No se cierra la asignación por nuestra cuenta: retirar a quien lleva
        un coche es una decisión, y ya tiene su gesto («Cambiar conductor»)."""
        coche = _coche("MUL0005", supervisor=self.supervisor)
        chofer = make_user("mui-drv", Role.DRIVER)
        Assignment.objects.create(vehicle=coche, driver=chofer, status=AssignmentStatus.ACCEPTED)
        resp = self.client.patch(
            reverse("vehicle-detail", args=[coche.pk]), {"is_multiuser": True}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Cambiar conductor", str(resp.data))
        coche.refresh_from_db()
        self.assertFalse(coche.is_multiuser)

    def test_set_driver_marca_y_desmarca_el_multiusuario(self):
        """El modal de «Cambiar conductor / supervisor» lleva la marca: marcar
        con `driver: null` retira al conductor en el mismo gesto y exige
        supervisor; sin retirarlo se rechaza y dice quién; desmarcar admite
        ponerle conductor en la misma llamada."""
        coche = _coche("MUL0007", supervisor=self.supervisor)
        chofer = make_user("mui-drv3", Role.DRIVER)
        Assignment.objects.create(vehicle=coche, driver=chofer, status=AssignmentStatus.ACCEPTED)
        url = reverse("vehicle-set-driver", args=[coche.pk])
        # Con conductor y sin retirarlo: no.
        resp = self.client.post(url, {"is_multiuser": True}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("is_multiuser", resp.data["errors"])
        # Retirándolo en el mismo cuerpo: sí, y la asignación queda cerrada
        # HOY aunque venga una fecha futura (un fin programado la dejaría
        # vigente y la marca no entraría).
        resp = self.client.post(
            url,
            {
                "is_multiuser": True,
                "driver": None,
                "start_date": (timezone.localdate() + timedelta(days=10)).isoformat(),
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        coche.refresh_from_db()
        self.assertTrue(coche.is_multiuser)
        self.assertEqual(
            Assignment.objects.filter(vehicle=coche, status=AssignmentStatus.FINISHED).count(), 1
        )
        self.assertIsNone(resp.data["driver_id"])
        # Sin supervisor no se marca (ni quitándoselo en la misma llamada).
        otro = _coche("MUL0008")
        resp = self.client.post(
            reverse("vehicle-set-driver", args=[otro.pk]), {"is_multiuser": True}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("supervisor", resp.data["errors"])
        # Desmarcar y poner conductor, de una vez.
        resp = self.client.post(url, {"is_multiuser": False, "driver": chofer.pk}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        coche.refresh_from_db()
        self.assertFalse(coche.is_multiuser)
        self.assertEqual(resp.data["driver_id"], chofer.pk)

    def test_no_se_le_puede_poner_conductor(self):
        coche = _coche("MUL0006", supervisor=self.supervisor, is_multiuser=True)
        chofer = make_user("mui-drv2", Role.DRIVER)
        resp = self.client.post(
            reverse("vehicle-set-driver", args=[coche.pk]), {"driver": chofer.pk}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("driver", resp.data["errors"])


class MultiuserHistoryTests(APITestCase):
    """El histórico: varios a la vez, pero por periodos cerrados."""

    def setUp(self):
        self.admin = make_user("muh-adm", Role.ADMIN)
        self.supervisor = make_user("muh-sup", Role.SUPERVISOR)
        self.uno = make_user("muh-d1", Role.DRIVER)
        self.otro = make_user("muh-d2", Role.DRIVER)
        self.client.force_authenticate(self.admin)
        self.url = reverse("assignment-list")

    def _alta(self, coche, chofer, inicio, fin):
        return self.client.post(
            self.url,
            {
                "vehicle": coche.pk,
                "driver": chofer.pk,
                "status": AssignmentStatus.ACCEPTED,
                "start_date": str(inicio),
                "end_date": str(fin) if fin else None,
            },
            format="json",
        )

    def test_dos_conductores_en_el_mismo_tramo_conviven(self):
        pool = _coche("MUL0007", supervisor=self.supervisor, is_multiuser=True)
        primero = self._alta(pool, self.uno, date(2026, 3, 1), date(2026, 3, 31))
        self.assertEqual(primero.status_code, status.HTTP_201_CREATED, primero.data)
        segundo = self._alta(pool, self.otro, date(2026, 3, 10), date(2026, 3, 20))
        self.assertEqual(segundo.status_code, status.HTTP_201_CREATED, segundo.data)

    def test_en_un_coche_normal_ese_mismo_solape_se_rechaza(self):
        normal = _coche("NRM0002", supervisor=self.supervisor)
        self.assertEqual(
            self._alta(normal, self.uno, date(2026, 3, 1), date(2026, 3, 31)).status_code,
            status.HTTP_201_CREATED,
        )
        choque = self._alta(normal, self.otro, date(2026, 3, 10), date(2026, 3, 20))
        self.assertEqual(choque.status_code, status.HTTP_400_BAD_REQUEST)

    def test_sin_fecha_de_fin_se_rechaza(self):
        """Un multiusuario no tiene conductor vigente: su histórico son tramos."""
        pool = _coche("MUL0008", supervisor=self.supervisor, is_multiuser=True)
        resp = self._alta(pool, self.uno, date(2026, 3, 1), None)
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("end_date", resp.data["errors"])

    def test_usar_un_pool_no_impide_tener_el_coche_propio(self):
        """La regla de «un coche por conductor» no cuenta los de pool."""
        pool = _coche("MUL0009", supervisor=self.supervisor, is_multiuser=True)
        self.assertEqual(
            self._alta(pool, self.uno, date(2026, 3, 1), date(2026, 3, 31)).status_code,
            status.HTTP_201_CREATED,
        )
        propio = _coche("NRM0003", supervisor=self.supervisor)
        resp = self._alta(propio, self.uno, date(2026, 3, 5), date(2026, 3, 25))
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)


class MultiuserAlertsTests(APITestCase):
    """La alerta de «sin conductor» no aplica: no tenerlo es su definición."""

    def test_no_se_abre_aviso_de_vehiculo_sin_conductor(self):
        supervisor = make_user("mua-sup", Role.SUPERVISOR)
        pool = _coche("MUL0010", supervisor=supervisor, is_multiuser=True)
        huerfano = _coche("NRM0004", supervisor=supervisor)

        alerts.check_no_driver()

        abiertas = {a.vehicle_id for a in pool.alerts.all()} | {
            a.vehicle_id for a in huerfano.alerts.all()
        }
        # El normal sí lo abre (es el control de que el chequeo corrió).
        self.assertIn(huerfano.pk, abiertas)
        self.assertNotIn(pool.pk, abiertas)
