# GAP-2: «Consumo» deja de ser la serie MENSUAL de litros (con importe y
# origen) y pasa a ser la ANOTACIÓN del consumo medio que marca el ordenador de
# a bordo en una fecha con día. Las filas antiguas no miden consumo —eran litros
# del extracto de la tarjeta—, así que se DESACTIVAN (N7: nada se borra) y
# quedan en erratas; las columnas se renombran para conservarlas.

from django.db import migrations, models
from django.utils import timezone

RETIRADA = (
    "La serie mensual de litros se retiró: el consumo pasa a anotarse como consumo "
    "medio del ordenador de a bordo (l/km o kWh/km) con fecha."
)


def deactivate_monthly_rows(apps, schema_editor):
    FuelConsumption = apps.get_model("fleet", "FuelConsumption")
    FuelConsumption.objects.filter(is_active=True).update(
        is_active=False, deactivated_at=timezone.now(), deactivation_reason=RETIRADA
    )


class Migration(migrations.Migration):
    dependencies = [
        ("fleet", "0059_document_drive_missing_at"),
    ]

    operations = [
        migrations.RunPython(deactivate_monthly_rows, migrations.RunPython.noop),
        migrations.RemoveConstraint(
            model_name="fuelconsumption",
            name="uniq_fuel_consumption_month",
        ),
        migrations.RemoveField(model_name="fuelconsumption", name="amount"),
        migrations.RemoveField(model_name="fuelconsumption", name="source"),
        migrations.RenameField(
            model_name="fuelconsumption", old_name="period", new_name="reading_date"
        ),
        migrations.RenameField(
            model_name="fuelconsumption", old_name="liters", new_name="avg_consumption"
        ),
        migrations.AlterField(
            model_name="fuelconsumption",
            name="reading_date",
            field=models.DateField(verbose_name="Fecha"),
        ),
        migrations.AlterField(
            model_name="fuelconsumption",
            name="avg_consumption",
            field=models.DecimalField(
                decimal_places=2,
                help_text=(
                    "El del último trayecto o ciclo de repostaje que marca el ordenador de a "
                    "bordo, no el histórico acumulado del vehículo."
                ),
                max_digits=8,
                verbose_name="Consumo medio real (l/km o kWh/km)",
            ),
        ),
        migrations.AlterModelOptions(
            name="fuelconsumption",
            options={
                "ordering": ["-reading_date", "-pk"],
                "verbose_name": "consumo medio",
                "verbose_name_plural": "consumos medios",
            },
        ),
        migrations.AddIndex(
            model_name="fuelconsumption",
            index=models.Index(
                fields=["vehicle", "-reading_date"], name="fleet_fuelc_vehicle_f7ce30_idx"
            ),
        ),
    ]
