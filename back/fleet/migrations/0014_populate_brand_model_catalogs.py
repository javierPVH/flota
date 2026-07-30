"""N5 — migración de DATOS: puebla Marca/Modelo desde el texto libre.

Recorre los `Vehicle.brand`/`model` existentes, crea las entradas de catálogo
deduplicando sin distinguir mayúsculas (se conserva la grafía de la primera
aparición) y enlaza cada vehículo por `brand_ref`/`model_ref`. Los CharField
quedan como legado denormalizado. Reversible: el reverso solo desenlaza
(no borra catálogo, por si el operador ya lo ha ampliado a mano).
"""

from django.db import migrations


def populate(apps, schema_editor):
    Vehicle = apps.get_model("fleet", "Vehicle")
    Brand = apps.get_model("fleet", "Brand")
    VehicleModel = apps.get_model("fleet", "VehicleModel")

    brands: dict[str, object] = {}  # clave normalizada → Brand
    models: dict[tuple[int, str], object] = {}  # (brand_id, clave) → VehicleModel

    for vehicle in Vehicle.objects.all().only("id", "brand", "model"):
        brand_text = (vehicle.brand or "").strip()
        model_text = (vehicle.model or "").strip()
        if not brand_text:
            continue
        brand_key = brand_text.casefold()
        brand = brands.get(brand_key)
        if brand is None:
            brand = Brand.objects.filter(name__iexact=brand_text).first()
            if brand is None:
                brand = Brand.objects.create(name=brand_text)
            brands[brand_key] = brand

        model = None
        if model_text:
            model_key = (brand.id, model_text.casefold())
            model = models.get(model_key)
            if model is None:
                model = VehicleModel.objects.filter(
                    brand=brand, name__iexact=model_text
                ).first()
                if model is None:
                    model = VehicleModel.objects.create(brand=brand, name=model_text)
                models[model_key] = model

        Vehicle.objects.filter(pk=vehicle.pk).update(
            brand_ref=brand, model_ref=model
        )


def unlink(apps, schema_editor):
    Vehicle = apps.get_model("fleet", "Vehicle")
    Vehicle.objects.update(brand_ref=None, model_ref=None)


class Migration(migrations.Migration):
    dependencies = [
        ("fleet", "0013_brand_company_vehicle_brand_ref_vehicle_company_and_more"),
    ]

    operations = [
        migrations.RunPython(populate, unlink),
    ]
