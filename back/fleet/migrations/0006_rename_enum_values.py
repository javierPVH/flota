"""Renombra los valores de varios enums a inglés (RGRS: unificación de idioma).

Solo remapea DATOS ya almacenados. Los cambios de `choices` y del constraint
parcial de `Assignment` (cuya condición pasa de status='aceptada' a 'accepted')
los captura `makemigrations` en una migración posterior:

    python manage.py makemigrations fleet
    python manage.py migrate

Nota: `fuel` colapsa 26 valores en 5 (gasoline/diesel/LPG/hybrid/other); es una
conversión con pérdida y su reverso NO restaura el valor original.
"""

from django.db import migrations

# modelo -> campo -> {valor_antiguo: valor_nuevo}
RENAMES = {
    "Vehicle": {
        "state": {"baja": "retired"},
        "type": {"turismo": "car", "furgoneta": "van", "camion": "truck", "motocicleta": "motorcycle"},
        "size": {"pequeno": "small", "mediano": "medium", "grande": "big"},
        "market_segment": {
            "mediano_inferior": "med_low", "mediano_superior": "med_sup",
            "ejecutivo": "executive", "lujo": "luxury", "deportivo": "sports", "4x4_dual": "suv",
        },
        "veh_use": {"pasajeros": "passengers", "mercancia": "freight"},
        "fuel": {
            "Gasoline_E5": "gasoline", "Gasoline_E10": "gasoline",
            "Gasoline_E85": "gasoline", "Gasoline_E100": "gasoline",
            "Diesel_B": "diesel", "Diesel_B7": "diesel", "Diesel_B10": "diesel",
            "Diesel_B20": "diesel", "Diesel_B30": "diesel", "Gasoleo_marino": "diesel",
            "LPG": "LPG", "GLP": "LPG",
            "Vehiculo_hibrido_enchufable": "hybrid",
            "CNG": "other", "Biogas": "other", "Biometano": "other", "Biometanol": "other",
            "Biopropano": "other", "Vehiculo_electrico_bateria": "other", "B100": "other",
            "Nafta": "other", "Fueloleo": "other", "Queroseno": "other",
            "Gasolina_aviacion": "other", "Queroseno_aviacion_renovable": "other", "Adblue": "other",
        },
    },
    "Assignment": {"status": {"propuesta": "proposed", "aceptada": "accepted", "rechazada": "rejected", "finalizada": "finished"}},
    "VehicleLink": {"reason": {"averia": "breakdown", "mantenimiento": "maintenance", "itv": "inspection", "accidente": "accident"}},
    "Incident": {
        "type": {"averia": "breakdown", "mantenimiento": "maintenance", "accidente": "accident", "itv": "inspection"},
        "status": {"abierta": "open", "en_curso": "on_going", "cerrada": "closed"},
    },
    "Document": {
        "type": {
            "permiso_circulacion": "registration_certificate", "ficha_tecnica": "technical_datasheet",
            "seguro": "insurance", "contrato": "contract", "acta_entrega": "delivery_report",
            "acta_devolucion": "return_report", "parte_accidente": "accident_report",
            "fotos_danos": "damage_photos", "otro": "other",
        },
        "status": {"vigente": "valid", "caducado": "expired", "pendiente_archivar": "pending_archive"},
    },
    "VehicleRequest": {"requested_type": {"turismo": "car", "furgoneta": "van", "camion": "truck", "motocicleta": "motorcycle"}},
}


def _apply(apps, mapping):
    for model_name, fields in mapping.items():
        Model = apps.get_model("fleet", model_name)
        for field, remap in fields.items():
            for old, new in remap.items():
                Model.objects.filter(**{field: old}).update(**{field: new})


def forwards(apps, schema_editor):
    _apply(apps, RENAMES)


def backwards(apps, schema_editor):
    inverse = {}
    for model_name, fields in RENAMES.items():
        inverse[model_name] = {}
        for field, remap in fields.items():
            if model_name == "Vehicle" and field == "fuel":
                continue  # colapso con pérdida: no se puede restaurar
            inverse[model_name][field] = {new: old for old, new in remap.items()}
    _apply(apps, inverse)


class Migration(migrations.Migration):
    dependencies = [("fleet", "0005_assignment_fleet_assig_vehicle_38115c_idx_and_more")]
    operations = [migrations.RunPython(forwards, backwards)]
