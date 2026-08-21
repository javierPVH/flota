"""Las alertas ya no se descartan: o están abiertas o resueltas.

Descartar y resolver eran dos formas de silenciar el mismo aviso, y la
diferencia no se usaba para nada aguas abajo (el motor solo mira `OPEN`). Las
que estaban descartadas pasan a resueltas: la decisión de cerrarlas se tomó y
`resolved_at`/`resolved_by` ya la tienen registrada.
"""

from django.db import migrations, models


def dismissed_to_resolved(apps, schema_editor):
    """Reetiqueta las descartadas como resueltas conservando actor y momento."""
    Alert = apps.get_model("fleet", "Alert")
    Alert.objects.filter(status="dismissed").update(status="resolved")


def noop_reverse(apps, schema_editor):
    """Sin marcha atrás: qué alertas fueron descartadas ya no se puede saber."""


class Migration(migrations.Migration):
    dependencies = [
        ("fleet", "0026_remove_vehiclemodel_uniq_model_per_brand_and_more"),
    ]

    operations = [
        migrations.RunPython(dismissed_to_resolved, noop_reverse),
        migrations.AlterField(
            model_name="alert",
            name="status",
            field=models.CharField(
                choices=[("open", "Abierta"), ("resolved", "Resuelta")],
                default="open",
                max_length=15,
                verbose_name="Estado",
            ),
        ),
    ]
