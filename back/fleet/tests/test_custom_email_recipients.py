from django.test import TestCase, override_settings

from fleet.models import Alert, EmailOutbox, EmailSettings, Incident, Vehicle
from fleet.serializers import EmailSettingsSerializer
from fleet.services import mailer
from fleet.services.corporate_email import delivery_recipients


@override_settings(FLEET_EMAIL_ALLOWED_DOMAINS=["gransolar.com"], FLEET_EMAIL_ENABLED=True)
class CustomEmailRecipientsTests(TestCase):
    prefixes = (
        "km_remind",
        "fuel_remind",
        "itv_remind",
        "maintenance_remind",
        "incident_notice",
        "accident_notice",
    )

    def setUp(self):
        self.cfg = EmailSettings.get_solo()

    def test_all_sections_accept_custom_only_and_normalize(self):
        for prefix in self.prefixes:
            with self.subTest(prefix=prefix):
                serializer = EmailSettingsSerializer(
                    self.cfg,
                    data={
                        prefix
                        + "_extra_recipients": "TEAM@GRANSOLAR.COM; team@gransolar.com\nother@gransolar.com",
                        prefix + "_to_driver": False,
                        prefix + "_to_supervisor": False,
                    },
                    partial=True,
                )
                self.assertTrue(serializer.is_valid(), serializer.errors)
                self.cfg = serializer.save()
                self.assertEqual(
                    getattr(self.cfg, prefix + "_extra_recipients"),
                    "team@gransolar.com, other@gransolar.com",
                )

    def test_all_sections_reject_external_malformed_and_lookalike_domains(self):
        for prefix in self.prefixes:
            for email in (
                "a@gmail.com",
                "invalid",
                "a@gransolar.com.evil.com",
                "a@sub.gransolar.com",
                "a@gransolar.com, b@external.com",
            ):
                with self.subTest(prefix=prefix, email=email):
                    serializer = EmailSettingsSerializer(
                        self.cfg, data={prefix + "_extra_recipients": email}, partial=True
                    )
                    self.assertFalse(serializer.is_valid())
                    self.assertIn(prefix + "_extra_recipients", serializer.errors)

    @override_settings(FLEET_EMAIL_ALLOWED_DOMAINS=[])
    def test_no_domains_rejects_all_custom_addresses(self):
        serializer = EmailSettingsSerializer(
            self.cfg, data={"km_remind_extra_recipients": "a@gransolar.com"}, partial=True
        )
        self.assertFalse(serializer.is_valid())
        self.assertEqual(delivery_recipients("a@gransolar.com"), [])

    def test_custom_recipients_reach_all_reminders_and_incident_outbox(self):
        vehicle = Vehicle.objects.create(plate="CUSTOM-1")
        for kind, _alert_type in (
            ("km", "km_reading_pending"),
            ("fuel", "fuel_reading_pending"),
            ("itv", "itv_due"),
            ("maintenance", "maintenance_due"),
        ):
            setattr(self.cfg, kind + "_remind_extra_recipients", "team@gransolar.com")
        self.cfg.incident_notice_enabled = True
        self.cfg.accident_notice_enabled = True
        self.cfg.incident_notice_extra_recipients = "team@gransolar.com"
        self.cfg.accident_notice_extra_recipients = "team@gransolar.com"
        self.cfg.save()
        for alert_type in (
            "km_reading_pending",
            "fuel_reading_pending",
            "itv_due",
            "maintenance_due",
        ):
            self.assertEqual(
                mailer._recipients_for(Alert(vehicle=vehicle, type=alert_type)),
                [("other", "team@gransolar.com")],
            )
        for kind in ("general", "accident"):
            Incident.objects.create(vehicle=vehicle, type=kind)
        self.assertEqual(
            list(EmailOutbox.objects.values_list("recipient", flat=True)),
            ["team@gransolar.com"] * 2,
        )
