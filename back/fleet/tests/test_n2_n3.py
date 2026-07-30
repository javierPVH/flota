"""N2 (vencimiento del seguro) y N3 (km ilimitados) — PLAN_EVOLUCION.md, paso 4."""

from datetime import date, timedelta

from django.test import TestCase

from fleet.models import Alert, Contract, Document, KmReading, Vehicle
from fleet.models.enums import AlertStatus, AlertType, DocumentType
from fleet.services import alerts, metrics

TODAY = date(2026, 7, 15)


def _vehicle(plate="1234ABC", **kwargs) -> Vehicle:
    return Vehicle.objects.create(plate=plate, brand="a", model="b", **kwargs)


class CheckInsuranceTests(TestCase):
    """Motor de alertas de seguro: buckets 30/15/7, vencido = crítica, dedup."""

    def test_alerts_by_bucket_and_overdue(self):
        _vehicle("0001AAA", insurance_expiry_date=TODAY + timedelta(days=25))  # bucket 30
        _vehicle("0002BBB", insurance_expiry_date=TODAY + timedelta(days=3))  # bucket 7
        _vehicle("0003CCC", insurance_expiry_date=TODAY - timedelta(days=2))  # vencido
        _vehicle("0004DDD", insurance_expiry_date=TODAY + timedelta(days=90))  # lejos
        _vehicle("0005EEE")  # sin seguro registrado

        created = alerts.check_insurance(today=TODAY)

        self.assertEqual(created, 3)
        by_key = {a.dedup_key: a for a in Alert.objects.all()}
        self.assertTrue(any(k.endswith(":30") for k in by_key))
        self.assertTrue(any(k.endswith(":overdue") for k in by_key))
        overdue = next(a for k, a in by_key.items() if k.endswith(":overdue"))
        self.assertEqual(overdue.level, "critical")
        self.assertEqual(overdue.type, AlertType.INSURANCE_DUE)
        # Idempotente: re-ejecutar no duplica.
        self.assertEqual(alerts.check_insurance(today=TODAY), 0)

    def test_run_all_includes_insurance(self):
        summary = alerts.run_all(today=TODAY)
        self.assertIn("insurance", summary)


class InsuranceDocumentSignalTests(TestCase):
    """La póliza con caducidad más reciente sincroniza el campo y cierra avisos."""

    def test_newer_policy_updates_vehicle_and_closes_alerts(self):
        vehicle = _vehicle(insurance_expiry_date=TODAY + timedelta(days=5))
        alerts.check_insurance(today=TODAY)
        self.assertEqual(
            Alert.objects.filter(status=AlertStatus.OPEN, type=AlertType.INSURANCE_DUE).count(), 1
        )

        renewed = TODAY + timedelta(days=370)
        Document.objects.create(vehicle=vehicle, type=DocumentType.INSURANCE, expiry_date=renewed)
        vehicle.refresh_from_db()
        self.assertEqual(vehicle.insurance_expiry_date, renewed)
        self.assertEqual(
            Alert.objects.filter(status=AlertStatus.OPEN, type=AlertType.INSURANCE_DUE).count(), 0
        )

    def test_older_policy_does_not_downgrade(self):
        vehicle = _vehicle(insurance_expiry_date=TODAY + timedelta(days=200))
        Document.objects.create(
            vehicle=vehicle, type=DocumentType.INSURANCE, expiry_date=TODAY + timedelta(days=10)
        )
        vehicle.refresh_from_db()
        self.assertEqual(vehicle.insurance_expiry_date, TODAY + timedelta(days=200))

    def test_non_insurance_document_is_ignored(self):
        vehicle = _vehicle()
        Document.objects.create(
            vehicle=vehicle,
            type=DocumentType.TECHNICAL_SHEET,
            expiry_date=TODAY + timedelta(days=30),
        )
        vehicle.refresh_from_db()
        self.assertIsNone(vehicle.insurance_expiry_date)


class UnlimitedKmTests(TestCase):
    """N3: sin proyección, sin alerta de exceso, flag visible en el summary."""

    def _with_contract(self, *, unlimited: bool) -> Vehicle:
        vehicle = _vehicle("9999ZZZ", unlimited_km=unlimited, km_start=0)
        Contract.objects.create(
            vehicle=vehicle,
            contract_km=10_000,
            contract_time=12,
            start_date=TODAY - timedelta(days=180),
            planned_end_date=TODAY + timedelta(days=185),
        )
        # Ritmo desbocado: proyectaría muy por encima del contrato.
        KmReading.objects.create(
            vehicle=vehicle, reading_date=TODAY - timedelta(days=10), km_reading=40_000
        )
        return vehicle

    def test_summary_has_no_projection_but_flags_unlimited(self):
        vehicle = self._with_contract(unlimited=True)
        summary = metrics.vehicle_summary(vehicle, today=TODAY)
        self.assertTrue(summary["unlimited_km"])
        self.assertIsNone(summary["projection"])
        self.assertIsNotNone(summary["contract"])  # el contrato sigue visible

    def test_no_overage_alert_for_unlimited(self):
        self._with_contract(unlimited=True)
        self.assertEqual(alerts.check_km_overage(today=TODAY), 0)

    def test_limited_vehicle_still_projects_and_alerts(self):
        vehicle = self._with_contract(unlimited=False)
        summary = metrics.vehicle_summary(vehicle, today=TODAY)
        self.assertFalse(summary["unlimited_km"])
        self.assertIsNotNone(summary["projection"])
        self.assertEqual(alerts.check_km_overage(today=TODAY), 1)
