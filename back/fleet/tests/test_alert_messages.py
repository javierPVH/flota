"""El mensaje de una alerta, dicho a la vez como frase y como dato.

Dos cosas que vigilar. La primera, que **la frase castellana no se mueva**: la
leen el correo y el Excel de informes, y es la reserva de las dos apps para una
alerta antigua o un código que todavía no sepan escribir. La segunda, que el
par `message_code` + `message_args` **viaje de verdad** en las alertas que
crean los chequeos; sin él, los fronts vuelven a pintar castellano en inglés
sin que nada falle a gritos.
"""

from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from fleet.models import Alert, Contract, KmReading, Vehicle
from fleet.models.enums import AlertType, VehicleState
from fleet.services import alerts
from fleet.services.alert_messages import PLANTILLAS, compose


class ComposeTests(TestCase):
    """La frase de cada código, palabra por palabra."""

    def test_vencimientos(self):
        self.assertEqual(
            compose("itv_overdue", days=12, due="2026-03-01")["message"],
            "ITV vencida hace 12 día(s) (venció el 2026-03-01).",
        )
        self.assertEqual(
            compose("itv_due", days=7, due="2026-03-01")["message"],
            "ITV en 7 día(s) (vence el 2026-03-01).",
        )
        self.assertEqual(
            compose("insurance_overdue", days=3, due="2026-03-01")["message"],
            "Seguro vencido hace 3 día(s) (venció el 2026-03-01).",
        )
        self.assertEqual(
            compose("insurance_due", days=15, due="2026-03-01")["message"],
            "Seguro en 15 día(s) (vence el 2026-03-01).",
        )

    def test_km_y_conductor(self):
        self.assertEqual(
            compose("km_pending", period="2026-09")["message"],
            "Falta la lectura de km de 2026-09.",
        )
        self.assertEqual(
            compose("no_driver", days=7)["message"],
            "Sin conductor asignado desde hace más de 7 día(s).",
        )
        self.assertEqual(
            compose("km_overage", projected=35000, contracted=30000, pct=117)["message"],
            "Proyección 35000 km supera los 30000 km contratados (117%).",
        )

    def test_mantenimiento_por_los_dos_caminos(self):
        """Un plan que toca por km Y por fecha es UN aviso: los km delante."""
        msg = compose(
            "maintenance",
            plan="Revisión anual",
            km={"kind": "over", "target": 10000, "current": 10500},
            date={"kind": "soon", "days": 7, "due": "2026-03-01"},
        )
        self.assertEqual(
            msg["message"],
            "Revisión anual: superado el objetivo de 10000 km (odómetro: 10500 km) "
            "y, por fecha, toca en 7 día(s) (el 2026-03-01).",
        )
        # Los dos tramos viajan sueltos: es lo que deja al front componer la
        # frase en SU orden, que en inglés no tiene por qué ser este.
        self.assertEqual(msg["message_args"]["km"]["kind"], "over")
        self.assertEqual(msg["message_args"]["date"]["kind"], "soon")

    def test_mantenimiento_por_un_solo_camino(self):
        self.assertEqual(
            compose(
                "maintenance",
                plan="Revisión anual",
                km={"kind": "near", "target": 10000, "remaining": 500},
            )["message"],
            "Revisión anual: quedan 500 km para el objetivo de 10000 km.",
        )
        self.assertEqual(
            compose(
                "maintenance",
                plan="Revisión anual",
                date={"kind": "overdue", "days": 4, "due": "2026-03-01"},
            )["message"],
            "Revisión anual: vencido hace 4 día(s) (tocaba el 2026-03-01).",
        )

    def test_recordatorio_manual(self):
        """Lo que escribió quien supervisa va tal cual: no se traduce."""
        self.assertEqual(
            compose("reminder", kind="itv_due", due="2026-03-01", note="Llamar al taller")[
                "message"
            ],
            "Recordatorio: ITV del vehículo. Vencimiento: 2026-03-01. Llamar al taller",
        )
        self.assertEqual(
            compose("reminder", kind="km_reading_pending")["message"],
            "Recordatorio: lectura de km pendiente este mes.",
        )

    def test_codigo_desconocido_falla_a_gritos(self):
        """Es código nuestro, no entrada de usuario: mejor romper que avisar mal."""
        with self.assertRaises(KeyError):
            compose("esto_no_existe")

    def test_un_dato_vacio_no_se_guarda(self):
        """`None` fuera de los args: el front pinta hueco, no «None»."""
        msg = compose("reminder", kind="itv_due", due=None, note="")
        self.assertNotIn("due", msg["message_args"])


class AlertasLlevanSuCodigoTests(TestCase):
    """Lo que crean los chequeos trae el par, no solo la frase."""

    def setUp(self):
        self.today = timezone.localdate()

    def _vehiculo(self, **extra):
        return Vehicle.objects.create(
            plate=extra.pop("plate", "1111AAA"), state=VehicleState.ACTIVE, **extra
        )

    def test_itv(self):
        self._vehiculo(next_itv_date=self.today + timedelta(days=5))
        alerts.check_itv(self.today)
        alert = Alert.objects.get(type=AlertType.ITV_DUE)
        self.assertEqual(alert.message_code, "itv_due")
        self.assertEqual(alert.message_args["days"], 5)
        self.assertEqual(alert.message_args["due"], (self.today + timedelta(days=5)).isoformat())

    def test_seguro(self):
        self._vehiculo(insurance_expiry_date=self.today - timedelta(days=2))
        alerts.check_insurance(self.today)
        alert = Alert.objects.get(type=AlertType.INSURANCE_DUE)
        self.assertEqual(alert.message_code, "insurance_overdue")
        self.assertEqual(alert.message_args["days"], 2)

    def test_lectura_de_km_pendiente(self):
        self._vehiculo()
        alerts.check_km_readings(self.today)
        alert = Alert.objects.get(type=AlertType.KM_READING_PENDING)
        self.assertEqual(alert.message_code, "km_pending")
        self.assertEqual(alert.message_args["period"], f"{self.today:%Y-%m}")

    def test_sin_conductor(self):
        self._vehiculo()
        alerts.check_no_driver(self.today)
        alert = Alert.objects.get(type=AlertType.NO_DRIVER)
        self.assertEqual(alert.message_code, "no_driver")
        self.assertIn("days", alert.message_args)

    def test_exceso_de_km_y_el_correo_lee_los_datos(self):
        """El correo sacaba los km de la FRASE con una expresión regular."""
        from fleet.services import mailer

        vehicle = self._vehiculo(km_start=0)
        Contract.objects.create(
            vehicle=vehicle,
            start_date=self.today - timedelta(days=180),
            planned_end_date=self.today + timedelta(days=180),
            contract_km=20000,
        )
        KmReading.objects.create(vehicle=vehicle, reading_date=self.today, km_reading=20000)
        alerts.check_km_overage(self.today)
        alert = Alert.objects.get(type=AlertType.KM_OVERAGE)
        self.assertEqual(alert.message_code, "km_overage")
        self.assertEqual(alert.message_args["contracted"], 20000)
        self.assertEqual(
            mailer._context_for(alert)["km_exceso"],
            str(alert.message_args["projected"]),
        )

    def test_refrescar_una_abierta_mueve_tambien_sus_datos(self):
        """Si la frase cambiara sin sus datos, el front pintaría lo anterior."""
        vehicle = self._vehiculo(next_itv_date=self.today + timedelta(days=5))
        alerts.check_itv(self.today)
        alert = Alert.objects.get(type=AlertType.ITV_DUE)
        # Un día después el mismo umbral sigue vigente: se refresca, no se abre otra.
        alerts.check_itv(self.today + timedelta(days=1))
        self.assertEqual(Alert.objects.filter(vehicle=vehicle).count(), 1)
        alert.refresh_from_db()
        self.assertEqual(alert.message_args["days"], 4)
        self.assertIn("4 día(s)", alert.message)


class CatalogoTests(TestCase):
    """El catálogo es cerrado y los dos fronts lo copian: que no crezca sin querer."""

    def test_los_codigos_son_los_esperados(self):
        self.assertEqual(
            set(PLANTILLAS),
            {
                "itv_overdue",
                "itv_due",
                "insurance_overdue",
                "insurance_due",
                "km_pending",
                "no_driver",
                "km_overage",
                "maintenance",
                "reminder",
            },
        )
