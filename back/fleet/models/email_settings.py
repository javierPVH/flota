"""Ajustes del correo saliente, editables desde Ajustes → Correo (fila única).

Dos cosas que hasta ahora vivían en variables de entorno o en el código y que
la administración tiene que poder tocar sin desplegar:

- **El recordatorio de la lectura de km**, que se fija de una de DOS maneras
  (`km_remind_by`): por **plazo** —la ventana en la que se reclama (del día
  `km_remind_from_day` al `km_remind_until_day` del mes siguiente) y **con
  qué cadencia** salen los correos en ella (`km_remind_mode`): todos los
  días, los pares, los impares o un número de veces (`km_remind_emails`)
  repartido a partes iguales —el primero al abrirse la ventana y el último el
  último día de plazo—; ese número nunca pasa de los días que tiene el plazo
  en el mes más corto (`email_layout.km_remind_max_emails`), que es lo que
  valida el serializer— o por **días concretos** (`km_remind_days`: «5, 20,
  28», de menor a mayor), y entonces sale un correo cada uno de esos días
  de CADA mes —el día que un mes no tiene (el 31 en abril) no manda nada
  ese mes— y la cadencia no se mira.
  Y **a quién** va cada correo (`km_remind_to_driver`,
  `km_remind_to_supervisor`, `km_remind_admin_ids`): al conductor del coche
  (sin conductor, a su supervisor), al supervisor y/o a los administradores
  que se elijan uno a uno; `mailer._recipients_for` lo resuelve.
  Las fechas concretas las calcula `email_layout.km_remind_schedule`.
- **El aspecto corporativo** de todos los correos: logotipo, color de marca,
  nombre y pie, que `email_layout.wrap` pone alrededor del cuerpo de
  cualquier plantilla al entregarlo (alertas, comunicados, envíos
  programados y pruebas). Las plantillas siguen siendo solo el cuerpo.

Es una fila única (`get_solo`), creada con los valores por defecto del
entorno (`FLEET_KM_REMIND_*`) la primera vez que se lee: lo que había en el
`.env` sigue valiendo hasta que alguien lo cambie desde la pantalla.
"""

from django.conf import settings
from django.db import models

from .base import TimeStampedModel

#: Color de marca por defecto: el teal corporativo del design system.
DEFAULT_BRAND_COLOR = "#009491"
DEFAULT_BRAND_NAME = "Gestión de flota"
DEFAULT_FOOTER = (
    "Este mensaje lo envía automáticamente la plataforma de gestión de flota. "
    "No respondas a este correo: para cualquier duda, contacta con la administración de flota."
)


class KmRemindMode(models.TextChoices):
    """Cadencia de los correos del recordatorio de km dentro de su ventana."""

    COUNT = "count", "Un número de correos, repartidos por el plazo"
    DAILY = "daily", "Todos los días"
    ODD = "odd", "Los días impares"
    EVEN = "even", "Los días pares"


class KmRemindBy(models.TextChoices):
    """Cómo se fijan los días del recordatorio: un plazo con cadencia o una
    lista de días concretos."""

    WINDOW = "window", "Plazo de reclamación"
    DAYS = "days", "Días concretos"


class EmailSettings(TimeStampedModel):
    """Fila única con los ajustes del correo (recordatorio de km y aspecto)."""

    SINGLETON_PK = 1

    # --- Recordatorio de la lectura de km ---------------------------------
    km_remind_enabled = models.BooleanField(
        "Recordatorio de km activo",
        default=True,
        help_text=(
            "Apagado, no se abren avisos de lectura pendiente ni salen sus correos; "
            "los abiertos se siguen cerrando cuando llega la lectura."
        ),
    )
    km_remind_by = models.CharField(
        "Cómo se fijan los días",
        max_length=10,
        choices=KmRemindBy.choices,
        default=KmRemindBy.WINDOW,
        help_text="Por plazo (del día X al Y, con su cadencia) o por días concretos.",
    )
    km_remind_days = models.CharField(
        "Días concretos",
        max_length=120,
        blank=True,
        default="",
        help_text=(
            "Días del mes separados por comas (1-31), de menor a mayor: cada mes sale "
            "un correo esos días; el día que un mes no tiene no manda nada ese mes. "
            "Solo con «días concretos»."
        ),
    )
    km_remind_from_day = models.PositiveSmallIntegerField(
        "Día en que empieza a reclamarse",
        default=20,
        help_text="Día del mes (1-28) desde el que se abre el aviso y sale el primer correo.",
    )
    km_remind_until_day = models.PositiveSmallIntegerField(
        "Día del mes siguiente hasta el que se reclama",
        default=5,
        help_text="0 = la ventana acaba a fin de mes; 1-28 = sigue reclamándose hasta ese día.",
    )
    km_remind_mode = models.CharField(
        "Cadencia de los correos",
        max_length=10,
        choices=KmRemindMode.choices,
        default=KmRemindMode.COUNT,
        help_text="Todos los días, pares, impares o un número de correos repartidos.",
    )
    km_remind_emails = models.PositiveSmallIntegerField(
        "Correos por ventana",
        default=2,
        help_text=(
            "Con la cadencia «un número de correos»: cuántos recibe el conductor "
            "mientras siga sin lectura. Como mucho, los días del plazo."
        ),
    )
    # --- A quién se manda el recordatorio ------------------------------------
    km_remind_to_driver = models.BooleanField(
        "Al conductor",
        default=True,
        help_text="Al conductor vigente del coche; sin conductor, a su supervisor.",
    )
    km_remind_to_supervisor = models.BooleanField(
        "Al supervisor",
        default=False,
        help_text="Al supervisor del coche, además del conductor.",
    )
    km_remind_admin_ids = models.JSONField(
        "Administradores avisados",
        default=list,
        blank=True,
        help_text="Ids de los administradores que reciben también cada recordatorio.",
    )

    # --- Aspecto corporativo --------------------------------------------------
    layout_enabled = models.BooleanField("Maquetación corporativa", default=True)
    brand_name = models.CharField("Nombre de marca", max_length=80, default=DEFAULT_BRAND_NAME)
    brand_color = models.CharField("Color de marca", max_length=7, default=DEFAULT_BRAND_COLOR)
    logo = models.FileField(
        "Logotipo",
        upload_to="email/",
        blank=True,
        help_text="PNG o JPG, hasta 300 KB. Vacío = el logotipo corporativo por defecto.",
    )
    footer_text = models.TextField("Pie del correo", default=DEFAULT_FOOTER, blank=True)

    class Meta:
        verbose_name = "ajustes del correo"
        verbose_name_plural = "ajustes del correo"

    def __str__(self) -> str:
        return "Ajustes del correo"

    @classmethod
    def get_solo(cls) -> "EmailSettings":
        """La fila única; se crea con los defaults del entorno si no existe."""
        obj, _ = cls.objects.get_or_create(
            pk=cls.SINGLETON_PK,
            defaults={
                "km_remind_from_day": max(1, settings.FLEET_KM_REMIND_FROM_DAY or 20),
                "km_remind_until_day": settings.FLEET_KM_REMIND_UNTIL_DAY,
            },
        )
        return obj

    def save(self, *args, **kwargs):
        self.pk = self.SINGLETON_PK
        super().save(*args, **kwargs)
