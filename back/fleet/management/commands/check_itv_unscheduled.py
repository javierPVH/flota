"""Aviso «ITV sin cita»: la ITV se pasó y nadie ha citado la siguiente.

Lo levanta el registro de campo (que viaja sin `next_due`): sin fecha no hay
`itv_due` que abrir y el coche rodaría hasta vencer sin que la gestión lo viera.
Lo ejecuta `run_fleet_jobs` tras `check_itv`. Uso:

    python manage.py check_itv_unscheduled
"""

from django.core.management.base import BaseCommand

from fleet.services import alerts


class Command(BaseCommand):
    help = "Avisa a la gestión de los vehículos que pasaron la ITV sin cita para la siguiente."

    def handle(self, *args, **options):
        created = alerts.check_itv_unscheduled()
        self.stdout.write(self.style.SUCCESS(f"ITV sin cita: {created} alerta(s) nueva(s)."))
