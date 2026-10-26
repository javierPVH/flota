"""Rastro de las exportaciones de datos: quién se bajó qué, cuándo y desde dónde.

Los informes (Excel/CSV de la pantalla de Informes y los envíos programados)
y el CSV de la pantalla de Usuarios sacan datos personales —teléfono y
correo— de muchas personas de una vez. Exportar es legítimo; lo que no puede
ser es que no quede constancia. Cada exportación deja aquí una fila con el
actor, el informe, el formato, los filtros, cuántas filas salieron y la IP.

Nada se borra de aquí (ni siquiera por erratas): es un registro de acceso.
"""

from django.conf import settings
from django.db import models

from .base import TimeStampedModel


class ReportExport(TimeStampedModel):
    class Source(models.TextChoices):
        #: Descarga a mano desde la pantalla de Informes (`GET /reports/`).
        DOWNLOAD = "download", "Descarga de informe"
        #: Adjunto de un envío programado (Ajustes → Notificaciones).
        SCHEDULED = "scheduled", "Envío programado"
        #: CSV compuesto en el navegador a partir de una tabla (Usuarios). Lo
        #: anota la pantalla antes de generar el fichero: el back no ve ese
        #: CSV, así que es lo único que puede dejar rastro de él.
        SCREEN = "screen", "CSV de pantalla"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        verbose_name="Usuario",
        null=True,
        on_delete=models.SET_NULL,
        related_name="report_exports",
    )
    source = models.CharField("Origen", max_length=10, choices=Source.choices)
    #: Clave del informe (`reports.REPORT_KINDS`) o de la pantalla (`users`).
    kind = models.CharField("Informe", max_length=30)
    fmt = models.CharField("Formato", max_length=10)
    filters = models.JSONField("Filtros", default=dict, blank=True)
    #: Solo en el CSV de pantalla: qué columnas se incluyeron.
    columns = models.JSONField("Columnas", default=list, blank=True)
    row_count = models.PositiveIntegerField("Filas", null=True, blank=True)
    ip = models.CharField("IP", max_length=45, blank=True)
    schedule = models.ForeignKey(
        "fleet.NotificationSchedule",
        verbose_name="Envío programado",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="exports",
    )

    class Meta:
        verbose_name = "exportación"
        verbose_name_plural = "exportaciones"
        ordering = ["-created_at", "-pk"]

    def __str__(self) -> str:
        quien = self.user.get_username() if self.user else "—"
        return f"{quien} · {self.kind} ({self.fmt})"

    @classmethod
    def record(
        cls,
        user,
        source: str,
        kind: str,
        fmt: str,
        *,
        filters: dict | None = None,
        columns: list | None = None,
        row_count: int | None = None,
        request=None,
        schedule=None,
    ) -> "ReportExport":
        """Anota una exportación. La IP sale de la petición si la hay (con el
        mismo criterio de proxies de confianza que el rate limit del login)."""
        from accounts.ratelimit import client_ip

        return cls.objects.create(
            user=user,
            source=source,
            kind=kind,
            fmt=fmt,
            filters=filters or {},
            columns=columns or [],
            row_count=row_count,
            ip=client_ip(request) if request is not None else "",
            schedule=schedule,
        )
