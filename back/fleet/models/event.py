"""Eventos de vehículo y sus subtipos (DBML `events` + `event_*`).

Patrón: `Event` guarda lo común (vehículo, tipo, fecha) y cada subtipo es una
extensión 1-a-1 con la clave primaria compartida (los detalles propios de ese
tipo de evento). Así un evento `penalty` tiene su `EventPenalty`, etc.
"""
from django.conf import settings
from django.db import models

from fleet.enums import EventType


class Event(models.Model):
    """DBML `events` — evento en la vida de un vehículo."""

    vehicle = models.ForeignKey(
        "fleet.Vehicle", on_delete=models.CASCADE, related_name="events"
    )
    event_type = models.CharField("Tipo de evento", max_length=30, choices=EventType.choices)
    event_date = models.DateField("Fecha", null=True, blank=True)

    class Meta:
        verbose_name = "evento"
        verbose_name_plural = "eventos"
        ordering = ["-event_date"]

    def __str__(self) -> str:
        return f"{self.vehicle.plate} · {self.get_event_type_display()} ({self.event_date})"


class EventPenalty(models.Model):
    """DBML `event_penalties`."""

    event = models.OneToOneField(
        Event, on_delete=models.CASCADE, primary_key=True, related_name="penalty"
    )
    amount = models.DecimalField("Importe", max_digits=10, decimal_places=2, null=True, blank=True)
    paid = models.BooleanField("Pagada", default=False)

    class Meta:
        verbose_name = "sanción"
        verbose_name_plural = "sanciones"


class EventFeeChange(models.Model):
    """DBML `event_fee_changes`."""

    event = models.OneToOneField(
        Event, on_delete=models.CASCADE, primary_key=True, related_name="fee_change"
    )
    old_fee = models.DecimalField("Cuota anterior", max_digits=10, decimal_places=2, null=True, blank=True)
    new_fee = models.DecimalField("Cuota nueva", max_digits=10, decimal_places=2, null=True, blank=True)

    class Meta:
        verbose_name = "cambio de cuota"
        verbose_name_plural = "cambios de cuota"


class EventItv(models.Model):
    """DBML `event_itvs`."""

    event = models.OneToOneField(
        Event, on_delete=models.CASCADE, primary_key=True, related_name="itv"
    )
    result = models.CharField("Resultado", max_length=50, blank=True, help_text="p. ej. 'done' / 'not done'.")
    next_due = models.DateField("Próxima ITV", null=True, blank=True)

    class Meta:
        verbose_name = "ITV"
        verbose_name_plural = "ITVs"


class EventProjectChange(models.Model):
    """DBML `event_project_changes`."""

    event = models.OneToOneField(
        Event, on_delete=models.CASCADE, primary_key=True, related_name="project_change"
    )
    old_project = models.ForeignKey(
        "fleet.Project", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    new_project = models.ForeignKey(
        "fleet.Project", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta:
        verbose_name = "cambio de proyecto"
        verbose_name_plural = "cambios de proyecto"


class EventLocationChange(models.Model):
    """DBML `event_location_changes`."""

    event = models.OneToOneField(
        Event, on_delete=models.CASCADE, primary_key=True, related_name="location_change"
    )
    old_location = models.CharField("Ubicación anterior", max_length=150, blank=True)
    new_location = models.CharField("Ubicación nueva", max_length=150, blank=True)

    class Meta:
        verbose_name = "cambio de ubicación"
        verbose_name_plural = "cambios de ubicación"


class EventPepChange(models.Model):
    """DBML `event_pep_changes`."""

    event = models.OneToOneField(
        Event, on_delete=models.CASCADE, primary_key=True, related_name="pep_change"
    )
    old_pep = models.ForeignKey(
        "fleet.Pep", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    new_pep = models.ForeignKey(
        "fleet.Pep", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta:
        verbose_name = "cambio de PEP/CECO"
        verbose_name_plural = "cambios de PEP/CECO"


class EventDriverChange(models.Model):
    """DBML `event_driver_changes`."""

    event = models.OneToOneField(
        Event, on_delete=models.CASCADE, primary_key=True, related_name="driver_change"
    )
    old_driver = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    new_driver = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta:
        verbose_name = "cambio de conductor"
        verbose_name_plural = "cambios de conductor"
