"""Alerta de vencimiento de seguro (N2) — ejecutable suelto.

En Docker no hace falta (el servicio `jobs` ejecuta `run_fleet_jobs`, que ya
incluye este chequeo); existe para el despliegue bare-metal por crontab, que
desglosa los chequeos comando a comando (A6 de ANALISIS_PROYECTO.md).
"""

from django.core.management.base import BaseCommand

from fleet.services import alerts


class Command(BaseCommand):
    help = "Crea las alertas de seguro próximo/vencido (buckets 30/15/7)."

    def handle(self, *args, **kwargs):
        created = alerts.check_insurance()
        self.stdout.write(self.style.SUCCESS(f"check_insurance: {created} alertas nuevas."))
