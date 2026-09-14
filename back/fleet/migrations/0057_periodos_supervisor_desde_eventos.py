"""Convierte el histórico de supervisores (eventos) en periodos con fechas.

Hasta ahora «quién supervisó el coche y cuándo» solo existía como una lista de
**cambios** (`EventSupervisorChange`): cada evento dice de quién a quién, y el
periodo había que reconstruirlo en el front. Con `SupervisorPeriod` los tramos
son datos, así que se pueden corregir y validar (uno a la vez por coche).

Esta migración los deriva: cada cambio cierra el tramo anterior y abre el
siguiente. Lo que no consta en ningún evento es **cuándo empezó el primero**;
ahí se toma el alta del vehículo, que es lo más temprano que se sabe.
"""

from django.db import migrations


def crear_periodos(apps, schema_editor):
    Vehicle = apps.get_model("fleet", "Vehicle")
    Cambio = apps.get_model("fleet", "EventSupervisorChange")
    SupervisorPeriod = apps.get_model("fleet", "SupervisorPeriod")

    filas = []
    for vehicle in Vehicle.objects.all().iterator():
        cambios = list(
            Cambio.objects.filter(event__vehicle=vehicle)
            .select_related("event")
            .order_by("event__event_date", "event_id")
        )
        if not cambios and vehicle.supervisor_id is None:
            continue

        alta = vehicle.created_at.date()
        tramos = []  # (supervisor_id, inicio, fin)
        abierto = None  # (supervisor_id, inicio)

        if cambios and cambios[0].old_supervisor_id:
            # Había alguien antes del primer relevo: no consta desde cuándo.
            abierto = (cambios[0].old_supervisor_id, alta)

        for cambio in cambios:
            fecha = cambio.event.event_date
            if abierto is not None:
                sid, inicio = abierto
                if fecha > inicio:
                    tramos.append((sid, inicio, fecha))
                abierto = None
            if cambio.new_supervisor_id:
                abierto = (cambio.new_supervisor_id, fecha)

        vigente = vehicle.supervisor_id
        if abierto is not None:
            sid, inicio = abierto
            if sid == vigente:
                tramos.append((sid, inicio, None))
                vigente = None
            else:
                # El último relevo y el supervisor de la ficha no coinciden:
                # manda la ficha, así que el tramo derivado se cierra en el
                # alta del vigente (lo más tarde que se puede afirmar).
                fin = vehicle.updated_at.date()
                if fin > inicio:
                    tramos.append((sid, inicio, fin))
        if vigente:
            inicio = tramos[-1][2] if tramos and tramos[-1][2] else alta
            tramos.append((vigente, inicio, None))

        for supervisor_id, inicio, fin in tramos:
            filas.append(
                SupervisorPeriod(
                    vehicle_id=vehicle.pk,
                    supervisor_id=supervisor_id,
                    start_date=inicio,
                    end_date=fin,
                    is_active=True,
                )
            )

    SupervisorPeriod.objects.bulk_create(filas, batch_size=500)


def borrar_periodos(apps, schema_editor):
    apps.get_model("fleet", "SupervisorPeriod").objects.all().delete()


class Migration(migrations.Migration):
    dependencies = [("fleet", "0056_supervisorperiod")]

    operations = [migrations.RunPython(crear_periodos, borrar_periodos)]
