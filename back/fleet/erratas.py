"""N7 — Espacio de erratas: inventario de registros desactivados.

Un registro desactivado (destroy → deactivate) se considera una errata o un
error. Aquí la administración lo ve (quién/cuándo/por qué), puede RESTAURARLO,
y SOLO el superusuario (el `admin` de `bootstrap_admin`, único por diseño)
puede ELIMINARLO definitivamente (`purge`). Los vehículos en baja y los
usuarios desactivados se integran en el mismo espacio sin duplicar mecanismo.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.db.models import ProtectedError
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsAdmin, IsSuperuser

from .models import (
    Brand,
    BusinessUnit,
    Company,
    Country,
    Document,
    Incident,
    Invoice,
    InvoiceAllocation,
    KmReading,
    Pep,
    Project,
    Renting,
    Vehicle,
    VehicleModel,
)
from .models.enums import VehicleState

# type → (modelo, etiqueta plural). El orden es el de presentación.
DEACTIVATABLE: dict[str, tuple[type, str]] = {
    "km-readings": (KmReading, "Lecturas de km"),
    "documents": (Document, "Documentos"),
    "incidents": (Incident, "Incidencias"),
    "invoices": (Invoice, "Facturas"),
    "invoice-allocations": (InvoiceAllocation, "Repartos de factura"),
    "brands": (Brand, "Marcas"),
    "vehicle-models": (VehicleModel, "Modelos"),
    "companies": (Company, "Sociedades"),
    "rentings": (Renting, "Rentings"),
    "projects": (Project, "Proyectos"),
    "peps": (Pep, "PEP / CECO"),
    "business-units": (BusinessUnit, "Unidades de negocio"),
    "countries": (Country, "Países"),
}


def _item(obj, *, label: str | None = None, when=None, who: str = "", reason: str = "") -> dict:
    return {
        "id": obj.pk,
        "label": label or str(obj),
        "deactivated_at": when,
        "deactivated_by": who,
        "reason": reason,
    }


def _deactivated_items(model) -> list[dict]:
    rows = (
        model.objects.filter(is_active=False)
        .select_related("deactivated_by")
        .order_by("-deactivated_at")
    )
    return [
        _item(
            obj,
            when=obj.deactivated_at,
            who=(
                (obj.deactivated_by.get_full_name() or obj.deactivated_by.get_username())
                if obj.deactivated_by
                else ""
            ),
            reason=obj.deactivation_reason,
        )
        for obj in rows
    ]


class ErratasView(APIView):
    """GET /api/v1/erratas/ — inventario agregado por tipo (solo admin)."""

    permission_classes = [IsAdmin]

    def get(self, request):
        groups = []
        for key, (model, label) in DEACTIVATABLE.items():
            items = _deactivated_items(model)
            if items:
                groups.append({"type": key, "label": label, "count": len(items), "items": items})
        # Integrados sin duplicar mecanismo: vehículos en baja y usuarios inactivos.
        vehicles = [
            _item(v, when=v.updated_at)
            for v in Vehicle.objects.filter(state=VehicleState.BAJA).order_by("-updated_at")
        ]
        if vehicles:
            groups.append(
                {
                    "type": "vehicles",
                    "label": "Vehículos (baja)",
                    "count": len(vehicles),
                    "items": vehicles,
                }
            )
        User = get_user_model()
        users = [
            _item(u, label=u.get_full_name() or u.get_username())
            for u in User.objects.filter(is_active=False).order_by("username")
        ]
        if users:
            groups.append(
                {
                    "type": "users",
                    "label": "Usuarios (desactivados)",
                    "count": len(users),
                    "items": users,
                }
            )
        return Response(groups)


def _resolve(request):
    kind = request.data.get("type")
    pk = request.data.get("id")
    if kind in DEACTIVATABLE:
        model = DEACTIVATABLE[kind][0]
        obj = model.objects.filter(pk=pk, is_active=False).first()
    elif kind == "vehicles":
        model = Vehicle
        obj = Vehicle.objects.filter(pk=pk, state=VehicleState.BAJA).first()
    elif kind == "users":
        model = get_user_model()
        obj = model.objects.filter(pk=pk, is_active=False).first()
    else:
        raise ValidationError({"type": "Tipo de errata desconocido."})
    if obj is None:
        raise ValidationError({"id": "No hay ninguna errata de ese tipo con ese id."})
    return kind, obj


class ErratasRestoreView(APIView):
    """POST /api/v1/erratas/restore/ {type, id} — reactiva el registro (admin)."""

    permission_classes = [IsAdmin]

    def post(self, request):
        kind, obj = _resolve(request)
        if kind == "vehicles":
            obj.state = VehicleState.ACTIVE
            obj.save(update_fields=["state", "updated_at"])
        elif kind == "users":
            obj.is_active = True
            obj.save(update_fields=["is_active"])
        else:
            obj.restore()
        return Response({"restored": True, "type": kind, "id": obj.pk})


class ErratasPurgeView(APIView):
    """POST /api/v1/erratas/purge/ {type, id} — borrado REAL, solo superusuario.

    Queda auditado por django-auditlog como el resto de cambios.
    """

    permission_classes = [IsSuperuser]

    def post(self, request):
        kind, obj = _resolve(request)
        try:
            obj.delete()
        except ProtectedError as exc:
            raise ValidationError(
                {"id": "No se puede eliminar: otros registros lo referencian (PROTECT)."}
            ) from exc
        return Response({"purged": True, "type": kind, "id": request.data.get("id")})
