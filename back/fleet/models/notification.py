"""Envíos programados que cada usuario configura para sí (Ajustes → Notificaciones).

Un `NotificationSchedule` dice **qué** se manda, **cuándo** y **a dónde**:
cualquiera de los informes de la pantalla de Informes —con sus mismos filtros— o
un resumen en el cuerpo del correo, a una hora del día, por correo y/o guardado
en una carpeta de Google Drive. El correo va **solo** a las direcciones escritas
en `extra_recipients`: el formulario prellena la del dueño, pero se puede quitar
para que el envío llegue a otras personas y no a él.

Dos cosas que no son evidentes:

* El contenido se genera SIEMPRE con el ámbito del dueño del envío
  (`reports.render(kind, schedule.user, fmt)`), no con el de quien dispara el
  job. Así un supervisor no puede programarse un informe de toda la flota, y
  añadir destinatarios extra no amplía lo que se ve: solo a quién llega.
* No usa `DeactivatableModel` (N7) a propósito. Esto es configuración personal,
  no histórico de negocio: mandar las suscripciones borradas al espacio de
  erratas lo llenaría de ruido. `DELETE` borra de verdad, que es lo que espera
  quien creó el envío, y vive en Ajustes, donde R0 permite el borrado
  definitivo. Para dejar de recibir sin perder la configuración está `enabled`.
"""

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

from .base import TimeStampedModel


class NotificationSchedule(TimeStampedModel):
    """Un envío programado (Ajustes → Notificaciones)."""

    class Content(models.TextChoices):
        """Qué se envía: el resumen va en el cuerpo, los informes como adjunto.

        Los informes son EXACTAMENTE los de la pantalla de Informes y comparten
        sus claves con `reports.REPORT_KINDS`, para que lo programado y lo que se
        descarga a mano sean lo mismo.
        """

        SUMMARY = "summary", "Resumen de la flota"
        FLEET = "fleet", "Flota"
        KMREADINGS = "kmreadings", "Kilometraje"
        DOCUMENTS = "documents", "Documentos"
        ALERTS = "alerts", "Alertas"
        INVOICES = "invoices", "Facturas"
        COSTS = "costs", "Costes"
        USERS = "users", "Conductores"

    class Frequency(models.TextChoices):
        DAILY = "daily", "Cada día"
        WEEKLY = "weekly", "Cada semana"
        MONTHLY = "monthly", "Cada mes"

    class Format(models.TextChoices):
        """Solo CSV.

        Un único formato para todos los envíos: así el mismo informe no llega
        en dos formas distintas según quién lo programó, y CSV lo abre
        cualquier hoja de cálculo sin depender de la versión de Excel. La
        descarga a mano (pantalla de Informes) sigue ofreciendo los dos.
        """

        CSV = "csv", "CSV"

    class Status(models.TextChoices):
        OK = "ok", "Enviado"
        FAILED = "failed", "Falló"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        verbose_name="Usuario",
        on_delete=models.CASCADE,
        related_name="notification_schedules",
        help_text="Dueño del envío: fija el ámbito del contenido y el destinatario por defecto.",
    )
    name = models.CharField("Nombre", max_length=120)
    content = models.CharField("Contenido", max_length=12, choices=Content.choices)
    fmt = models.CharField(
        "Formato",
        max_length=5,
        choices=Format.choices,
        default=Format.CSV,
        help_text="Los informes se envían en CSV; el resumen va en el cuerpo del correo.",
    )

    #: Filtros del informe, con las mismas claves que su tarjeta en Informes
    #: (`reports.REPORT_FILTERS`). Vacío = sin filtrar, igual que en la pantalla.
    #: Se guardan como JSON porque cada informe admite los suyos.
    filters = models.JSONField("Filtros", default=dict, blank=True)

    #: Fecha y/u hora del envío añadidas al nombre, que es el del asunto y el
    #: del fichero adjunto: un «Informe de flota 2026-08-21» se distingue de la
    #: entrega anterior sin abrirlo, y en Drive no se pisan los ficheros.
    name_with_date = models.BooleanField("Añadir la fecha al nombre", default=False)
    name_with_time = models.BooleanField("Añadir la hora al nombre", default=False)

    frequency = models.CharField("Frecuencia", max_length=10, choices=Frequency.choices)
    #: 0 = lunes … 6 = domingo. Solo en la frecuencia semanal.
    weekday = models.PositiveSmallIntegerField("Día de la semana", null=True, blank=True)
    #: 1–28, para que exista en todos los meses (incluido febrero).
    day_of_month = models.PositiveSmallIntegerField("Día del mes", null=True, blank=True)
    send_at = models.TimeField(
        "Hora",
        help_text="Hora local. El despachador corre por tandas, así que puede salir algo después.",
    )

    enabled = models.BooleanField(
        "Activo",
        default=True,
        help_text="Desactívalo para dejar de recibirlo sin perder la configuración.",
    )
    send_email = models.BooleanField("Enviar por correo", default=True)
    extra_recipients = models.CharField(
        "Destinatarios",
        max_length=500,
        blank=True,
        help_text=(
            "Direcciones separadas por comas. Son las únicas que reciben el envío: "
            "la del usuario no se añade por su cuenta, se prellena en el formulario."
        ),
    )
    save_to_drive = models.BooleanField("Guardar en Google Drive", default=False)
    drive_folder = models.CharField(
        "Carpeta de Drive",
        max_length=200,
        blank=True,
        help_text="Id o URL de la carpeta donde se deja el fichero.",
    )

    #: Última vez que se despachó. Marca el punto desde el que se busca el
    #: siguiente vencimiento, así que el envío nunca se duplica ni se recupera
    #: hacia atrás más de un periodo.
    last_run_at = models.DateTimeField("Último envío", null=True, blank=True)
    last_status = models.CharField("Resultado", max_length=10, choices=Status.choices, blank=True)
    last_error = models.TextField("Último error", blank=True)

    class Meta:
        verbose_name = "envío programado"
        verbose_name_plural = "envíos programados"
        ordering = ["user__username", "send_at", "name"]
        indexes = [
            # El despachador busca los activos en cada tanda.
            models.Index(fields=["enabled", "send_at"], name="idx_notif_enabled_time"),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.get_frequency_display()} {self.send_at:%H:%M})"

    @property
    def is_report(self) -> bool:
        """El resumen no genera fichero; los informes sí."""
        return self.content != self.Content.SUMMARY

    def clean(self):
        """Coherencia entre frecuencia, destinos y contenido.

        Se valida aquí (y no solo en el serializer) para que el admin de Django
        y el seed no puedan dejar filas que el despachador no sabría ejecutar.
        """
        errors: dict[str, str] = {}
        if self.frequency == self.Frequency.WEEKLY and self.weekday is None:
            errors["weekday"] = "La frecuencia semanal necesita un día de la semana."
        if self.frequency == self.Frequency.MONTHLY and self.day_of_month is None:
            errors["day_of_month"] = "La frecuencia mensual necesita un día del mes."
        if self.weekday is not None and not 0 <= self.weekday <= 6:
            errors["weekday"] = "El día de la semana va de 0 (lunes) a 6 (domingo)."
        if self.day_of_month is not None and not 1 <= self.day_of_month <= 28:
            errors["day_of_month"] = "El día del mes va de 1 a 28, para que exista en todos."
        if not self.send_email and not self.save_to_drive:
            errors["send_email"] = "Elige al menos un destino: correo o Google Drive."
        # Solo van las direcciones escritas, así que sin ninguna el envío por
        # correo no tendría a dónde ir: se avisa al guardar, no al despacharlo.
        if self.send_email and not (self.extra_recipients or "").strip():
            errors["extra_recipients"] = "Indica al menos una dirección de correo."
        if self.save_to_drive and not self.drive_folder:
            errors["drive_folder"] = "Indica la carpeta de Drive donde guardarlo."
        if self.save_to_drive and not self.is_report:
            errors["save_to_drive"] = "El resumen no genera fichero: solo puede ir por correo."
        if self.filters:
            from fleet.services.reports import REPORT_FILTERS

            if not self.is_report:
                errors["filters"] = "El resumen no admite filtros."
            else:
                sobran = set(self.filters) - set(REPORT_FILTERS.get(self.content, ()))
                if sobran:
                    admitidos = ", ".join(REPORT_FILTERS.get(self.content, ())) or "ninguno"
                    errors["filters"] = (
                        f"Filtros que este informe no admite: {', '.join(sorted(sobran))}. "
                        f"Admite: {admitidos}."
                    )
        if errors:
            raise ValidationError(errors)
