"""Ejecuta todos los trabajos programados de flota de una vez.

Refresca `next_itv_date`, lanza los seis chequeos (ITV, seguro, km pendientes,
sin conductor, exceso de km y mantenimiento preventivo), despacha los envíos
programados que hayan vencido
(Ajustes → Notificaciones) y, al final, vacía la cola de correo (M6). Útil para
un único cron diario o para pruebas. Uso:

    python manage.py run_fleet_jobs
"""

from django.core.management.base import BaseCommand

from fleet.services import alerts, notifications, supervisors


class Command(BaseCommand):
    help = "Refresca la ITV, ejecuta los chequeos de alertas y entrega la cola de correo."

    def handle(self, *args, **options):
        # Antes que los chequeos: un relevo de supervisor programado para hoy
        # tiene que estar puesto cuando las alertas decidan a quién avisan.
        try:
            relevos = supervisors.sync_scheduled_periods()
        except Exception as exc:  # noqa: BLE001 — se reporta, no tumba la pasada
            relevos = None
            relevos_error = f"{type(exc).__name__}: {exc}"[:200]
        summary = alerts.run_all()
        if relevos is None:
            summary["supervisors_error"] = relevos_error
        else:
            summary["supervisors_synced"] = relevos
        # Los envíos programados van DESPUÉS de los chequeos: así el resumen del
        # correo cuenta las alertas de esta misma pasada y no las de la anterior.
        if notifications.enabled():
            # R5-04: un fallo al despachar los envíos programados no tumba la
            # pasada (los chequeos y la cola de correo ya han corrido).
            try:
                for key, value in notifications.dispatch().items():
                    summary[f"notif_{key}"] = value
            except Exception as exc:  # noqa: BLE001 — se reporta, no se oculta
                summary["notif_error"] = f"{type(exc).__name__}: {exc}"[:200]
        self.stdout.write(self.style.SUCCESS("Trabajos de flota ejecutados:"))
        for key, value in summary.items():
            self.stdout.write(f"  · {key}: {value}")
        if any(str(key).endswith("_error") for key in summary):
            self.stderr.write(self.style.WARNING("Algún trabajo falló: revisa las claves *_error."))
