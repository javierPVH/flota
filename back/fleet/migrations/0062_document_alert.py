# El informe de una ITV PROGRAMADA (la cita es la alerta `itv_due`) que aún no
# se ha registrado acompaña a esa alerta; al registrar la ITV pasa al registro.

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("fleet", "0061_document_event"),
    ]

    operations = [
        migrations.AddField(
            model_name="document",
            name="alert",
            field=models.ForeignKey(
                blank=True,
                help_text=(
                    "Alerta abierta a la que acompaña el documento: el informe de una ITV "
                    "programada (`itv_due`) que aún no se ha registrado. Al registrarla, el "
                    "informe pasa al registro de la ITV (`event`). Excluyente con incidencia y "
                    "registro."
                ),
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="documents",
                to="fleet.alert",
                verbose_name="Alerta",
            ),
        ),
    ]
