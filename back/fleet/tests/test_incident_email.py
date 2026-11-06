from django.test import TestCase, override_settings

from accounts.models import Role
from fleet.models import EmailLog, EmailOutbox, EmailSettings, Incident, Vehicle
from fleet.serializers import EmailSettingsSerializer
from fleet.services import mailer

from .helpers import make_user


@override_settings(
    FLEET_EMAIL_ENABLED=True, EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend"
)
class IncidentEmailTests(TestCase):
    def setUp(self):
        self.admin = make_user("notice-admin", Role.ADMIN)
        self.admin.email = "notice@example.com"
        self.admin.save()
        self.vehicle = Vehicle.objects.create(plate="NOTICE-1", supervisor=self.admin)
        self.cfg = EmailSettings.get_solo()
        self.cfg.incident_notice_enabled = True
        self.cfg.accident_notice_enabled = True
        self.cfg.incident_notice_admin_ids = [self.admin.pk]
        self.cfg.save()

    def test_creation_routes_types_and_deduplicates_recipients(self):
        for kind in ("general", "accident"):
            incident = Incident.objects.create(
                vehicle=self.vehicle, type=kind, description="<script>alert(1)</script>"
            )
            incident.description = "Updated"
            incident.save()
        self.assertEqual(EmailOutbox.objects.count(), 2)
        self.assertEqual(
            set(EmailOutbox.objects.values_list("template_key", flat=True)),
            {"incident_notice", "accident_notice"},
        )
        self.assertNotIn("<script>", EmailOutbox.objects.first().body_html)
        result = mailer.send_outbox()
        self.assertEqual(result["sent"], 2)

    def test_disabled_and_missing_recipients(self):
        self.cfg.incident_notice_enabled = False
        self.cfg.save()
        Incident.objects.create(vehicle=self.vehicle, type="general")
        self.assertFalse(EmailOutbox.objects.exists())
        self.vehicle.supervisor = None
        self.vehicle.save()
        Incident.objects.create(vehicle=self.vehicle, type="accident")
        self.assertEqual(EmailLog.objects.get().status, EmailLog.Status.SKIPPED)

    def test_settings_validate_recipients_and_clear_admins(self):
        serializer = EmailSettingsSerializer(
            self.cfg,
            data={"incident_notice_admin_ids": [], "incident_notice_to_supervisor": False},
            partial=True,
        )
        self.assertFalse(serializer.is_valid())
        serializer = EmailSettingsSerializer(
            self.cfg,
            data={
                "incident_notice_admin_ids": [],
                "incident_notice_enabled": False,
                "incident_notice_to_supervisor": False,
            },
            partial=True,
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertEqual(serializer.save().incident_notice_admin_ids, [])
