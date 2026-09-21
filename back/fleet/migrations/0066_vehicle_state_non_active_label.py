"""«No activo» pasa a llamarse «No activo sin justificación».

Solo etiqueta: el valor guardado (`non_active`) no se toca, así que no hay
datos que migrar — es la migración de `choices` que Django exige para que el
estado del modelo coincida con el del fichero. El nombre lo pide el filtro de
la app de campo, donde «No activos» es el corte que agrupa a TODOS los coches
parados: llamar igual a ese corte y al estado de los que están parados sin una
causa con estado propio los hacía indistinguibles.
"""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("fleet", "0065_documentdeletionrequest"),
    ]

    operations = [
        migrations.AlterField(
            model_name="vehicle",
            name="state",
            field=models.CharField(
                blank=True,
                choices=[
                    ("active", "Activo"),
                    ("maintenance", "No activo - Mantenimiento"),
                    ("itv", "No activo - ITV"),
                    ("broken", "No activo - Averiado"),
                    ("accidente", "No activo - Accidentado"),
                    ("non_active", "No activo sin justificación"),
                    ("retired", "Devuelto (baja)"),
                ],
                max_length=20,
                verbose_name="Estado",
            ),
        ),
    ]
