from django.conf import settings
from django.db import models


class Vehicle(models.Model):
    """Vehículo de la flota.

    Primer recurso de dominio. La gestión (admin / admin de flota) hace el CRUD
    completo; el conductor solo ve el/los vehículos que tiene asignados.
    """

    class Status(models.TextChoices):
        ACTIVE = "active", "Activo"
        MAINTENANCE = "maintenance", "En mantenimiento"
        RETIRED = "retired", "Retirado"

    plate = models.CharField("Matrícula", max_length=20, unique=True)
    brand = models.CharField("Marca", max_length=60)
    model = models.CharField("Modelo", max_length=60)
    year = models.PositiveIntegerField("Año", null=True, blank=True)
    status = models.CharField(
        "Estado", max_length=20, choices=Status.choices, default=Status.ACTIVE
    )
    # Conductor asignado. Limitado a usuarios con rol conductor (validado en el
    # serializer). SET_NULL: si se borra el usuario, el vehículo queda libre.
    assigned_driver = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="assigned_vehicles",
        verbose_name="Conductor asignado",
    )
    notes = models.TextField("Observaciones", blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["plate"]
        verbose_name = "vehículo"
        verbose_name_plural = "vehículos"

    def __str__(self) -> str:
        return f"{self.plate} — {self.brand} {self.model}"
