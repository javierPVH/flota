"""Señales del dominio de flota.

Hoy: al registrar una ITV (`EventItv`) se refresca el denormalizado
`Vehicle.next_itv_date` y se **cierran automáticamente** las alertas de ITV
abiertas del vehículo (HU-5.1: "al registrar una ITV con nueva fecha, los avisos
asociados se cierran automáticamente"). Se conecta en `FleetConfig.ready()`.
"""

from django.db.models.signals import post_save
from django.dispatch import receiver
from django.utils import timezone

from .models import Alert, EventItv
from .models.enums import AlertStatus, AlertType


@receiver(post_save, sender=EventItv, dispatch_uid="fleet_itv_registered")
def on_itv_registered(sender, instance: EventItv, **kwargs):
    vehicle = instance.event.vehicle

    # 1) Refresca la próxima ITV desde el último `EventItv` del vehículo.
    latest = (
        EventItv.objects.filter(event__vehicle=vehicle, next_due__isnull=False)
        .order_by("-next_due")
        .first()
    )
    new_value = latest.next_due if latest else None
    if vehicle.next_itv_date != new_value:
        vehicle.next_itv_date = new_value
        vehicle.save(update_fields=["next_itv_date", "updated_at"])

    # 2) Cierra las alertas de ITV abiertas del vehículo (ya se registró la ITV).
    Alert.objects.filter(vehicle=vehicle, type=AlertType.ITV_DUE, status=AlertStatus.OPEN).update(
        status=AlertStatus.RESOLVED, resolved_at=timezone.now()
    )
