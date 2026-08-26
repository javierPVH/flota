"""Alertas de mantenimiento preventivo (GAP-8): por meses y/o por km.

Ejecución diaria (ver cron en `back/README.md`). Uso:

    python manage.py check_maintenance
"""

from django.core.management.base import BaseCommand

from fleet.services import alerts


class Command(BaseCommand):
    help = "Genera alertas de mantenimiento preventivo próximo o vencido."

    def handle(self, *args, **options):
        created = alerts.check_maintenance()
        self.stdout.write(self.style.SUCCESS(f"Mantenimiento: {created} alerta(s) nueva(s)."))
