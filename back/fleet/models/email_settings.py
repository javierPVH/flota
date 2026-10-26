"""Ajustes del correo saliente, editables desde Ajustes → Correo (fila única).

Dos cosas que hasta ahora vivían en variables de entorno o en el código y que
la administración tiene que poder tocar sin desplegar:

- **El recordatorio de la lectura de km**: la ventana en la que se reclama
  (del día `km_remind_from_day` al `km_remind_until_day` del mes siguiente) y
  **con qué cadencia** salen los correos en ella (`km_remind_mode`): todos los
  días, los pares, los impares o un número de veces (`km_remind_emails`)
  repartido a partes iguales —el primero al abrirse la ventana y el último el
  último día de plazo—. Ese número nunca pasa de los días que tiene el plazo
  en el mes más corto (`email_layout.km_remind_max_emails`), que es lo que
  valida el serializer. Las fechas concretas las calcula
  `email_layout.km_remind_schedule`.
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


class EmailSettings(TimeStampedModel):
    """Fila única con los ajustes del correo (recordatorio de km y aspecto)."""

    SINGLETON_PK = 1

    # --- Recordatorio de la lectura de km ---------------------------------
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
