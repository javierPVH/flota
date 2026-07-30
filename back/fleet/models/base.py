"""Modelo base reutilizable del dominio."""

from django.conf import settings
from django.db import models
from django.utils import timezone


class TimeStampedModel(models.Model):
    """Añade marcas de tiempo de creación y última modificación.

    Base de la auditoría/orden temporal: todos los modelos de dominio las tienen.
    """

    created_at = models.DateTimeField("Creado", auto_now_add=True)
    updated_at = models.DateTimeField("Actualizado", auto_now=True)

    class Meta:
        abstract = True


class DeactivatableModel(models.Model):
    """N7: nada se borra — se DESACTIVA con actor, momento y motivo.

    Los `destroy` de los viewsets desactivan (patrón de `UserViewSet`); el
    registro pasa al espacio de erratas (`/api/v1/erratas/`), donde la
    administración puede restaurarlo y SOLO el superusuario purgarlo de verdad.
    """

    is_active = models.BooleanField("Activo", default=True)
    deactivated_at = models.DateTimeField("Desactivado el", null=True, blank=True)
    deactivated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        verbose_name="Desactivado por",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    deactivation_reason = models.CharField("Motivo", max_length=250, blank=True)

    class Meta:
        abstract = True

    def deactivate(self, *, by=None, reason: str = "") -> None:
        self.is_active = False
        self.deactivated_at = timezone.now()
        self.deactivated_by = by
        self.deactivation_reason = reason[:250]
        self.save(
            update_fields=[
                "is_active",
                "deactivated_at",
                "deactivated_by",
                "deactivation_reason",
                "updated_at",
            ]
        )

    def restore(self) -> None:
        self.is_active = True
        self.deactivated_at = None
        self.deactivated_by = None
        self.deactivation_reason = ""
        self.save(
            update_fields=[
                "is_active",
                "deactivated_at",
                "deactivated_by",
                "deactivation_reason",
                "updated_at",
            ]
        )
