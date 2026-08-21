"""Despacha los envíos programados que ya han vencido (Ajustes → Notificaciones).

Idempotente: cada envío anota su `last_run_at`, así que repetir el comando en la
misma tanda no vuelve a mandar nada. Va dentro de `run_fleet_jobs`, que en Docker
corre en bucle cada `FLEET_JOBS_INTERVAL` segundos (15 min por defecto): la hora
configurada se cumple con esa precisión, no al segundo.
"""

from django.core.management.base import BaseCommand

from fleet.services import notifications


class Command(BaseCommand):
    help = "Envía los informes y resúmenes programados cuya hora ya ha pasado."

    def handle(self, *args, **options):
        if not notifications.enabled():
            self.stdout.write("Envíos programados desactivados (FLEET_NOTIFICATIONS_ENABLED).")
            return
        total = notifications.dispatch()
        self.stdout.write(
            f"{total['run']} envíos despachados: {total['queued']} por correo, "
            f"{total['drive']} a Drive, {total['failed']} con error."
        )
