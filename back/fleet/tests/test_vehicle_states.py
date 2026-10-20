"""Los NUEVE estados del vehículo y las dos maneras de salir de la flota.

Hasta ahora `retired` («Devuelto (baja)») significaba las dos cosas a la vez, y
era además el único marcador de «fuera de la flota». Al partirlo —`returned`
para la devolución del renting, `retired` para cualquier otra baja— lo que hay
que fijar es justo lo que antes no se podía confundir:

- que «fuera de la flota» son **dos** valores y no uno (`OUT_OF_FLEET`), de
  modo que ningún queryset ni ninguna guarda se quede mirando solo una puerta;
- y que `pending_return`, que se les parece, **sigue dentro**: cuenta en
  listados, métricas e informes, que es exactamente lo que lo separa.
"""

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import Vehicle
from fleet.models.enums import OUT_OF_FLEET, VehicleState

from .helpers import make_user


class VehicleStateCatalogTests(APITestCase):
    """El catálogo y el conjunto, que es de donde cuelga todo lo demás."""

    def test_son_nueve_estados_y_sus_valores_son_estables(self):
        # Los valores persisten en BD: cambiarlos es una migración de datos, no
        # un renombrado. Por eso se fijan aquí uno a uno.
        self.assertEqual(
            [v for v, _ in VehicleState.choices],
            [
                "active",
                "maintenance",
                "itv",
                "broken",
                "accidente",
                "non_active",
                "pending_return",
                "returned",
                "retired",
            ],
        )

    def test_fuera_de_la_flota_son_las_dos_salidas_y_solo_ellas(self):
        self.assertEqual(tuple(OUT_OF_FLEET), (VehicleState.RETURNED, VehicleState.BAJA))
        # La antesala NO está: el coche todavía es nuestro.
        self.assertNotIn(VehicleState.PENDING_RETURN, OUT_OF_FLEET)

    def test_el_manager_excluye_las_dos_salidas_y_conserva_la_antesala(self):
        dentro = Vehicle.objects.create(plate="EST0001", brand="Seat", model="Ibiza")
        espera = Vehicle.objects.create(
            plate="EST0002", brand="Seat", model="León", state=VehicleState.PENDING_RETURN
        )
        devuelto = Vehicle.objects.create(
            plate="EST0003", brand="Seat", model="Ateca", state=VehicleState.RETURNED
        )
        baja = Vehicle.objects.create(
            plate="EST0004", brand="Seat", model="Arona", state=VehicleState.BAJA
        )

        activos = set(Vehicle.objects.active().values_list("pk", flat=True))
        self.assertEqual(activos, {dentro.pk, espera.pk})
        self.assertNotIn(devuelto.pk, activos)
        self.assertNotIn(baja.pk, activos)


class OutOfFleetListingTests(APITestCase):
    """El listado esconde las dos salidas, no solo la baja."""

    def setUp(self):
        self.admin = make_user("est-admin", Role.ADMIN)
        self.client.force_authenticate(self.admin)
        self.url = reverse("vehicle-list")
        self.dentro = Vehicle.objects.create(plate="LST0001", brand="Kia", model="Ceed")
        self.espera = Vehicle.objects.create(
            plate="LST0002", brand="Kia", model="Niro", state=VehicleState.PENDING_RETURN
        )
        self.devuelto = Vehicle.objects.create(
            plate="LST0003", brand="Kia", model="Rio", state=VehicleState.RETURNED
        )
        self.baja = Vehicle.objects.create(
            plate="LST0004", brand="Kia", model="Stonic", state=VehicleState.BAJA
        )

    def _matriculas(self, **params):
        resp = self.client.get(self.url, params)
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        filas = resp.data["results"] if isinstance(resp.data, dict) else resp.data
        return {f["plate"] for f in filas}

    def test_por_defecto_salen_los_de_la_flota_incluida_la_antesala(self):
        self.assertEqual(self._matriculas(), {"LST0001", "LST0002"})

    def test_include_baja_trae_las_dos_salidas(self):
        self.assertEqual(
            self._matriculas(include_baja="1"),
            {"LST0001", "LST0002", "LST0003", "LST0004"},
        )

    def test_se_puede_pedir_cada_salida_por_su_nombre(self):
        # Antes solo valía `?state=retired`; con dos puertas, cada una tiene
        # que poder pedirse sola o el filtro deja una mitad inalcanzable.
        self.assertEqual(self._matriculas(state="returned"), {"LST0003"})
        self.assertEqual(self._matriculas(state="retired"), {"LST0004"})


class ReturnAndRetireWriteDifferentStatesTests(APITestCase):
    """Cada puerta escribe lo suyo: `/return/` devuelve y `DELETE` da de baja."""

    def setUp(self):
        self.admin = make_user("est-adm2", Role.ADMIN)
        self.client.force_authenticate(self.admin)

    def test_la_devolucion_guiada_deja_el_coche_devuelto(self):
        vehiculo = Vehicle.objects.create(plate="RET0001", brand="Opel", model="Corsa")
        resp = self.client.post(reverse("vehicle-return-vehicle", args=[vehiculo.pk]), {})
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        vehiculo.refresh_from_db()
        self.assertEqual(vehiculo.state, VehicleState.RETURNED)

    def test_el_delete_deja_el_coche_de_baja(self):
        vehiculo = Vehicle.objects.create(plate="RET0002", brand="Opel", model="Astra")
        resp = self.client.delete(reverse("vehicle-detail", args=[vehiculo.pk]))
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)
        vehiculo.refresh_from_db()
        self.assertEqual(vehiculo.state, VehicleState.BAJA)

    def test_dar_de_baja_un_coche_devuelto_no_lo_convierte_en_baja(self):
        """La idempotencia mira el conjunto, no un valor.

        Con la guarda mirando solo `retired`, un `DELETE` sobre un coche ya
        devuelto le reescribía el estado y borraba del histórico que aquello
        fue una devolución.
        """
        vehiculo = Vehicle.objects.create(
            plate="RET0003", brand="Opel", model="Mokka", state=VehicleState.RETURNED
        )
        self.client.delete(reverse("vehicle-detail", args=[vehiculo.pk]))
        vehiculo.refresh_from_db()
        self.assertEqual(vehiculo.state, VehicleState.RETURNED)


class PendingReturnStaysInTheFleetTests(APITestCase):
    """Lo que de verdad distingue a la antesala: aquí todavía se opera."""

    def setUp(self):
        self.admin = make_user("est-adm3", Role.ADMIN)
        self.client.force_authenticate(self.admin)
        self.vehiculo = Vehicle.objects.create(
            plate="PND0001",
            brand="Dacia",
            model="Duster",
            state=VehicleState.PENDING_RETURN,
        )

    def test_se_le_puede_asignar_conductor(self):
        # Alguien tiene que seguir llevándolo hasta el día de la entrega.
        chofer = make_user("pnd-drv", Role.DRIVER)
        resp = self.client.post(
            reverse("vehicle-set-driver", args=[self.vehiculo.pk]),
            {"driver": chofer.pk},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)

    def test_se_le_puede_citar_la_itv(self):
        # Sigue siendo nuestro, así que sigue venciendo.
        resp = self.client.post(
            reverse("vehicle-schedule-itv", args=[self.vehiculo.pk]),
            {"date": "2030-01-01"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)

    def test_un_coche_devuelto_ya_no_admite_ninguna_de_las_dos(self):
        fuera = Vehicle.objects.create(
            plate="PND0002", brand="Dacia", model="Sandero", state=VehicleState.RETURNED
        )
        chofer = make_user("pnd-drv2", Role.DRIVER)
        resp = self.client.post(
            reverse("vehicle-set-driver", args=[fuera.pk]),
            {"driver": chofer.pk},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        resp = self.client.post(
            reverse("vehicle-schedule-itv", args=[fuera.pk]),
            {"date": "2030-01-01"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
