# Un documento puede acompañar a un REGISTRO del coche (evento): el informe de
# ITV a su ITV, la póliza a la renovación del seguro, la factura del taller a
# la ITV o al mantenimiento. Hasta ahora solo se ligaba a incidencias.

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("fleet", "0060_fuel_consumption_avg_reading"),
    ]

    operations = [
        migrations.AddField(
            model_name="document",
            name="event",
            field=models.ForeignKey(
                blank=True,
                help_text=(
                    "Registro del vehículo al que acompaña el documento: la ITV del informe, "
                    "la renovación de seguro de la póliza o la ITV/mantenimiento de la factura "
                    "(`EVENT_LINKABLE_DOCUMENT_TYPES`). Solo con titular coche y sin incidencia "
                    "a la vez."
                ),
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="documents",
                to="fleet.event",
                verbose_name="Registro",
            ),
        ),
    ]
