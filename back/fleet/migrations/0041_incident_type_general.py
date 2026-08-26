# Tipo de incidencia «General»: solicitudes desde la app de campo que quizá no
# tienen que ver con el vehículo. Solo cambia los choices (metadato, sin SQL).
#
# NOTA: escrita a mano para no arrastrar los modelos de accidente que otra
# rama tiene a medias (AccidentReport y compañía generarán su propia migración).

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("fleet", "0040_workshop"),
    ]

    operations = [
        migrations.AlterField(
            model_name="incident",
            name="type",
            field=models.CharField(
                choices=[
                    ("breakdown", "Avería"),
                    ("maintenance", "Mantenimiento"),
                    ("tires", "Neumáticos"),
                    ("inspection", "ITV"),
                    ("accident", "Accidente"),
                    ("general", "General"),
                ],
                max_length=20,
                verbose_name="Tipo",
            ),
        ),
    ]
