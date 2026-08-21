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

from django.contrib.auth import get_user_model
from django.db.models import Count, Q, Sum
from openpyxl import Workbook
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter

from fleet.models import Alert, Assignment, Document, Invoice, KmReading
from fleet.models.enums import AlertStatus, AssignmentStatus, VehicleState
from fleet.scoping import vehicles_for
from fleet.selectors import current_driver_map

XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

#: Los mismos informes que ofrece la pantalla de Informes, con sus claves.
REPORT_KINDS = ("fleet", "kmreadings", "documents", "alerts", "invoices", "costs", "users")

#: Filtros que admite cada informe (los de su tarjeta en Informes). Sirven para
#: validar lo que llega de un envío programado y para pintar su formulario.
REPORT_FILTERS: dict[str, tuple[str, ...]] = {
    "fleet": ("state", "brand"),
    "kmreadings": ("vehicle",),
    "documents": ("vehicle", "type", "status"),
    "alerts": ("status", "level"),
    "invoices": ("vehicle",),
    "costs": ("vehicle", "brand"),
    "users": ("role",),
}
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


# --- Construcción de cada informe -----------------------------------------
#
# Un informe por cada bloque de la pantalla de Informes, con SUS MISMOS filtros
# y columnas: lo que se programa en Ajustes → Notificaciones tiene que coincidir
# con lo que se descarga a mano, o serían dos verdades distintas.
#
# Los filtros llegan como dict de cadenas (vienen de un formulario) y se aplican
# solo si traen valor: vacío = sin filtrar, igual que en la pantalla.


def _pick(filters: dict | None, key: str) -> str:
    return str((filters or {}).get(key) or "").strip()


def _fleet_table(user, filters: dict | None = None) -> Table:
    # M2: fuera los vehículos de BAJA, como en el dashboard y en los
    # summaries. El informe los incluía, así que sus cifras no cuadraban
    # con las de la pantalla desde la que se descarga.
    vehicles = (
        vehicles_for(user)
        .exclude(state=VehicleState.BAJA)
        .select_related("supervisor")
        .order_by("plate")
    )
    state = _pick(filters, "state")
    if state:
        vehicles = vehicles.filter(state=state)
    brand = _pick(filters, "brand")
    if brand:
        vehicles = vehicles.filter(brand__iexact=brand)
    vehicles = list(vehicles)

    # Conductores en curso en UNA query (evita N+1 al pintar la columna).
    drivers = current_driver_map([v.id for v in vehicles])
    headers = [
        "Matrícula",
        "Marca y modelo",
        "Estado",
        "Conductor actual",
        "Supervisor",
        "Próxima ITV",
    ]
    rows = [
        [
            v.plate,
            f"{v.brand} {v.model}".strip(),
            v.get_state_display(),
            _name(drivers.get(v.id)),
            _name(v.supervisor),
            _d(v.next_itv_date),
        ]
        for v in vehicles
    ]
    return ("Flota", headers, rows)


def _km_table(user, filters: dict | None = None) -> Table:
    readings = (
        KmReading.objects.filter(vehicle_id__in=vehicles_for(user).values("id"), is_active=True)
        .select_related("vehicle")
        .order_by("-reading_date", "-id")
    )
    vehicle = _pick(filters, "vehicle")
    if vehicle:
        readings = readings.filter(vehicle_id=vehicle)
    headers = ["Vehículo", "Fecha", "Kilómetros", "Estimada"]
    rows = [
        [
            r.vehicle.plate if r.vehicle_id else "",
            _d(r.reading_date),
            r.km_reading if r.km_reading is not None else "",
            "Sí" if r.estimated else "No",
        ]
        for r in readings
    ]
    return ("Kilometraje", headers, rows)


def _documents_table(user, filters: dict | None = None) -> Table:
    documents = (
        Document.objects.filter(vehicle_id__in=vehicles_for(user).values("id"), is_active=True)
        .select_related("vehicle", "uploaded_by")
        .order_by("-created_at")
    )
    for campo, valor in (
        ("vehicle_id", _pick(filters, "vehicle")),
        ("type", _pick(filters, "type")),
        ("status", _pick(filters, "status")),
    ):
        if valor:
            documents = documents.filter(**{campo: valor})
    headers = ["Vehículo", "Tipo", "Subido", "Por", "Caducidad", "Estado"]
    rows = [
        [
            d.vehicle.plate if d.vehicle_id else "",
            d.get_type_display(),
            _d(d.created_at.date()),
            _name(d.uploaded_by),
            _d(d.expiry_date),
            d.get_status_display(),
        ]
        for d in documents
    ]
    return ("Documentos", headers, rows)


def _alerts_table(user, filters: dict | None = None) -> Table:
    alerts = (
        Alert.objects.filter(vehicle_id__in=vehicles_for(user).values("id"))
        .select_related("vehicle")
        .order_by("-created_at")
    )
    # Sin filtro salen todas, como en la pantalla de Informes. Antes este
    # informe forzaba `status=open`, así que no coincidía con la descarga.
    estado = _pick(filters, "status")
    if estado:
        alerts = alerts.filter(status=estado)
    level = _pick(filters, "level")
    if level:
        alerts = alerts.filter(level=level)
    headers = ["Tipo", "Nivel", "Estado", "Vehículo", "Mensaje", "Fecha"]
    rows = [
        [
            a.get_type_display(),
            a.get_level_display(),
            a.get_status_display(),
            a.vehicle.plate if a.vehicle_id else "",
            a.message,
            _d(a.created_at.date()),
        ]
        for a in alerts
    ]
    titulo = f"Alertas ({AlertStatus(estado).label})" if estado else "Alertas"
    return (titulo, headers, rows)


def _invoices_table(user, filters: dict | None = None) -> Table:
    # M2: solo facturas VIVAS. Sin el filtro, el informe sumaba las dadas de
    # baja (que están en erratas) y no cuadraba con el KPI de facturación del
    # dashboard, que sí las excluye.
    invoices = (
        Invoice.objects.filter(vehicle_id__in=vehicles_for(user).values("id"), is_active=True)
        .select_related("vehicle")
        .order_by("-date")
    )
    vehicle = _pick(filters, "vehicle")
    if vehicle:
        invoices = invoices.filter(vehicle_id=vehicle)
    headers = ["Vehículo", "Código", "Fecha", "Importe"]
    rows = [
        [inv.vehicle.plate if inv.vehicle_id else "", inv.code, _d(inv.date), inv.amount]
        for inv in invoices
    ]
    return ("Facturas", headers, rows)


def _costs_table(user, filters: dict | None = None) -> Table:
    """Facturación AGREGADA por vehículo (el bloque «Costes» de Informes)."""
    vehicles = vehicles_for(user).exclude(state=VehicleState.BAJA).order_by("plate")
    vehicle = _pick(filters, "vehicle")
    if vehicle:
        vehicles = vehicles.filter(id=vehicle)
    brand = _pick(filters, "brand")
    if brand:
        vehicles = vehicles.filter(brand__iexact=brand)
    # Recuento e importe en la misma consulta: por fila serían dos por vehículo.
    vehicles = vehicles.annotate(
        invoice_count=Count("invoices", filter=Q(invoices__is_active=True), distinct=True),
        billed=Sum("invoices__amount", filter=Q(invoices__is_active=True)),
    )
    headers = ["Vehículo", "Marca y modelo", "Nº facturas", "Facturado"]
    rows = [
        [
            v.plate,
            f"{v.brand} {v.model}".strip(),
            v.invoice_count,
            v.billed if v.billed is not None else 0,
        ]
        for v in vehicles
    ]
    return ("Costes", headers, rows)


def _users_table(user, filters: dict | None = None) -> Table:
    """Conductores y usuarios.

    Acotado igual que el resto: el admin ve a todos; un supervisor, solo a las
    personas con asignación en curso sobre SUS vehículos. Sin ese acotado, un
    informe programado sería una vía para listar toda la plantilla.
    """
    User = get_user_model()
    people = User.objects.filter(is_active=True).prefetch_related("roles").order_by("username")
    if not user.is_admin:
        conductores = (
            Assignment.objects.filter(
                vehicle_id__in=vehicles_for(user).values("id"),
                status=AssignmentStatus.ACCEPTED,
                is_active=True,
            )
            .exclude(driver__isnull=True)
            .values("driver_id")
        )
        people = people.filter(id__in=conductores)
    role = _pick(filters, "role")
    if role:
        people = people.filter(roles__role=role).distinct()
    headers = ["Nombre", "Correo", "DNI", "Roles", "Carnet"]
    rows = [
        [
            _name(p),
            p.email,
            getattr(p, "dni", "") or "",
            ", ".join(r.get_role_display() for r in p.roles.all()),
            getattr(p, "license_type", "") or "",
        ]
        for p in people
    ]
    return ("Conductores", headers, rows)


_BUILDERS = {
    "fleet": _fleet_table,
    "kmreadings": _km_table,
    "documents": _documents_table,
    "alerts": _alerts_table,
    "invoices": _invoices_table,
    "costs": _costs_table,
    "users": _users_table,
}


def build_report(kind: str, user, filters: dict | None = None) -> list[Table]:
    """Tablas del informe `kind`, acotadas al ámbito de `user` y filtradas.

    `filters` admite las claves de `REPORT_FILTERS[kind]`; las demás se ignoran.
    """
    try:
        builder = _BUILDERS[kind]
    except KeyError as exc:
        raise ValueError(f"Informe desconocido: {kind}.") from exc
    return [builder(user, filters)]


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


def safe_stem(value: str, fallback: str) -> str:
    """Nombre de fichero utilizable a partir de texto escrito por el usuario.

    Los envíos programados dejan que el usuario nombre el fichero (y le añada
    fecha u hora), así que hay que quitar lo que rompería una ruta o un adjunto.
    """
    import re

    limpio = re.sub(r"[^\w\s.\-()]", "", value or "", flags=re.UNICODE).strip()
    limpio = re.sub(r"\s+", " ", limpio)
    return limpio[:120] or fallback


def render(
    kind: str,
    user,
    fmt: str,
    filters: dict | None = None,
    stem: str | None = None,
) -> tuple[str, str, bytes]:
    """Devuelve `(filename, content_type, payload)` del informe pedido.

    `stem` permite nombrar el fichero (los envíos programados usan el nombre del
    envío, con su fecha u hora si se han pedido); por defecto, `informe_<kind>`.
    """
    if fmt not in FORMATS:
        raise ValueError(f"Formato no soportado: {fmt}.")
    tables = build_report(kind, user, filters)
    base = safe_stem(stem or "", f"informe_{kind}")
    if fmt == "xlsx":
        return f"{base}.xlsx", XLSX_CONTENT_TYPE, to_xlsx(tables)
    if len(tables) == 1:
        # BOM (utf-8-sig) para que Excel abra bien los acentos.
        payload = _table_to_csv(tables[0]).encode("utf-8-sig")
        return f"{base}.csv", "text/csv", payload
    return f"{base}.zip", "application/zip", to_csv_zip(tables)
