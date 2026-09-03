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

from .models import Alert, Document, EventItv, Incident, KmReading
from .models.enums import AlertStatus, AlertType, DocumentType, ItvResult
from .services import accidents, alerts


@receiver(post_save, sender=EventItv, dispatch_uid="fleet_itv_registered")
def on_itv_registered(sender, instance: EventItv, **kwargs):
    """C5: refresca la próxima ITV y cierra sus alertas — con dos candados.

    1. Se toma el `EventItv` **más reciente por fecha de evento**, no el de
       `next_due` mayor. Ordenar por `-next_due` convertía una sola fecha
       disparatada (un `2099-01-01` teclado por cualquiera con acceso al
       vehículo) en la próxima ITV definitiva: ganaba para siempre, y el job
       `refresh_next_itv` la reafirmaba en cada pasada.
    2. Solo un resultado FAVORABLE actualiza el denormalizado y cierra las
       alertas. Una ITV "no favorable" no exime de nada: el aviso sigue abierto.

    2026-08-31: manda la última favorable **aunque venga sin `next_due`** (la
    fecha del informe es opcional desde el registro en campo). Conservar la
    fecha anterior dejaba al coche citado para una ITV que acababa de pasar:
    seguía pintada en amarillo/rojo en las fichas y, al llegar el día,
    `check_itv` levantaba una crítica de "ITV vencida" con la alerta anterior ya
    cerrada. Sin fecha no hay cita: se vacía y la repone el registro que traiga
    el informe.
    """
    vehicle = instance.event.vehicle

    # 1) Próxima ITV = la del último registro FAVORABLE del vehículo.
    latest = (
        EventItv.objects.filter(event__vehicle=vehicle)
        .exclude(result=ItvResult.NOT_DONE)
        .order_by("-event__event_date", "-event_id")
        .first()
    )
    new_value = latest.next_due if latest else None
    if vehicle.next_itv_date != new_value:
        vehicle.next_itv_date = new_value
        vehicle.save(update_fields=["next_itv_date", "updated_at"])

    # 2) Las alertas se cierran solo si la ITV se pasó de verdad.
    if instance.is_favourable:
        Alert.objects.filter(
            vehicle=vehicle, type=AlertType.ITV_DUE, status=AlertStatus.OPEN
        ).update(status=AlertStatus.RESOLVED, resolved_at=timezone.now())


@receiver(post_save, sender=Document, dispatch_uid="fleet_insurance_document_saved")
def on_insurance_document_saved(sender, instance: Document, **kwargs):
    """N2: la póliza renovada actualiza el vencimiento del seguro del vehículo.

    Mismo patrón que la ITV: al subir/editar un documento de seguro con
    caducidad **más reciente** que la registrada, se denormaliza en
    `Vehicle.insurance_expiry_date` y se cierran las alertas de seguro abiertas
    (el aviso ya no aplica: hay póliza nueva).
    """
    if instance.type != DocumentType.INSURANCE or instance.expiry_date is None:
        return
    # Un documento personal (de usuario) no tiene vehículo que denormalizar.
    if instance.vehicle_id is None:
        return
    vehicle = instance.vehicle
    current = vehicle.insurance_expiry_date
    if current is not None and instance.expiry_date <= current:
        return
    vehicle.insurance_expiry_date = instance.expiry_date
    vehicle.save(update_fields=["insurance_expiry_date", "updated_at"])
    Alert.objects.filter(
        vehicle=vehicle, type=AlertType.INSURANCE_DUE, status=AlertStatus.OPEN
    ).update(status=AlertStatus.RESOLVED, resolved_at=timezone.now())


@receiver(post_save, sender=Incident, dispatch_uid="fleet_accident_report_materialized")
def on_incident_saved(sender, instance: Incident, **kwargs):
    """El parte de accidente del JSON `details` se materializa en sus tablas.

    Idempotente y para TODOS los caminos de escritura (PWA, gestión, admin):
    ver `services/accidents.py`. Para el resto de incidencias no hace nada.
    """
    accidents.sync_accident_report(instance)


@receiver(post_save, sender=KmReading, dispatch_uid="fleet_km_reading_registered")
def on_km_reading_registered(sender, instance: KmReading, **kwargs):
    """HU-3.2: una lectura cierra los avisos pendientes hasta su periodo.

    Una lectura posterior hace que los recordatorios anteriores dejen de ser
    accionables. Una lectura atrasada no cierra avisos de meses posteriores.
    """
    if instance.reading_date is None or not instance.is_active:
        # N7: guardar una desactivación no debe cerrar el aviso del periodo.
        return
    period = f"{instance.reading_date.year:04d}-{instance.reading_date.month:02d}"
    alerts.resolve_satisfied_km_reading_alerts({instance.vehicle_id: period})
