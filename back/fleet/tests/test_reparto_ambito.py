"""El REPARTO DE USO como tercera puerta del ámbito.

Un coche se alcanzaba por dos caminos: conducirlo (asignación vigente) o
supervisarlo. Ahora hay un tercero, el **reparto de uso vigente**: quien tiene
un coche repartido lo conduce de verdad unos días o unas horas, así que lee su
ficha y registra sobre él.

Lo que hay que fijar no es que la rama exista, sino las dos cosas que de
romperse no darían error sino **acceso de más o de menos**:

- que el reparto abre el coche **mientras está vigente** y lo cierra en cuanto
  deja de estarlo (fin pasado, inicio futuro, desactivado) — es un permiso con
  fecha de caducidad;
- y que **no convierte a nadie en el conductor** del coche: el titular sigue
  siendo quien es, a él se le sigue reclamando la lectura del mes y el coche sin
  conductor sigue abriendo su aviso aunque esté repartido.
"""

from datetime import timedelta

from django.test import override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import Assignment, Vehicle, VehicleUsage
from fleet.models.enums import AssignmentStatus, IncidentType
from fleet.selectors import current_driver_map
from fleet.services import alerts

from .helpers import make_user

API = "/api/v1"


def _coche(plate, supervisor=None, **extra):
    return Vehicle.objects.create(
        plate=plate, brand="Seat", model="León", supervisor=supervisor, **extra
    )


def _reparto(vehicle, driver, **extra):
    """Un reparto VIGENTE salvo que el caso diga otra cosa."""
    datos = {"usage_percent": 50, "start_date": timezone.localdate() - timedelta(days=30)}
    datos.update(extra)
    return VehicleUsage.objects.create(vehicle=vehicle, driver=driver, **datos)


class RepartoAmbitoTests(APITestCase):
    """Quién alcanza un coche repartido: el del reparto, y solo él."""

    def setUp(self):
        self.chofer = make_user("rep-drv", Role.DRIVER)
        self.otro = make_user("rep-otro", Role.DRIVER)
        self.titular = make_user("rep-tit", Role.DRIVER)
        self.coche = _coche("REP0001")
        # El coche TIENE su conductor titular: el reparto no lo sustituye.
        Assignment.objects.create(
            vehicle=self.coche,
            driver=self.titular,
            status=AssignmentStatus.ACCEPTED,
            start_date=timezone.localdate() - timedelta(days=60),
        )
        _reparto(self.coche, self.chofer)

    def _matriculas(self, usuario):
        self.client.force_authenticate(usuario)
        resp = self.client.get(f"{API}/vehicles/?page_size=500")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        filas = resp.data["results"] if isinstance(resp.data, dict) else resp.data
        return {f["plate"] for f in filas}

    def test_el_coche_repartido_llega_en_el_listado(self):
        self.assertIn("REP0001", self._matriculas(self.chofer))

    def test_y_tambien_su_ficha_y_su_resumen(self):
        self.client.force_authenticate(self.chofer)
        self.assertEqual(
            self.client.get(f"{API}/vehicles/{self.coche.pk}/").status_code,
            status.HTTP_200_OK,
        )
        self.assertEqual(
            self.client.get(f"{API}/vehicles/{self.coche.pk}/summary/").status_code,
            status.HTTP_200_OK,
        )

    def test_quien_no_tiene_reparto_no_lo_alcanza(self):
        self.assertNotIn("REP0001", self._matriculas(self.otro))
        self.client.force_authenticate(self.otro)
        self.assertEqual(
            self.client.get(f"{API}/vehicles/{self.coche.pk}/").status_code,
            status.HTTP_404_NOT_FOUND,
        )

    def test_el_reparto_abre_el_coche_aunque_no_se_tenga_rol_de_conductor(self):
        """La rama del reparto no mira el rol: lo tiene quien lo tiene.

        Un supervisor puede tener repartido un coche que NO supervisa, y su
        tarjeta de «Reparto» no puede enlazar a un 404.
        """
        jefa = make_user("rep-sup", Role.SUPERVISOR)
        _reparto(self.coche, jefa)
        self.assertIn("REP0001", self._matriculas(jefa))


@override_settings(FLEET_KM_WINDOW_START=0)  # sin ventana N8a: el día del test no decide
class RepartoEscrituraTests(APITestCase):
    """Sobre un coche repartido se REGISTRA, que es lo que se decidió."""

    def setUp(self):
        self.chofer = make_user("repw-drv", Role.DRIVER)
        self.coche = _coche("REP0002")
        _reparto(self.coche, self.chofer)
        self.hoy = timezone.localdate()
        self.client.force_authenticate(self.chofer)

    def test_registra_la_lectura_de_km(self):
        resp = self.client.post(
            f"{API}/km-readings/",
            {
                "vehicle": self.coche.pk,
                "km_reading": 12345,
                "reading_date": self.hoy.isoformat(),
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)

    def test_registra_el_consumo(self):
        resp = self.client.post(
            f"{API}/fuel-consumptions/add/",
            {
                "vehicle": self.coche.pk,
                "avg_consumption": "6.4",
                "reading_date": self.hoy.isoformat(),
            },
            format="json",
        )
        self.assertIn(resp.status_code, (status.HTTP_200_OK, status.HTTP_201_CREATED), resp.data)

    def test_abre_una_incidencia(self):
        resp = self.client.post(
            f"{API}/incidents/",
            {
                "vehicle": self.coche.pk,
                "type": IncidentType.BREAKDOWN,
                "description": "Ruido al frenar.",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)

    def test_en_un_coche_sin_reparto_no(self):
        """El control: la puerta la abre el reparto, no el rol."""
        ajeno = _coche("REP0003")
        resp = self.client.post(
            f"{API}/km-readings/",
            {"vehicle": ajeno.pk, "km_reading": 10, "reading_date": self.hoy.isoformat()},
            format="json",
        )
        self.assertIn(resp.status_code, (400, 403, 404))


class RepartoVigenciaTests(APITestCase):
    """El acceso dura lo que dura el reparto, ni un día más."""

    def setUp(self):
        self.chofer = make_user("repv-drv", Role.DRIVER)
        self.hoy = timezone.localdate()

    def _alcanza(self, vehicle):
        self.client.force_authenticate(self.chofer)
        return self.client.get(f"{API}/vehicles/{vehicle.pk}/").status_code == status.HTTP_200_OK

    def test_un_reparto_ya_terminado_no_da_nada(self):
        coche = _coche("REP0010")
        _reparto(
            coche,
            self.chofer,
            start_date=self.hoy - timedelta(days=60),
            end_date=self.hoy - timedelta(days=1),
        )
        self.assertFalse(self._alcanza(coche))

    def test_uno_que_termina_HOY_tampoco(self):
        """Misma vigencia que el resto del dominio: fin == hoy ya no cuenta."""
        coche = _coche("REP0011")
        _reparto(coche, self.chofer, end_date=self.hoy)
        self.assertFalse(self._alcanza(coche))

    def test_uno_que_aun_no_ha_empezado_tampoco(self):
        coche = _coche("REP0012")
        _reparto(coche, self.chofer, start_date=self.hoy + timedelta(days=5))
        self.assertFalse(self._alcanza(coche))

    def test_uno_DESACTIVADO_tampoco(self):
        """N7: nada se borra, así que retirar un reparto es desactivarlo — y
        tiene que cerrar el acceso igual que borrarlo."""
        coche = _coche("REP0013")
        reparto = _reparto(coche, self.chofer)
        self.assertTrue(self._alcanza(coche))
        reparto.is_active = False
        reparto.save(update_fields=["is_active"])
        self.assertFalse(self._alcanza(coche))

    def test_uno_sin_fechas_vale_desde_siempre(self):
        coche = _coche("REP0014")
        _reparto(coche, self.chofer, start_date=None)
        self.assertTrue(self._alcanza(coche))


class RepartoMultiusuarioTests(APITestCase):
    """En un coche de pool el reparto no abre nada: de él responde su
    supervisor, y su histórico de conductores tampoco da acceso."""

    def test_el_reparto_de_un_multiusuario_no_da_ambito(self):
        supervisor = make_user("repm-sup", Role.SUPERVISOR)
        chofer = make_user("repm-drv", Role.DRIVER)
        pool = _coche("REP0020", supervisor=supervisor, is_multiuser=True)
        normal = _coche("REP0021", supervisor=supervisor)
        _reparto(pool, chofer)
        _reparto(normal, chofer)

        self.client.force_authenticate(chofer)
        # El normal es el control de que el reparto, por sí mismo, sí abre.
        self.assertEqual(
            self.client.get(f"{API}/vehicles/{normal.pk}/").status_code, status.HTTP_200_OK
        )
        self.assertEqual(
            self.client.get(f"{API}/vehicles/{pool.pk}/").status_code, status.HTTP_404_NOT_FOUND
        )


class RepartoNoEsConduccionTests(APITestCase):
    """Repartir no es asignar: el coche conserva su titular y sus avisos."""

    def setUp(self):
        self.chofer = make_user("repc-drv", Role.DRIVER)
        self.titular = make_user("repc-tit", Role.DRIVER)

    def test_el_del_reparto_no_sale_como_conductor_vigente(self):
        coche = _coche("REP0030")
        Assignment.objects.create(
            vehicle=coche,
            driver=self.titular,
            status=AssignmentStatus.ACCEPTED,
            start_date=timezone.localdate() - timedelta(days=10),
        )
        _reparto(coche, self.chofer)
        self.assertEqual(current_driver_map([coche.pk])[coche.pk].pk, self.titular.pk)

    def test_un_coche_repartido_SIN_conductor_sigue_abriendo_su_aviso(self):
        """Si no, repartir un coche sería la manera de callar «sin conductor»
        sin ponerle ninguno."""
        coche = _coche("REP0031", supervisor=make_user("repc-sup", Role.SUPERVISOR))
        _reparto(coche, self.chofer)

        alerts.check_no_driver()

        self.assertTrue(coche.alerts.exists())

    def test_tener_un_coche_repartido_no_impide_tener_el_propio(self):
        """`driver_assignment_clash` mira asignaciones: usar un coche unas
        horas no puede quitarle a nadie el suyo."""
        repartido = _coche("REP0032")
        propio = _coche("REP0033")
        _reparto(repartido, self.chofer)
        Assignment.objects.create(
            vehicle=propio,
            driver=self.chofer,
            status=AssignmentStatus.ACCEPTED,
            start_date=timezone.localdate(),
        )
        self.assertEqual(current_driver_map([propio.pk])[propio.pk].pk, self.chofer.pk)
