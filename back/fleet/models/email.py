"""N10 — correo de alertas: plantillas, firmas y registro de envíos.

- `EmailTemplate` (10b): una plantilla por tipo de alerta (+ genérica), con
  asunto y cuerpo HTML editables desde el gestor maestro (10c). Las variables
  `{{matricula}}`, `{{conductor}}`… se interpolan con valores ESCAPADOS y
  allowlist (ver `services/mailer.py`); el HTML del cuerpo se sanea en el
  serializer (nh3) al guardar.
- `EmailSignature` (10c): firmas reutilizables, seleccionables por plantilla.
- `EmailLog` (10a): traza de cada envío (destinatario, plantilla, alerta,
  estado) para soporte.
"""

from django.db import models

from .base import DeactivatableModel, TimeStampedModel


class EmailTemplateKey(models.TextChoices):
    INSURANCE_DUE = "insurance_due", "Seguro próximo / vencido (a la empresa de renting)"
    ITV_DUE = "itv_due", "ITV próxima / vencida (aviso de ITV)"
    STATE_NOTICE = "state_notice", "Comunicado de estado del vehículo"
    KM_OVERAGE = "km_overage", "Exceso de km proyectado (al conductor)"
    KM_READING_PENDING = "km_reading_pending", "Lectura de km pendiente (al conductor)"
    GENERIC = "generic", "Genérica (resto de avisos)"


class EmailSignature(DeactivatableModel, TimeStampedModel):
    name = models.CharField("Nombre", max_length=100, unique=True)
    body_html = models.TextField("Firma (HTML)", blank=True)

    class Meta:
        verbose_name = "firma de correo"
        verbose_name_plural = "firmas de correo"
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name


class EmailTemplate(DeactivatableModel, TimeStampedModel):
    key = models.CharField("Tipo", max_length=30, choices=EmailTemplateKey.choices, unique=True)
    subject = models.CharField("Asunto", max_length=200)
    body_html = models.TextField(
        "Cuerpo (HTML)",
        help_text="HTML saneado en servidor; variables {{matricula}}, {{conductor}}…",
    )
    signature = models.ForeignKey(
        EmailSignature,
        verbose_name="Firma",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="templates",
    )

    class Meta:
        verbose_name = "plantilla de correo"
        verbose_name_plural = "plantillas de correo"
        ordering = ["key"]

    def __str__(self) -> str:
        return self.get_key_display()


class EmailLog(TimeStampedModel):
    class Status(models.TextChoices):
        SENT = "sent", "Enviado"
        FAILED = "failed", "Fallido"
        SKIPPED = "skipped", "Omitido (sin destinatario / deshabilitado)"

    alert = models.ForeignKey(
        "fleet.Alert",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="emails",
        verbose_name="Alerta",
    )
    template_key = models.CharField("Plantilla", max_length=30, blank=True)
    recipient = models.CharField("Destinatario", max_length=254, blank=True)
    subject = models.CharField("Asunto", max_length=200, blank=True)
    status = models.CharField("Estado", max_length=10, choices=Status.choices)
    error = models.TextField("Error", blank=True)

    class Meta:
        verbose_name = "envío de correo"
        verbose_name_plural = "envíos de correo"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.recipient} · {self.get_status_display()}"
