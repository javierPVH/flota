"""El barrido que acompaña a la retirada del DNI (`fleet/0077`).

Quitar la columna no bastaba: el DNI se había copiado a otros tres sitios y ahí
se habría quedado. Lo que se prueba aquí es el EFECTO del barrido sobre filas
creadas en el test, no la migración en sí —una migración ya aplicada no se
vuelve a ejecutar, así que probarla como tal no diría nada—.

Se importan las funciones del módulo de la migración y se les pasa el registro
de apps REAL (`django.apps.apps`): el barrido solo usa `get_model`, así que el
registro histórico de una migración y el de verdad le valen igual.
"""

from importlib import import_module

from django.apps import apps as registro_real
from django.contrib.contenttypes.models import ContentType
from django.test import TestCase

from accounts.models import Role, User

from .helpers import make_user

# El módulo de la migración empieza por un número, así que no se puede importar
# con la sintaxis normal.
_mig = import_module("fleet.migrations.0077_limpiar_copias_del_dni")


class LimpiezaDeLasPeticionesTests(TestCase):
    """El DNI que la app de campo copiaba al JSON de la petición."""

    def test_se_quita_el_dni_y_la_fila_sobrevive(self):
        from fleet.models import ProfileChangeRequest

        # Hay UNA petición viva por persona, así que cada caso lleva la suya.
        una = make_user("pet-dni", Role.DRIVER)
        otra = make_user("pet-dni2", Role.DRIVER)
        fila = ProfileChangeRequest.objects.create(
            user=una,
            requested_by=una,
            changes={"dni": "12345678Z", "phone": "600 111 222"},
        )
        solo_dni = ProfileChangeRequest.objects.create(
            user=otra,
            requested_by=otra,
            changes={"dni": "12345678Z"},
        )

        _mig._limpiar_peticiones(registro_real, None)

        fila.refresh_from_db()
        self.assertEqual(fila.changes, {"phone": "600 111 222"})
        # La que se queda sin campos NO se borra: sigue contando que esa
        # persona pidió algo y quién lo decidió.
        solo_dni.refresh_from_db()
        self.assertEqual(solo_dni.changes, {})

    def test_lo_que_no_tiene_dni_no_se_toca(self):
        from fleet.models import ProfileChangeRequest

        persona = make_user("pet-sin", Role.DRIVER)
        fila = ProfileChangeRequest.objects.create(
            user=persona, requested_by=persona, changes={"phone": "600 000 000"}
        )
        _mig._limpiar_peticiones(registro_real, None)
        fila.refresh_from_db()
        self.assertEqual(fila.changes, {"phone": "600 000 000"})


class LimpiezaDeLaAuditoriaTests(TestCase):
    """El medio DNI que `auditlog` dejaba en claro al enmascarar."""

    def _entrada(self, usuario, cambios):
        from auditlog.models import LogEntry

        return LogEntry.objects.create(
            content_type=ContentType.objects.get_for_model(User),
            object_pk=str(usuario.pk),
            object_repr=str(usuario),
            action=LogEntry.Action.UPDATE,
            changes=cambios,
        )

    def test_se_quita_la_clave_y_se_borran_las_entradas_que_se_quedan_vacias(self):
        from auditlog.models import LogEntry

        persona = make_user("aud-dni", Role.DRIVER)
        mixta = self._entrada(persona, {"dni": ["****5678Z", "****1234X"], "phone": ["", "600"]})
        vacia = self._entrada(persona, {"dni": ["****5678Z", "****1234X"]})

        _mig._limpiar_auditoria(registro_real, None)

        mixta.refresh_from_db()
        self.assertEqual(mixta.changes, {"phone": ["", "600"]})
        # Sin ningún campo no quedaba nada que contar, y una entrada vacía no
        # se pinta en ninguna pantalla.
        self.assertFalse(LogEntry.objects.filter(pk=vacia.pk).exists())

    def test_no_toca_la_auditoria_de_otros_modelos(self):
        from auditlog.models import LogEntry

        from fleet.models import Vehicle

        coche = Vehicle.objects.create(plate="DNI0001", brand="Seat", model="Ibiza")
        ajena = LogEntry.objects.create(
            content_type=ContentType.objects.get_for_model(Vehicle),
            object_pk=str(coche.pk),
            object_repr=str(coche),
            action=LogEntry.Action.UPDATE,
            changes={"dni": ["a", "b"]},
        )
        _mig._limpiar_auditoria(registro_real, None)
        ajena.refresh_from_db()
        self.assertEqual(ajena.changes, {"dni": ["a", "b"]})


class LimpiezaDelRastroDeExportacionesTests(TestCase):
    """La columna «dni» pedida y el DNI tecleado en el buscador."""

    def _export(self, **extra):
        from fleet.models import ReportExport

        return ReportExport.objects.create(
            user=make_user(f"exp{ReportExport.objects.count()}", Role.ADMIN),
            source="screen",
            kind="users",
            fmt="csv",
            **extra,
        )

    def test_se_cae_la_columna_y_se_vacia_la_busqueda_que_parece_un_dni(self):
        dni = self._export(columns=["username", "dni", "phone"], filters={"search": "12345678Z"})
        nie = self._export(columns=[], filters={"search": "X1234567L"})

        _mig._limpiar_exportaciones(registro_real, None)

        dni.refresh_from_db()
        self.assertEqual(dni.columns, ["username", "phone"])
        self.assertEqual(dni.filters["search"], "")
        nie.refresh_from_db()
        self.assertEqual(nie.filters["search"], "")

    def test_una_busqueda_que_no_parece_un_dni_se_conserva(self):
        """El filtro es texto libre: borrarlo entero destruiría rastro legítimo."""
        fila = self._export(columns=["username"], filters={"search": "Carlos"})
        _mig._limpiar_exportaciones(registro_real, None)
        fila.refresh_from_db()
        self.assertEqual(fila.filters["search"], "Carlos")
