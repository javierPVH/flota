"""Informes y exportación de flota (Épica 10) — Excel/CSV.

Genera informes **re-consultando** la BD (no se limita a lo que el front tenga
cargado) y **respetando el ámbito por rol** (`vehicles_for`): el admin exporta
toda la flota, el supervisor solo su grupo. Cada informe es una o varias tablas
`(título, cabeceras, filas)` que se serializan a XLSX multi-hoja o a CSV.

Patrón tomado de `travel_expenses/gastos/informes/services_reports_export.py`,
simplificado para el dominio de flota.
"""

from __future__ import annotations

import csv
import io
import zipfile
from datetime import date

from openpyxl import Workbook
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter

from fleet.models import Alert, Assignment, Invoice
from fleet.models.enums import AlertStatus, AssignmentStatus
from fleet.scoping import vehicles_for

XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

REPORT_KINDS = ("fleet", "alerts", "costs")
FORMATS = ("xlsx", "csv")

# Una tabla exportable: título de hoja/fichero, cabeceras y filas (valores str).
Table = tuple[str, list[str], list[list]]


# --- Helpers de formato ---------------------------------------------------


def _name(user) -> str:
    if not user:
        return ""
    return user.get_full_name() or user.get_username()


def _d(value: date | None) -> str:
    return value.isoformat() if value else ""


def _current_driver_name(vehicle) -> str:
    assignment = (
        Assignment.objects.filter(
            vehicle=vehicle, end_date__isnull=True, status=AssignmentStatus.ACCEPTED
        )
        .select_related("driver")
        .first()
    )
    return _name(assignment.driver) if assignment else ""


# --- Construcción de cada informe -----------------------------------------


def _fleet_table(user) -> Table:
    vehicles = vehicles_for(user).select_related("supervisor").order_by("plate")
    headers = [
        "Matrícula",
        "Marca",
        "Modelo",
        "Estado",
        "Supervisor",
        "Uso",
        "Próxima ITV",
        "Conductor actual",
    ]
    rows = [
        [
            v.plate,
            v.brand,
            v.model,
            v.get_state_display(),
            _name(v.supervisor),
            v.get_business_use_display(),
            _d(v.next_itv_date),
            _current_driver_name(v),
        ]
        for v in vehicles
    ]
    return ("Flota", headers, rows)


def _alerts_table(user) -> Table:
    vehicle_ids = vehicles_for(user).values_list("id", flat=True)
    alerts = (
        Alert.objects.filter(status=AlertStatus.OPEN, vehicle_id__in=vehicle_ids)
        .select_related("vehicle")
        .order_by("-created_at")
    )
    headers = ["Vehículo", "Tipo", "Nivel", "Mensaje", "Fecha límite", "Creada"]
    rows = [
        [
            a.vehicle.plate if a.vehicle_id else "",
            a.get_type_display(),
            a.get_level_display(),
            a.message,
            _d(a.due_date),
            _d(a.created_at.date()),
        ]
        for a in alerts
    ]
    return ("Alertas abiertas", headers, rows)


def _costs_table(user) -> Table:
    vehicle_ids = vehicles_for(user).values_list("id", flat=True)
    invoices = (
        Invoice.objects.filter(vehicle_id__in=vehicle_ids)
        .select_related("vehicle")
        .order_by("-date")
    )
    headers = ["Vehículo", "Código", "Fecha", "Importe"]
    rows = [
        [inv.vehicle.plate if inv.vehicle_id else "", inv.code, _d(inv.date), inv.amount]
        for inv in invoices
    ]
    return ("Costes", headers, rows)


_BUILDERS = {
    "fleet": _fleet_table,
    "alerts": _alerts_table,
    "costs": _costs_table,
}


def build_report(kind: str, user) -> list[Table]:
    """Devuelve las tablas del informe `kind` acotadas al ámbito de `user`."""
    try:
        return [_BUILDERS[kind](user)]
    except KeyError as exc:
        raise ValueError(f"Informe desconocido: {kind}.") from exc


# --- Serialización --------------------------------------------------------


def _autosize(ws, headers, rows) -> None:
    for col, header in enumerate(headers, start=1):
        width = len(str(header))
        for row in rows:
            width = max(width, len(str(row[col - 1])))
        ws.column_dimensions[get_column_letter(col)].width = min(width + 2, 50)


def to_xlsx(tables: list[Table]) -> bytes:
    wb = Workbook()
    wb.remove(wb.active)
    for title, headers, rows in tables:
        ws = wb.create_sheet(title[:31])
        ws.append(headers)
        for cell in ws[1]:
            cell.font = Font(bold=True)
        for row in rows:
            ws.append(row)
        ws.freeze_panes = "A2"
        _autosize(ws, headers, rows)
    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def _table_to_csv(table: Table) -> str:
    _, headers, rows = table
    sio = io.StringIO()
    writer = csv.writer(sio)
    writer.writerow(headers)
    writer.writerows(rows)
    return sio.getvalue()


def to_csv_zip(tables: list[Table]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for table in tables:
            zf.writestr(f"{table[0]}.csv", _table_to_csv(table))
    return buffer.getvalue()


def render(kind: str, user, fmt: str) -> tuple[str, str, bytes]:
    """Devuelve `(filename, content_type, payload)` del informe pedido."""
    if fmt not in FORMATS:
        raise ValueError(f"Formato no soportado: {fmt}.")
    tables = build_report(kind, user)
    if fmt == "xlsx":
        return f"informe_{kind}.xlsx", XLSX_CONTENT_TYPE, to_xlsx(tables)
    if len(tables) == 1:
        # BOM (utf-8-sig) para que Excel abra bien los acentos.
        payload = _table_to_csv(tables[0]).encode("utf-8-sig")
        return f"informe_{kind}.csv", "text/csv", payload
    return f"informe_{kind}.zip", "application/zip", to_csv_zip(tables)
