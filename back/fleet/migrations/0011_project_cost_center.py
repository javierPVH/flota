# Escrito a mano (sin entorno Django local); replica el patrón de las
# migraciones generadas. Verificar con `python manage.py makemigrations --check`.

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('fleet', '0010_drive_references'),
    ]

    operations = [
        # Todo proyecto imputa a un CECO (nullable por las filas legacy; la API
        # lo exige en altas — ver ProjectSerializer).
        migrations.AddField(
            model_name='project',
            name='cost_center',
            field=models.ForeignKey(
                blank=True,
                help_text='Centro de coste (PEP/CECO) al que se asocia el proyecto.',
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name='projects',
                to='fleet.pep',
                verbose_name='Centro de coste (CECO)',
            ),
        ),
    ]
