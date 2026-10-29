"""N10 — correo de alertas: plantillas, firmas y registro de envíos.

- `EmailTemplate` (10b): una plantilla por tipo de alerta (+ genérica), con
  asunto y cuerpo HTML editables desde el gestor maestro (10c). Las variables
  `{{matricula}}`, `{{conductor}}`… se interpolan con valores ESCAPADOS y
  allowlist (ver `services/mailer.py`); el HTML del cuerpo se sanea en el
  serializer (nh3) al guardar.
- `EmailSignature` (10c): firmas reutilizables, seleccionables por plantilla.
- `EmailOutbox` (M6): cola de salida. El motor de alertas **encola** y un
  trabajo aparte entrega, con reintentos acotados; así un SMTP lento o caído no
  frena la generación de avisos ni pierde el correo.
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
    FUEL_READING_PENDING = "fuel_reading_pending", "Consumo de combustible pendiente (al conductor)"
    MAINTENANCE_DUE = "maintenance_due", "Mantenimiento próximo / vencido (recordatorio)"
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
    """Plantilla de un tipo de aviso, en castellano y (opcionalmente) en inglés.

    El castellano es la versión de referencia y siempre existe; la inglesa es
    opcional y, si falta, se cae a la castellana en vez de mandar un correo
    vacío. La firma es común: no se traduce.
    """

    key = models.CharField("Tipo", max_length=30, choices=EmailTemplateKey.choices, unique=True)
    subject = models.CharField("Asunto", max_length=200)
    body_html = models.TextField(
        "Cuerpo (HTML)",
        help_text="HTML saneado en servidor; variables {{matricula}}, {{conductor}}…",
    )
    subject_en = models.CharField("Asunto (EN)", max_length=200, blank=True)
    body_html_en = models.TextField(
        "Cuerpo EN (HTML)",
        blank=True,
        help_text="Versión inglesa. Vacía = se usa la castellana.",
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

    @property
    def has_en(self) -> bool:
        """True si hay versión inglesa propia (asunto o cuerpo)."""
        return bool(self.subject_en.strip() or self.body_html_en.strip())

    def parts(self, lang: str = "es") -> tuple[str, str]:
        """(asunto, cuerpo) en el idioma pedido, con caída al castellano campo
        a campo: traducir solo el asunto no debe vaciar el cuerpo."""
        if lang == "en":
            return (self.subject_en or self.subject, self.body_html_en or self.body_html)
        return self.subject, self.body_html


class RecipientRole(models.TextChoices):
    """A quién se mandó un correo, por su papel: es lo que se lee en la traza
    («al conductor», «a un administrador»…), no la dirección."""

    DRIVER = "driver", "Conductor"
    SUPERVISOR = "supervisor", "Supervisor"
    ADMIN = "admin", "Administrador"
    RENTING = "renting", "Renting"
    OTHER = "other", "Otro correo"
    SCHEDULED = "scheduled", "Envío programado"
    TEST = "test", "Prueba"


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
    #: De qué coche habla el correo, para leer su actividad desde la ficha
    #: (`/vehicles/{id}/email-activity/`). Lo pone quien escribe la fila —la
    #: alerta trae el suyo; el comunicado, el de la ficha—; las filas
    #: anteriores a esto se alcanzan por `alert__vehicle`.
    vehicle = models.ForeignKey(
        "fleet.Vehicle",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="email_logs",
        verbose_name="Vehículo",
    )
    #: Si lo mandó una persona desde la ficha (comunicado, recordatorio,
    #: reenvío) y no el motor de alertas ni un envío programado: la ficha
    #: distingue las automatizaciones de lo que ya se mandó a mano.
    manual = models.BooleanField("Enviado a mano", default=False)
    template_key = models.CharField("Plantilla", max_length=30, blank=True)
    recipient = models.CharField("Destinatario", max_length=254, blank=True)
    #: Por qué papel le llegó (conductor, supervisor, administrador…). Vacío
    #: en las filas anteriores a esto.
    recipient_role = models.CharField(
        "Enviado a", max_length=12, choices=RecipientRole.choices, blank=True, default=""
    )
    #: La TANDA: un mismo envío a varias personas (el comunicado de un coche,
    #: el recordatorio de una alerta a conductor y administradores, un envío
    #: programado) comparte este identificador, y la traza se lee agrupada por
    #: él. Vacío en las filas anteriores a esto.
    batch = models.CharField("Tanda", max_length=40, blank=True, default="", db_index=True)
    subject = models.CharField("Asunto", max_length=200, blank=True)
    status = models.CharField("Estado", max_length=10, choices=Status.choices)
    error = models.TextField("Error", blank=True)
    #: El cuerpo tal y como se compuso (ANTES de la caja corporativa, que se
    #: pone al construir el mensaje): es lo que permite **reenviar** el mismo
    #: correo desde la traza. Las filas anteriores a esto van vacías y no se
    #: pueden reenviar.
    body_html = models.TextField("Cuerpo (HTML)", blank=True, default="")
    #: Nombre del adjunto que llevaba (los informes programados). El fichero
    #: no se conserva, así que un correo con adjunto no se reenvía desde aquí.
    attachment_name = models.CharField("Adjunto", max_length=200, blank=True, default="")
    #: El envío del que es reenvío, si lo es.
    resent_from = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="resends",
        verbose_name="Reenvío de",
    )

    @property
    def can_resend(self) -> bool:
        """Se puede reenviar tal cual: hay cuerpo y destinatario, y no llevaba
        adjunto (que no se conserva)."""
        return bool(self.body_html and self.recipient and not self.attachment_name)

    class Meta:
        verbose_name = "envío de correo"
        verbose_name_plural = "envíos de correo"
        ordering = ["-created_at", "-pk"]  # R3-23/R5-19: desempate estable

    def __str__(self) -> str:
        return f"{self.recipient} · {self.get_status_display()}"


class EmailOutbox(TimeStampedModel):
    """M6 — cola de correo saliente del motor de alertas.

    Antes `upsert_alert` abría el SMTP **dentro** del bucle de chequeos: con un
    servidor lento, generar las alertas del día se volvía O(n) sockets (y con
    uno caído, cada aviso se perdía sin reintento, solo con una línea en
    `EmailLog`). Ahora el chequeo deja aquí el correo ya renderizado y
    `services/mailer.send_outbox()` lo entrega fuera del camino crítico,
    reintentando hasta `FLEET_EMAIL_MAX_ATTEMPTS` antes de darlo por muerto.

    No se borra nada: la fila queda como histórico de la entrega (`sent` /
    `failed`), y `EmailLog` sigue siendo la traza que consulta soporte.
    """

    class Status(models.TextChoices):
        PENDING = "pending", "Pendiente"
        # R3-08: reclamada por una pasada de `send_outbox` que aún no terminó.
        # La entrega se dispara desde tres procesos (jobs, "enviar ahora" del
        # worker web y el despacho de notificaciones): sin el claim, dos
        # pasadas solapadas seleccionaban las mismas filas y el destinatario
        # recibía el correo dos veces.
        SENDING = "sending", "Enviándose"
        SENT = "sent", "Enviado"
        FAILED = "failed", "Fallido (sin más reintentos)"

    alert = models.ForeignKey(
        "fleet.Alert",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="queued_emails",
        verbose_name="Alerta",
    )
    #: De qué coche habla (la alerta trae el suyo), como en `EmailLog`.
    vehicle = models.ForeignKey(
        "fleet.Vehicle",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="email_outbox",
        verbose_name="Vehículo",
    )
    template_key = models.CharField("Plantilla", max_length=30, blank=True)
    recipient = models.CharField("Destinatario", max_length=254)
    #: Papel y tanda del envío: viajan a la traza (`EmailLog`) al entregarlo.
    recipient_role = models.CharField(
        "Enviado a", max_length=12, choices=RecipientRole.choices, blank=True, default=""
    )
    batch = models.CharField("Tanda", max_length=40, blank=True, default="")
    subject = models.CharField("Asunto", max_length=200)
    body_html = models.TextField("Cuerpo (HTML)")
    status = models.CharField(
        "Estado", max_length=10, choices=Status.choices, default=Status.PENDING
    )
    attempts = models.PositiveSmallIntegerField("Intentos", default=0)
    last_error = models.TextField("Último error", blank=True)
    sent_at = models.DateTimeField("Enviado", null=True, blank=True)
    # Adjunto opcional (los envíos programados de Ajustes → Notificaciones
    # mandan el informe como fichero). Se guarda en disco porque la cola
    # reintenta: regenerar el informe en cada intento daría un fichero distinto
    # al que anunciaba el correo, y encarecería el reintento. `send_outbox` lo
    # borra al entregarlo, para que la cola no acumule megas.
    attachment = models.FileField("Adjunto", upload_to="outbox/%Y/%m/", blank=True, null=True)
    attachment_name = models.CharField("Nombre del adjunto", max_length=150, blank=True)

    class Meta:
        verbose_name = "correo en cola"
        verbose_name_plural = "correos en cola"
        ordering = ["created_at"]  # FIFO
        indexes = [models.Index(fields=["status", "created_at"], name="idx_outbox_status")]

    def __str__(self) -> str:
        return f"{self.recipient} · {self.get_status_display()}"
