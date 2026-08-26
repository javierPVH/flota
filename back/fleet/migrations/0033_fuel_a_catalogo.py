"""GAP-1: el combustible pasa del enum de 5 valores al catálogo `FuelType`.

Los valores legados (`gasoline`, `diesel`, `LPG`, `hybrid`, `other`) se
convierten en entradas del catálogo con su etiqueta en castellano, se enlaza la
FK `fuel_ref` y el texto denormalizado pasa a ser el nombre legible — a partir
de aquí `Vehicle.fuel` funciona como `Vehicle.brand`: texto que se rellena
desde el catálogo.
"""

from django.db import migrations

#: Valor del enum retirado → nombre en el catálogo (su antigua etiqueta).
LEGACY = {
    "gasoline": "Gasolina",
    "diesel": "Diésel",
    "LPG": "GLP",
    "hybrid": "Híbrido",
    "other": "Otro",
}


def enum_a_catalogo(apps, schema_editor):
    FuelType = apps.get_model("fleet", "FuelType")
    Vehicle = apps.get_model("fleet", "Vehicle")
    # Solo se catalogan los combustibles EN USO: en una BD recien creada (o de
    # tests) esta migracion no deja filas, el catalogo lo puebla quien toque.
    tipos: dict[str, object] = {}
    for vehicle in Vehicle.objects.exclude(fuel="").filter(fuel_ref__isnull=True):
        tipo = tipos.get(vehicle.fuel)
        if tipo is None and vehicle.fuel in LEGACY:
            tipo, _ = FuelType.objects.get_or_create(name=LEGACY[vehicle.fuel])
            tipos[vehicle.fuel] = tipo
        if tipo is None:
            # Un valor fuera del enum solo pudo entrar a mano: se cataloga igual
            # para no dejar texto huérfano.
            tipo, _ = FuelType.objects.get_or_create(name=vehicle.fuel)
            tipos[vehicle.fuel] = tipo
        vehicle.fuel_ref = tipo
        vehicle.fuel = tipo.name
        vehicle.save(update_fields=["fuel_ref", "fuel"])


def catalogo_a_enum(apps, schema_editor):
    """Marcha atrás: se recuperan los valores del enum donde se conocen."""
    Vehicle = apps.get_model("fleet", "Vehicle")
    inverso = {name: value for value, name in LEGACY.items()}
    for vehicle in Vehicle.objects.exclude(fuel=""):
        vehicle.fuel = inverso.get(vehicle.fuel, "other")
        vehicle.fuel_ref = None
        vehicle.save(update_fields=["fuel_ref", "fuel"])


class Migration(migrations.Migration):
    dependencies = [
        ("fleet", "0032_gap_hse_modelos"),
    ]

    operations = [
        migrations.RunPython(enum_a_catalogo, catalogo_a_enum),
    ]
