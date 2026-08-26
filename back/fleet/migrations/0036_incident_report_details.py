# Generated manually: structured driver incident reports.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("fleet", "0035_notification_content_vehicles"),
    ]

    operations = [
        migrations.AddField(
            model_name="incident",
            name="details",
            field=models.JSONField(
                blank=True,
                default=dict,
                help_text="Campos estructurados específicos de neumáticos, avería o accidente.",
                verbose_name="Datos del parte",
            ),
        ),
        migrations.AddField(
            model_name="incident",
            name="mileage",
            field=models.PositiveIntegerField(blank=True, null=True, verbose_name="Kilometraje"),
        ),
        migrations.AddField(
            model_name="incident",
            name="workshop_postal_code",
            field=models.CharField(blank=True, max_length=12, verbose_name="CP del taller"),
        ),
    ]
