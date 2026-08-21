"""N7 — Espacio de erratas: inventario de registros desactivados.

Un registro desactivado (destroy → deactivate) se considera una errata o un
error. Aquí la administración lo ve (quién/cuándo/por qué), puede RESTAURARLO,
y SOLO el superusuario (el `admin` de `bootstrap_admin`, único por diseño)
puede ELIMINARLO definitivamente (`purge`). Los vehículos en baja y los
usuarios desactivados se integran en el mismo espacio sin duplicar mecanismo.
"""

from __future__ import annotations

from dataclasses import dataclass

from django.contrib.auth import get_user_model
from django.db.models import ProtectedError, Q
from django.db.models.deletion import Collector
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsAdmin, IsSuperuser
from core.pagination import StandardResultsPagination

from .models import (
    Assignment,
    Brand,
    BusinessUnit,
    Company,
    Contract,
    Country,
    Document,
    EmailSignature,
    EmailTemplate,
    Incident,
    Invoice,
    InvoiceAllocation,
    KmReading,
    Pep,
    Project,
    Renting,
    Vehicle,
    VehicleLink,
    VehicleModel,
    VehicleRequest,
    VehicleUsage,
)
from .models.enums import VehicleState


@dataclass(frozen=True)
class ErrataType:
    """Un tipo de errata: qué modelo es, cómo se lee y por dónde se busca.

    M5: `related` es el `select_related` que necesita `__str__` para no disparar
    una consulta por fila (la etiqueta de una lectura de km incluye la matrícula
    del vehículo), y `search` son los campos que forman esa etiqueta, para que
    el buscador filtre **en servidor** sobre el tipo completo y no solo sobre lo
    que hubiera cargado el cliente.
    """

    model: type
    label: str
    related: tuple[str, ...] = ()
    search: tuple[str, ...] = ()


#: Comunes a todos los tipos desactivables (los aporta `DeactivatableModel`).
_COMMON_SEARCH = (
    "deactivation_reason",
    "deactivated_by__username",
    "deactivated_by__first_name",
    "deactivated_by__last_name",
)

_DRIVER_SEARCH = (
    "driver__username",
    "driver__first_name",
    "driver__last_name",
)

# type → descriptor. El orden es el de presentación.
DEACTIVATABLE: dict[str, ErrataType] = {
    "km-readings": ErrataType(KmReading, "Lecturas de km", ("vehicle",), ("vehicle__plate",)),
    # A1: los cinco recursos que antes se borraban de verdad (contrato,
    # asignación, reparto, vínculo y solicitud) ya solo se desactivan, así que
    # su sitio para el borrado definitivo es este espacio.
    "contracts": ErrataType(
        Contract, "Contratos", ("vehicle",), ("contract_number", "vehicle__plate")
    ),
    "assignments": ErrataType(
        Assignment, "Asignaciones", ("vehicle", "driver"), ("vehicle__plate", *_DRIVER_SEARCH)
    ),
    "vehicle-usages": ErrataType(
        VehicleUsage,
        "Repartos de uso",
        ("vehicle", "driver"),
        ("vehicle__plate", *_DRIVER_SEARCH),
    ),
    "vehicle-links": ErrataType(
        VehicleLink,
        "Vínculos de sustitución",
        ("main_vehicle", "substitute_vehicle"),
        ("main_vehicle__plate", "substitute_vehicle__plate"),
    ),
    "vehicle-requests": ErrataType(
        VehicleRequest,
        "Solicitudes de vehículo",
        ("requester",),
        ("jira_key", "requester__username", "requester__first_name", "requester__last_name"),
    ),
    "documents": ErrataType(Document, "Documentos", ("vehicle",), ("vehicle__plate",)),
    "incidents": ErrataType(Incident, "Incidencias", ("vehicle",), ("vehicle__plate",)),
    "invoices": ErrataType(Invoice, "Facturas", ("vehicle",), ("code", "vehicle__plate")),
    "invoice-allocations": ErrataType(
        InvoiceAllocation,
        "Repartos de factura",
        ("invoice", "invoice__vehicle"),
        ("invoice__code", "invoice__vehicle__plate"),
    ),
    "brands": ErrataType(Brand, "Marcas", (), ("name",)),
    "vehicle-models": ErrataType(VehicleModel, "Modelos", ("brand",), ("name", "brand__name")),
    "companies": ErrataType(Company, "Sociedades", (), ("code", "name")),
    "rentings": ErrataType(Renting, "Rentings", (), ("name",)),
    "projects": ErrataType(Project, "Proyectos", (), ("project_name",)),
    "peps": ErrataType(Pep, "PEP / CECO", (), ("code", "name")),
    "business-units": ErrataType(BusinessUnit, "Unidades de negocio", (), ("code", "name")),
    "countries": ErrataType(Country, "Países", (), ("name",)),
    # A2: sin esto, una plantilla/firma "borrada" era irrecuperable por API.
    "email-templates": ErrataType(EmailTemplate, "Plantillas de correo", (), ("key",)),
    "email-signatures": ErrataType(EmailSignature, "Firmas de correo", (), ("name",)),
}


def _item(obj, *, label: str | None = None, when=None, who: str = "", reason: str = "") -> dict:
    return {
        "id": obj.pk,
        "label": label or str(obj),
        "deactivated_at": when,
        "deactivated_by": who,
        "reason": reason,
    }


def _matching(term: str, fields: tuple[str, ...]) -> Q:
    """`OR` de `icontains` sobre `fields`."""
    criteria = Q()
    for name in fields:
        criteria |= Q(**{f"{name}__icontains": term})
    return criteria


def _deactivated_queryset(spec: ErrataType, search: str = ""):
    rows = (
        spec.model.objects.filter(is_active=False)
        .select_related("deactivated_by", *spec.related)
        # `-pk` desempata: sin él, la paginación en servidor puede repetir u
        # omitir filas desactivadas en el mismo instante (o sin fecha).
        .order_by("-deactivated_at", "-pk")
    )
    term = search.strip()
    if term:
        rows = rows.filter(_matching(term, spec.search + _COMMON_SEARCH))
    return rows


def _deactivated_item(obj) -> dict:
    return _item(
        obj,
        when=obj.deactivated_at,
        who=(
            (obj.deactivated_by.get_full_name() or obj.deactivated_by.get_username())
            if obj.deactivated_by
            else ""
        ),
        reason=obj.deactivation_reason,
    )


def _retired_vehicles(search: str = ""):
    rows = Vehicle.objects.filter(state=VehicleState.BAJA).order_by("-updated_at", "-pk")
    term = search.strip()
    if term:
        rows = rows.filter(_matching(term, ("plate", "brand", "model")))
    return rows


def _inactive_users(search: str = ""):
    rows = get_user_model().objects.filter(is_active=False).order_by("username")
    term = search.strip()
    if term:
        rows = rows.filter(_matching(term, ("username", "first_name", "last_name", "email")))
    return rows


def _page(kind: str, search: str):
    """(queryset, conversor a item) del tipo pedido; `ValidationError` si no existe."""
    if kind in DEACTIVATABLE:
        return _deactivated_queryset(DEACTIVATABLE[kind], search), _deactivated_item
    if kind == "vehicles":
        return _retired_vehicles(search), lambda v: _item(v, when=v.updated_at)
    if kind == "users":
        return (
            _inactive_users(search),
            lambda u: _item(u, label=u.get_full_name() or u.get_username()),
        )
    raise ValidationError({"type": "Tipo de errata desconocido."})


class ErratasView(APIView):
    """GET /api/v1/erratas/ — índice por tipo, SOLO recuentos (solo admin).

    M5: antes devolvía **todas** las filas desactivadas de los veintiún tipos en
    la misma respuesta, y cada `label` es un `__str__` que toca relaciones: abrir
    Ajustes recorría el histórico completo de la flota (con un N+1 por fila) para
    pintar unas pestañas con un número. Los registros se piden ahora tipo a tipo
    en `/erratas/items/`, paginados en servidor.
    """

    permission_classes = [IsAdmin]

    def get(self, request):
        groups = []
        for key, spec in DEACTIVATABLE.items():
            count = spec.model.objects.filter(is_active=False).count()
            if count:
                groups.append({"type": key, "label": spec.label, "count": count})
        # Integrados sin duplicar mecanismo: vehículos en baja y usuarios inactivos.
        retired = _retired_vehicles().count()
        if retired:
            groups.append({"type": "vehicles", "label": "Vehículos (baja)", "count": retired})
        inactive = _inactive_users().count()
        if inactive:
            groups.append({"type": "users", "label": "Usuarios (desactivados)", "count": inactive})
        return Response(groups)


class ErratasItemsView(APIView):
    """GET /api/v1/erratas/items/?type=…&search=&page=&page_size= — un tipo.

    Página de registros del tipo pedido, por fecha de desactivación descendente.
    `search` filtra EN SERVIDOR por los campos que forman la etiqueta (matrícula,
    número de contrato, conductor…) más el motivo y quién desactivó, comunes a
    todos los tipos: buscar sobre la página cargada mentiría en cuanto el tipo
    pasa de una página.
    """

    permission_classes = [IsAdmin]

    def get(self, request):
        rows, to_item = _page(
            request.query_params.get("type") or "",
            request.query_params.get("search") or "",
        )
        paginator = StandardResultsPagination()
        page = paginator.paginate_queryset(rows, request, view=self)
        return paginator.get_paginated_response([to_item(obj) for obj in page])


def _resolve(request):
    kind = request.data.get("type")
    pk = request.data.get("id")
    if kind in DEACTIVATABLE:
        model = DEACTIVATABLE[kind].model
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


def _cascade_report(obj) -> list[dict]:
    """Qué se llevaría por delante un `delete()` de `obj`, por modelo.

    A3: `purge` es la ÚNICA vía de borrado real del sistema, y borraba en
    cascada sin decirlo: purgar un usuario se llevaba sus asignaciones y
    repartos —el histórico que la propia baja de usuario promete conservar— y
    purgar un vehículo, todos sus eventos (que ni son desactivables ni salen en
    este espacio). Ahora se enumera antes.
    """
    collector = Collector(using=obj._state.db)
    collector.collect([obj])
    counts: dict[str, int] = {}
    for model, instances in collector.data.items():
        if model is type(obj):
            continue
        counts[model._meta.verbose_name_plural] = counts.get(
            model._meta.verbose_name_plural, 0
        ) + len(instances)
    return [
        {"label": str(label), "count": count}
        for label, count in sorted(counts.items(), key=lambda item: -item[1])
        if count
    ]


class ErratasPurgeView(APIView):
    """POST /api/v1/erratas/purge/ {type, id} — borrado REAL, solo superusuario.

    Dos pasos (A3): sin `confirm`, devuelve el **informe de impacto** de la
    cascada y no borra nada; con `confirm: true`, borra. Queda auditado por
    django-auditlog como el resto de cambios (también las cascadas de los
    modelos registrados).
    """

    permission_classes = [IsSuperuser]

    def post(self, request):
        kind, obj = _resolve(request)
        cascade = _cascade_report(obj)
        if not request.data.get("confirm"):
            return Response(
                {
                    "purged": False,
                    "requires_confirmation": True,
                    "type": kind,
                    "id": obj.pk,
                    "label": str(obj),
                    "cascade": cascade,
                }
            )
        try:
            obj.delete()
        except ProtectedError as exc:
            raise ValidationError(
                {"id": "No se puede eliminar: otros registros lo referencian (PROTECT)."}
            ) from exc
        return Response(
            {"purged": True, "type": kind, "id": request.data.get("id"), "cascade": cascade}
        )
