"""Ejecuta todos los trabajos programados de flota de una vez.

Refresca `next_itv_date` y lanza los cuatro chequeos (ITV, km pendientes, sin
conductor, exceso de km). Útil para un único cron diario o para pruebas. Uso:

    python manage.py run_fleet_jobs
"""

from django.core.management.base import BaseCommand

from fleet.services import alerts


class Command(BaseCommand):
    help = "Refresca la ITV y ejecuta todos los chequeos de alertas de flota."

    def handle(self, *args, **options):
        summary = alerts.run_all()
        self.stdout.write(self.style.SUCCESS("Trabajos de flota ejecutados:"))
        for key, value in summary.items():
            self.stdout.write(f"  · {key}: {value}")
