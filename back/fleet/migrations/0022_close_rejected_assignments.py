"""C1 — cierra las asignaciones RECHAZADAS que quedaron con `end_date=NULL`.

Una propuesta rechazada sin fecha de fin seguía contando como "en curso" para
`scoping.vehicles_for`, de modo que el conductor conservaba acceso de lectura al
vehículo (y a sus documentos, facturas, incidencias y eventos) indefinidamente.
El código ya cierra el rechazo al vuelo (`AssignmentViewSet.reject`); esta
migración arregla el histórico.

Reversible: volver a poner `end_date=NULL` en las rechazadas reabriría el
agujero, así que la inversa es un no-op explícito.
"""

from django.db import migrations


def close_rejected(apps, schema_editor):
    Assignment = apps.get_model("fleet", "Assignment")
    pending = Assignment.objects.filter(status="rejected", end_date__isnull=True)
    for assignment in pending.iterator():
        # Nunca anterior al inicio propuesto; si no hay inicio, la fecha de alta.
        assignment.end_date = assignment.start_date or assignment.created_at.date()
        assignment.save(update_fields=["end_date"])


def noop(apps, schema_editor):
    """Sin marcha atrás: reabrir las rechazadas restauraría el fallo de ámbito."""


class Migration(migrations.Migration):
    dependencies = [
        ("fleet", "0021_emailtemplate_english_version"),
    ]

    operations = [
        migrations.RunPython(close_rejected, noop),
    ]
