"""El precio del km de exceso pasa a CINCO decimales y el catálogo de
combustibles gana «Gasolina - Híbrido enchufable (PHEV)».

- `Contract.penalty_per_km`: los contratos de renting lo traen con cinco
  decimales («0,07250 €/km») y con tres se redondeaba al guardarlo. Ampliar la
  escala no toca los valores que ya hay.
- `FuelType`: el tipo nuevo se da de alta aquí para que exista en todos los
  despliegues sin pasar por Ajustes → Catálogos. Si ya está (con otras
  mayúsculas, o dado de baja), no se duplica: el nombre es único sin distinguir
  mayúsculas, y uno retirado a propósito no se resucita.
"""

from django.db import migrations, models

PHEV = "Gasolina - Híbrido enchufable (PHEV)"


def add_phev(apps, schema_editor):
    FuelType = apps.get_model("fleet", "FuelType")
    if not FuelType.objects.filter(name__iexact=PHEV).exists():
        FuelType.objects.create(name=PHEV)


def noop(apps, schema_editor):
    """No se borra al deshacer: puede tener ya vehículos colgando."""


class Migration(migrations.Migration):
    dependencies = [
        ("fleet", "0101_readingchange_cancelled"),
    ]

    operations = [
        migrations.AlterField(
            model_name="contract",
            name="penalty_per_km",
            field=models.DecimalField(
                blank=True,
                decimal_places=5,
                help_text="€ por km de exceso sobre los contratados, con los cinco "
                "decimales del contrato; alimenta la penalización estimada de la "
                "proyección (HU-3.4).",
                max_digits=8,
                null=True,
                verbose_name="Penalización por km (€)",
            ),
        ),
        migrations.RunPython(add_phev, noop),
    ]
