"""Señales del dominio de flota.

Hoy: al registrar una ITV (`EventItv`) se refresca el denormalizado
`Vehicle.next_itv_date` y se **cierran automáticamente** las alertas de ITV
abiertas del vehículo (HU-5.1: "al registrar una ITV con nueva fecha, los avisos
asociados se cierran automáticamente"); y al registrar una lectura de km se
cierra el aviso mensual de lectura pendiente de ese periodo (HU-3.2: "el aviso
desaparece al registrar"). Se conecta en `FleetConfig.ready()`.
"""

from django.db.models.signals import post_save
from django.dispatch import receiver
from django.utils import timezone

from .models import Alert, EventItv, KmReading
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


@receiver(post_save, sender=KmReading, dispatch_uid="fleet_km_reading_registered")
def on_km_reading_registered(sender, instance: KmReading, **kwargs):
    """HU-3.2: la lectura del mes cierra el aviso 'lectura pendiente' del periodo.

    La `dedup_key` del motor de alertas es `km_pending:{vehicle}:{YYYY-MM}`, así
    que solo se cierra el aviso del mes de la lectura (una lectura atrasada de
    junio no cierra el aviso de julio).
    """
    if instance.reading_date is None:
        return
    period = f"{instance.reading_date.year:04d}-{instance.reading_date.month:02d}"
    Alert.objects.filter(
        vehicle=instance.vehicle,
        type=AlertType.KM_READING_PENDING,
        status=AlertStatus.OPEN,
        dedup_key=f"km_pending:{instance.vehicle_id}:{period}",
    ).update(status=AlertStatus.RESOLVED, resolved_at=timezone.now())
