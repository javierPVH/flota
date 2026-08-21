"""Unicidad de los catálogos maestros: sin distinguir mayúsculas, contando los
desactivados y en los ocho catálogos (antes cinco no tenían restricción).

Los tres defectos que cubren estos tests se detectaron creando entradas por la
API igual que lo hace la pantalla de Catálogos:

1. un registro DESACTIVADO (N7) bloqueaba volver a crear el mismo nombre, con
   un «ya existe» incomprensible porque los listados no lo muestran;
2. «Seat», «SEAT» y «seat» convivían como tres marcas distintas;
3. país, unidad de negocio, proyecto, CECO y renting admitían duplicados exactos.
"""

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.exceptions import INACTIVE_CONFLICT_CODE
from fleet.models import Brand, BusinessUnit, Company, Country, Pep, Project, Renting, VehicleModel

from .helpers import make_user


class CatalogCreateSmokeTests(APITestCase):
    """Las ocho altas funcionan con el payload que manda el front (todo texto)."""

    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.client.force_authenticate(self.admin)

    def test_every_catalog_can_be_created(self):
        pep = Pep.objects.create(code="C1", name="Ceco uno")
        brand = Brand.objects.create(name="MarcaBase")
        casos = [
            ("country-list", {"name": "Portugal"}),
            ("businessunit-list", {"code": "BU1", "name": "Unidad"}),
            ("project-list", {"project_name": "Obra X", "cost_center": str(pep.pk)}),
            ("pep-list", {"code": "C2", "name": "Ceco dos"}),
            ("renting-list", {"name": "Renting SA", "email": "a@b.dev", "contact_name": "Ana"}),
            ("brand-list", {"name": "MarcaNueva"}),
            ("vehiclemodel-list", {"brand": str(brand.pk), "name": "ModeloNuevo"}),
            ("company-list", {"code": "S1", "name": "Sociedad", "description": "d"}),
        ]
        for nombre, payload in casos:
            with self.subTest(catalogo=nombre):
                resp = self.client.post(reverse(nombre), payload)
                self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)


class CatalogCaseInsensitiveTests(APITestCase):
    """Defecto 2: los duplicados por mayúsculas ensuciaban los selects."""

    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.client.force_authenticate(self.admin)

    def test_brand_rejects_same_name_in_other_case(self):
        Brand.objects.create(name="Seat")
        for intento in ("SEAT", "seat", "SeAt"):
            with self.subTest(nombre=intento):
                resp = self.client.post(reverse("brand-list"), {"name": intento})
                self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
                self.assertIn("name", resp.data["errors"])
        self.assertEqual(Brand.objects.count(), 1)

    def test_company_code_is_case_insensitive(self):
        Company.objects.create(code="GS-ES", name="Gransolar España")
        resp = self.client.post(reverse("company-list"), {"code": "gs-es", "name": "Otra"})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("code", resp.data["errors"])

    def test_model_is_unique_per_brand_ignoring_case(self):
        brand = Brand.objects.create(name="Toyota")
        otra = Brand.objects.create(name="Ford")
        VehicleModel.objects.create(brand=brand, name="Yaris")

        resp = self.client.post(
            reverse("vehiclemodel-list"), {"brand": str(brand.pk), "name": "YARIS"}
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

        # El mismo nombre en OTRA marca sí es válido: la clave es (marca, nombre).
        resp = self.client.post(
            reverse("vehiclemodel-list"), {"brand": str(otra.pk), "name": "Yaris"}
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)


class CatalogsWithoutConstraintTests(APITestCase):
    """Defecto 3: los cinco catálogos que aceptaban duplicados exactos."""

    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.client.force_authenticate(self.admin)

    def test_duplicates_are_rejected(self):
        pep = Pep.objects.create(code="C1", name="Ceco uno")
        casos = [
            ("country-list", {"name": "España"}, lambda: Country.objects.create(name="España")),
            (
                "businessunit-list",
                {"name": "Unidad"},
                lambda: BusinessUnit.objects.create(name="Unidad"),
            ),
            (
                "renting-list",
                {"name": "Renting SA"},
                lambda: Renting.objects.create(name="Renting SA"),
            ),
            (
                "project-list",
                {"project_name": "Obra X", "cost_center": str(pep.pk)},
                lambda: Project.objects.create(project_name="Obra X", cost_center=pep),
            ),
            ("pep-list", {"name": "Ceco dos"}, lambda: Pep.objects.create(name="Ceco dos")),
        ]
        for nombre, payload, sembrar in casos:
            with self.subTest(catalogo=nombre):
                sembrar()
                resp = self.client.post(reverse(nombre), payload)
                self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST, resp.data)


class InactiveCatalogConflictTests(APITestCase):
    """Defecto 1: el registro desactivado que bloqueaba el alta (el importante).

    Ahora responde 409 con el tipo y el id, para que la pantalla ofrezca
    restaurarlo en lugar de repetir un alta que nunca iba a funcionar.
    """

    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.client.force_authenticate(self.admin)

    def _deactivate(self, ruta: str, pk: int):
        resp = self.client.delete(f"{reverse(ruta)}{pk}/?reason=prueba")
        self.assertIn(resp.status_code, (status.HTTP_200_OK, status.HTTP_204_NO_CONTENT))

    def test_brand_conflict_offers_restore(self):
        brand = Brand.objects.create(name="Seat")
        self._deactivate("brand-list", brand.pk)

        resp = self.client.post(reverse("brand-list"), {"name": "Seat"})
        self.assertEqual(resp.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(resp.data["code"], INACTIVE_CONFLICT_CODE)
        # Lo que el front necesita para llamar a /erratas/restore/.
        self.assertEqual(resp.data["context"]["kind"], "brands")
        self.assertEqual(resp.data["context"]["id"], brand.pk)
        self.assertIn("desactivado", resp.data["detail"])

    def test_conflict_is_case_insensitive_too(self):
        brand = Brand.objects.create(name="Seat")
        self._deactivate("brand-list", brand.pk)
        resp = self.client.post(reverse("brand-list"), {"name": "SEAT"})
        self.assertEqual(resp.status_code, status.HTTP_409_CONFLICT)

    def test_company_and_model_conflicts(self):
        company = Company.objects.create(code="S9", name="Vieja")
        self._deactivate("company-list", company.pk)
        resp = self.client.post(reverse("company-list"), {"code": "S9", "name": "Nueva"})
        self.assertEqual(resp.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(resp.data["context"]["kind"], "companies")

        brand = Brand.objects.create(name="Toyota")
        vm = VehicleModel.objects.create(brand=brand, name="Yaris")
        self._deactivate("vehiclemodel-list", vm.pk)
        resp = self.client.post(
            reverse("vehiclemodel-list"), {"brand": str(brand.pk), "name": "Yaris"}
        )
        self.assertEqual(resp.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(resp.data["context"]["kind"], "vehicle-models")

    def test_restore_then_the_catalog_has_the_entry_again(self):
        """El camino completo que ofrece la pantalla: conflicto → restaurar."""
        brand = Brand.objects.create(name="Seat")
        self._deactivate("brand-list", brand.pk)
        conflicto = self.client.post(reverse("brand-list"), {"name": "Seat"})

        resp = self.client.post(
            reverse("erratas-restore"),
            {"type": conflicto.data["context"]["kind"], "id": conflicto.data["context"]["id"]},
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        brand.refresh_from_db()
        self.assertTrue(brand.is_active)

        # Y el listado vuelve a mostrarla, que es lo que se quería conseguir.
        listado = self.client.get(reverse("brand-list"))
        self.assertEqual([b["name"] for b in listado.data["results"]], ["Seat"])

    def test_editing_a_record_does_not_conflict_with_itself(self):
        """Guardar sin cambiar el nombre no puede chocar consigo mismo."""
        brand = Brand.objects.create(name="Seat")
        resp = self.client.patch(f"{reverse('brand-list')}{brand.pk}/", {"name": "Seat"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)

    def test_partial_update_of_another_field_keeps_working(self):
        """PATCH parcial: la clave se toma de la instancia, no del payload."""
        renting = Renting.objects.create(name="Renting SA")
        resp = self.client.patch(f"{reverse('renting-list')}{renting.pk}/", {"contact_name": "Ana"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)


class CatalogsBundleTests(APITestCase):
    """El agregado que evita las siete peticiones del alta de vehículo."""

    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.supervisor = make_user("sup", Role.SUPERVISOR)
        self.pep = Pep.objects.create(code="C1", name="Ceco uno")
        Project.objects.create(project_name="Obra X", cost_center=self.pep)
        Country.objects.create(name="España")
        BusinessUnit.objects.create(name="Unidad")
        Renting.objects.create(name="Renting SA")
        Brand.objects.create(name="Toyota")
        Company.objects.create(code="S1", name="Sociedad")

    def test_bundle_brings_every_catalog_in_one_response(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get(reverse("catalogs-bundle"))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(
            sorted(resp.data),
            ["brands", "business-units", "companies", "countries", "peps", "projects", "rentings"],
        )
        for clave in resp.data:
            self.assertEqual(len(resp.data[clave]), 1, clave)

    def test_bundle_keeps_the_fields_the_selects_use(self):
        """Mismos objetos que los endpoints sueltos: el alta usa `cost_center`."""
        self.client.force_authenticate(self.admin)
        resp = self.client.get(reverse("catalogs-bundle"))
        proyecto = resp.data["projects"][0]
        self.assertEqual(proyecto["cost_center"], self.pep.pk)
        self.assertIn("cost_center_display", proyecto)

    def test_bundle_hides_deactivated_entries(self):
        brand = Brand.objects.create(name="Seat")
        self.client.force_authenticate(self.admin)
        self.client.delete(f"{reverse('brand-list')}{brand.pk}/?reason=prueba")
        resp = self.client.get(reverse("catalogs-bundle"))
        self.assertEqual([b["name"] for b in resp.data["brands"]], ["Toyota"])

    def test_supervisor_can_read_but_anonymous_cannot(self):
        self.client.force_authenticate(self.supervisor)
        self.assertEqual(
            self.client.get(reverse("catalogs-bundle")).status_code, status.HTTP_200_OK
        )
        self.client.force_authenticate(None)
        self.assertIn(
            self.client.get(reverse("catalogs-bundle")).status_code,
            (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN),
        )

    def test_bundle_costs_one_query_per_catalog(self):
        """Sin N+1: una consulta por catálogo, y el proyecto trae su CECO.

        Son 8: los siete catálogos más la de los roles del usuario que hace el
        permiso. Añadir proyectos con CECOs distintos no sube la cuenta porque
        `ProjectSerializer` los resuelve con `select_related`; sin él, cada
        `cost_center_display` sería una consulta más.
        """
        self.client.force_authenticate(self.admin)
        for i in range(4):
            Project.objects.create(
                project_name=f"Obra {i}", cost_center=Pep.objects.create(name=f"Ceco {i}")
            )
        with self.assertNumQueries(8):
            self.client.get(reverse("catalogs-bundle"))
