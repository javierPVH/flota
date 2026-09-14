"""Señales del dominio de flota.

Hoy: al registrar una ITV (`EventItv`) se refresca el denormalizado
`Vehicle.next_itv_date` (puro dato; el cierre de sus alertas, que necesita
ACTOR, vive en `services/itv.py` y lo llama la vista — HU-5.1); y al registrar
una lectura de km se cierra el aviso mensual de lectura pendiente de ese periodo
(HU-3.2: "el aviso desaparece al registrar"). Se conecta en `FleetConfig.ready()`.
"""

from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import Document, EventItv, Incident, KmReading, Vehicle
from .models.enums import DocumentType, ItvResult
from .services import accidents, alerts, insurance


@receiver(post_save, sender=EventItv, dispatch_uid="fleet_itv_registered")
def on_itv_registered(sender, instance: EventItv, **kwargs):
    """C5: refresca la próxima ITV — con dos candados.

    1. Se toma el `EventItv` **más reciente por fecha de evento**, no el de
       `next_due` mayor. Ordenar por `-next_due` convertía una sola fecha
       disparatada (un `2099-01-01` teclado por cualquiera con acceso al
       vehículo) en la próxima ITV definitiva: ganaba para siempre, y el job
       `refresh_next_itv` la reafirmaba en cada pasada.
    2. Solo un resultado FAVORABLE actualiza el denormalizado. Una ITV "no
       favorable" no exime de nada.

    2026-08-31: manda la última favorable **aunque venga sin `next_due`** (la
    fecha del informe es opcional desde el registro en campo). Conservar la
    fecha anterior dejaba al coche citado para una ITV que acababa de pasar:
    seguía pintada en amarillo/rojo en las fichas y, al llegar el día,
    `check_itv` levantaba una crítica de "ITV vencida" con la alerta anterior ya
    cerrada. Sin fecha no hay cita: se vacía y la repone el registro que traiga
    el informe.

    2026-09-08: el cierre de las alertas `itv_due` ya NO va aquí. Una señal no
    sabe quién registró la ITV y dejaba el cierre sin actor ni nota («cierre
    automático»). Vive en `services/itv.register_itv`, que llama la vista con
    `request.user`; el alta por ORM/admin solo refresca la fecha.
    """
    # El vehículo se relee: `instance.event.vehicle` devuelve la instancia que
    # trajera el evento, y guardar campos desde una copia vieja pisa lo que
    # haya cambiado entre medias (p. ej. la cita manual de `schedule_itv`, que
    # esta señal tiene que desmarcar).
    vehicle = Vehicle.objects.get(pk=instance.event.vehicle_id)

    # Próxima ITV = la del último registro FAVORABLE del vehículo.
    latest = (
        EventItv.objects.filter(event__vehicle=vehicle)
        .exclude(result=ItvResult.NOT_DONE)
        .order_by("-event__event_date", "-event_id")
        .first()
    )
    new_value = latest.next_due if latest else None
    # Una inspección REGISTRADA manda sobre la cita programada a mano
    # (`services/itv.schedule_itv`): se desmarca el candado para que el job
    # `refresh_next_itv` vuelva a mantener la fecha desde el histórico.
    campos: list[str] = []
    if vehicle.next_itv_date != new_value:
        vehicle.next_itv_date = new_value
        campos.append("next_itv_date")
    if vehicle.next_itv_manual:
        vehicle.next_itv_manual = False
        campos.append("next_itv_manual")
    if campos:
        vehicle.save(update_fields=[*campos, "updated_at"])


@receiver(post_save, sender=Document, dispatch_uid="fleet_insurance_document_saved")
def on_insurance_document_saved(sender, instance: Document, **kwargs):
    """N2: la póliza renovada actualiza el vencimiento del seguro del vehículo.

    Al subir/editar un documento de seguro con caducidad **más reciente** que la
    registrada, `services/insurance.apply_new_expiry` denormaliza la fecha,
    emite el evento de renovación y cierra las alertas de seguro con quien subió
    la póliza (antes se cerraban sin actor). Es idempotente: si la fecha ya
    estaba aplicada (p. ej. por el endpoint de renovar) no repite nada.
    """
    if instance.type != DocumentType.INSURANCE or instance.expiry_date is None:
        return
    # Un documento personal (de usuario) no tiene vehículo que denormalizar.
    if instance.vehicle_id is None:
        return
    insurance.apply_new_expiry(
        instance.vehicle,
        instance.expiry_date,
        actor=instance.uploaded_by,
        notes=f"Póliza subida (documento #{instance.pk}).",
        source="document",
    )


@receiver(post_save, sender=Incident, dispatch_uid="fleet_accident_report_materialized")
def on_incident_saved(sender, instance: Incident, **kwargs):
    """El parte de accidente del JSON `details` se materializa en sus tablas.

    Idempotente y para TODOS los caminos de escritura (PWA, gestión, admin):
    ver `services/accidents.py`. Para el resto de incidencias no hace nada.

    R3-39: un save que NO toca `details` (los `update_fields` del ciclo
    `report`/`manage`, R3-09) no re-materializa: antes cada gesto de gestión
    borraba y re-insertaba TODOS los terceros y lesionados, cambiándoles el pk.
    Un save completo (create, serializer, admin) sigue sincronizando.
    """
    update_fields = kwargs.get("update_fields")
    if update_fields is not None and "details" not in update_fields:
        return
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
