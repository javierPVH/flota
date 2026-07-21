"""Refresca el denormalizado `Vehicle.next_itv_date` desde `EventItv`.

Conviene ejecutarlo antes de `check_itv` (lo hace `run_fleet_jobs`). Uso:

    python manage.py refresh_next_itv
"""
from django.core.management.base import BaseCommand

from fleet.services import alerts


class Command(BaseCommand):
    help = "Recalcula Vehicle.next_itv_date desde el último EventItv.next_due."

    def handle(self, *args, **options):
        updated = alerts.refresh_next_itv_dates()
        self.stdout.write(self.style.SUCCESS(f"next_itv_date actualizado en {updated} vehículo(s)."))
