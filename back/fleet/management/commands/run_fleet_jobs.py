"""Ejecuta todos los trabajos programados de flota de una vez.

Refresca `next_itv_date`, lanza los seis chequeos (ITV, seguro, km pendientes,
sin conductor, exceso de km y mantenimiento preventivo), despacha los envíos
programados que hayan vencido
(Ajustes → Notificaciones) y, al final, vacía la cola de correo (M6). Útil para
un único cron diario o para pruebas. Uso:

    python manage.py run_fleet_jobs
"""

from django.core.management.base import BaseCommand

from fleet.services import alerts, notifications


class Command(BaseCommand):
    help = "Refresca la ITV, ejecuta los chequeos de alertas y entrega la cola de correo."

    def handle(self, *args, **options):
        summary = alerts.run_all()
        # Los envíos programados van DESPUÉS de los chequeos: así el resumen del
        # correo cuenta las alertas de esta misma pasada y no las de la anterior.
        if notifications.enabled():
            for key, value in notifications.dispatch().items():
                summary[f"notif_{key}"] = value
        self.stdout.write(self.style.SUCCESS("Trabajos de flota ejecutados:"))
        for key, value in summary.items():
            self.stdout.write(f"  · {key}: {value}")
