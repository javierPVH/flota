"""Alertas de ITV escalonadas (30/15/7 días y vencida) — HU-5.1.

Ejecución diaria (ver cron en `back/README.md`). Uso:

    python manage.py check_itv
"""

from django.core.management.base import BaseCommand

from fleet.services import alerts


class Command(BaseCommand):
    help = "Genera alertas de ITV próxima/vencida según los umbrales configurados."

    def handle(self, *args, **options):
        created = alerts.check_itv()
        self.stdout.write(self.style.SUCCESS(f"ITV: {created} alerta(s) nueva(s)."))
