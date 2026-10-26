"""Limpia las copias del DNI que viven fuera de su columna.

El DNI se retira del sistema por minimización (art. 5.1.c del RGPD): ya no es
un dato que haya que reflejar. Quitar la columna —`accounts/0008`, que depende
de esta— no basta, porque el dato se había copiado a otros tres sitios y ahí se
quedaría:

1. **`ProfileChangeRequest.changes`.** Pedir la corrección de la ficha desde la
   app de campo escribía `{"dni": "…"}` en claro en este JSON, y resolver la
   petición **no lo limpiaba**: el rastro se conserva a propósito, así que el
   DNI se quedaba para siempre. Si el diccionario se queda vacío, la fila SE
   CONSERVA: sigue contando que esa persona pidió algo y quién lo decidió.

2. **El histórico de auditoría** (`auditlog.LogEntry` del modelo `User`).
   Estaba enmascarado, pero `auditlog.diff.mask_str` tapa **solo la primera
   mitad** del valor (`"*" * (len/2) + resto`), así que de `12345678Z` quedaban
   guardados los cuatro últimos dígitos y la letra —que además se deriva del
   número—. Medio DNI sigue identificando a una persona. Las entradas que se
   queden **sin ningún campo** se borran: no registraban más que el cambio de
   un campo que ya no existe, y una entrada vacía no se pinta en ninguna
   pantalla (el front necesita al menos un campo con etiqueta para dibujarla).

3. **El rastro de exportaciones** (`ReportExport`). Sus `columns` podían listar
   `"dni"`, y `filters` guarda el texto de búsqueda — el buscador de personas
   buscaba por DNI. Ahí se mira **la forma** del texto: se vacía solo si parece
   un DNI o un NIE. Un filtro de búsqueda es texto libre, así que borrarlo
   entero destruiría rastro que no es un DNI, y dejarlo tal cual conservaría el
   que sí lo es.

**Irreversible a propósito**: lo que esto borra no se puede devolver, así que
el `reverse` es un no-op y no finge lo contrario.
"""

import re

from django.db import migrations

#: DNI (8 cifras + letra) y NIE (X/Y/Z + 7 cifras + letra).
_PARECE_DNI = re.compile(r"^(?:[0-9]{8}|[XYZxyz][0-9]{7})[A-Za-z]$")


def _limpiar_peticiones(apps, schema_editor):
    ProfileChangeRequest = apps.get_model("fleet", "ProfileChangeRequest")
    pendientes = []
    for fila in ProfileChangeRequest.objects.all().iterator():
        cambios = fila.changes or {}
        if isinstance(cambios, dict) and "dni" in cambios:
            cambios.pop("dni")
            fila.changes = cambios
            pendientes.append(fila)
    if pendientes:
        ProfileChangeRequest.objects.bulk_update(pendientes, ["changes"])


def _limpiar_auditoria(apps, schema_editor):
    # La app puede no estar instalada en un despliegue recortado: si no está,
    # no hay nada que limpiar y la migración no debe reventar por ello.
    try:
        LogEntry = apps.get_model("auditlog", "LogEntry")
    except LookupError:
        return
    ContentType = apps.get_model("contenttypes", "ContentType")
    tipo = ContentType.objects.filter(app_label="accounts", model="user").first()
    if tipo is None:
        return

    actualizar, borrar = [], []
    for fila in LogEntry.objects.filter(content_type_id=tipo.pk).iterator():
        cambios = fila.changes or {}
        if not isinstance(cambios, dict) or "dni" not in cambios:
            continue
        cambios.pop("dni")
        if cambios:
            fila.changes = cambios
            actualizar.append(fila)
        else:
            borrar.append(fila.pk)
    if actualizar:
        LogEntry.objects.bulk_update(actualizar, ["changes"])
    if borrar:
        LogEntry.objects.filter(pk__in=borrar).delete()


def _limpiar_exportaciones(apps, schema_editor):
    ReportExport = apps.get_model("fleet", "ReportExport")
    pendientes = []
    for fila in ReportExport.objects.all().iterator():
        tocada = False

        columnas = fila.columns or []
        if isinstance(columnas, list) and "dni" in columnas:
            fila.columns = [c for c in columnas if c != "dni"]
            tocada = True

        filtros = fila.filters or {}
        if isinstance(filtros, dict):
            buscado = str(filtros.get("search") or "").strip()
            if buscado and _PARECE_DNI.match(buscado):
                filtros["search"] = ""
                fila.filters = filtros
                tocada = True

        if tocada:
            pendientes.append(fila)
    if pendientes:
        ReportExport.objects.bulk_update(pendientes, ["columns", "filters"])


def limpiar(apps, schema_editor):
    _limpiar_peticiones(apps, schema_editor)
    _limpiar_auditoria(apps, schema_editor)
    _limpiar_exportaciones(apps, schema_editor)


class Migration(migrations.Migration):
    dependencies = [
        ("fleet", "0076_rastro_exportaciones"),
        ("contenttypes", "0002_remove_content_type_name"),
    ]

    operations = [
        migrations.RunPython(limpiar, migrations.RunPython.noop),
    ]
