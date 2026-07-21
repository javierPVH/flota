"""Modelo base reutilizable del dominio."""
from django.db import models


class TimeStampedModel(models.Model):
    """Añade marcas de tiempo de creación y última modificación.

    Base de la auditoría/orden temporal: todos los modelos de dominio las tienen.
    """

    created_at = models.DateTimeField("Creado", auto_now_add=True)
    updated_at = models.DateTimeField("Actualizado", auto_now=True)

    class Meta:
        abstract = True
