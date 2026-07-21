from auditlog.models import LogEntry
from django_filters import rest_framework as filters
from django_filters.widgets import BooleanWidget
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import SAFE_METHODS, BasePermission
from rest_framework.response import Response

from accounts.permissions import (
    AdminWriteManagementOrDriverRead,
    AdminWriteManagementRead,
    IsManagement,
    IsManagementOrDriverReadOnly,
    ManagementOrDriverReadWrite,
    ManagementReadWrite,
)

from .models import (
    Alert,
    Assignment,
    BusinessUnit,
    Contract,
    Country,
    Document,
    Event,
    Incident,
    Invoice,
    InvoiceAllocation,
    KmReading,
    Pep,
    Project,
    Renting,
    Vehicle,
    VehicleLink,
    VehicleUsage,
)
from .models.enums import AlertStatus, VehicleState
from .scoping import vehicles_for
from .serializers import (
    AlertSerializer,
    AssignmentSerializer,
    BusinessUnitSerializer,
    ContractSerializer,
    CountrySerializer,
    DocumentSerializer,
    EventSerializer,
    IncidentSerializer,
    InvoiceAllocationSerializer,
    InvoiceSerializer,
    KmReadingSerializer,
    LogEntrySerializer,
    PepSerializer,
    ProjectSerializer,
    RentingSerializer,
    VehicleLinkSerializer,
    VehicleSerializer,
    VehicleUsageSerializer,
)


def _json_safe(value):
    """Valor serializable para el diff de preview (FKs → pk)."""
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if hasattr(value, "pk"):
        return value.pk
    return str(value)


# --- Scoping por rol ------------------------------------------------------

class ScopedByVehicleMixin:
    """Acota el queryset (y la escritura) a la flota visible por el usuario.

    `vehicle_lookup` es el path al vehículo desde el modelo del viewset:
    `""` para el propio `Vehicle`, `"vehicle"` para los que cuelgan de él.
    """

    vehicle_lookup = "vehicle"

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if user.is_admin:
            return qs
        vehicle_ids = vehicles_for(user).values_list("id", flat=True)
        lookup = "id__in" if self.vehicle_lookup == "" else f"{self.vehicle_lookup}__in"
        return qs.filter(**{lookup: vehicle_ids})

    def perform_create(self, serializer):
        # El no-admin solo puede crear recursos sobre vehículos de su ámbito.
        user = self.request.user
        if not user.is_admin and self.vehicle_lookup:
            vehicle = serializer.validated_data.get("vehicle")
            if vehicle is not None and not vehicles_for(user).filter(pk=vehicle.pk).exists():
                raise PermissionDenied("El vehículo está fuera de tu ámbito.")
        serializer.save(**self.extra_create_kwargs())

    def extra_create_kwargs(self) -> dict:
        """Kwargs extra al crear (p. ej. fijar el autor). Sobrescríbelo si hace falta."""
        return {}


# --- Vehículos ------------------------------------------------------------

class VehicleFilter(filters.FilterSet):
    """Filtros del listado de flota (HU-1.1)."""

    assigned = filters.BooleanFilter(
        method="filter_assigned", label="¿Asignado?", widget=BooleanWidget()
    )

    class Meta:
        model = Vehicle
        fields = ["state", "business_use", "is_substitute", "supervisor", "type", "property"]

    def filter_assigned(self, queryset, name, value):
        # Vehículos con al menos una asignación EN CURSO (consulta directa a la
        # tabla para no capturar por LEFT JOIN los que no tienen asignaciones).
        active = Assignment.objects.filter(end_date__isnull=True).values("vehicle_id")
        return queryset.filter(id__in=active) if value else queryset.exclude(id__in=active)


class VehicleViewSet(ScopedByVehicleMixin, viewsets.ModelViewSet):
    """CRUD de vehículos.

    - Admin: CRUD sobre toda la flota.
    - Supervisor: lectura de **su grupo** (`supervisor=user`) — HU-2.8.
    - Conductor: lectura de sus vehículos asignados.

    Escritura solo admin (no alta/baja para el supervisor). Los vehículos en
    `baja` no salen por defecto; se ven con `?state=baja` o `?include_baja=1`.
    """

    serializer_class = VehicleSerializer
    permission_classes = [AdminWriteManagementOrDriverRead]
    vehicle_lookup = ""
    queryset = Vehicle.objects.all()
    filterset_class = VehicleFilter
    search_fields = [
        "plate", "brand", "model",
        "assignments__driver__first_name", "assignments__driver__last_name",
        "assignments__driver__username",
    ]
    ordering_fields = ["plate", "state", "year", "created_at"]
    ordering = ["plate"]

    def get_queryset(self):
        qs = super().get_queryset().select_related(
            "supervisor", "business_unit", "project", "cost_center"
        )
        params = self.request.query_params
        include_baja = params.get("include_baja") in ("1", "true", "True")
        if params.get("state") != VehicleState.BAJA and not include_baja:
            qs = qs.exclude(state=VehicleState.BAJA)
        return qs

    @action(detail=True, methods=["get"], permission_classes=[IsManagement])
    def history(self, request, pk=None):
        """GET /api/vehicles/{id}/history/ — auditoría de campos del vehículo."""
        vehicle = self.get_object()
        entries = LogEntry.objects.get_for_object(vehicle).select_related("actor")
        page = self.paginate_queryset(entries)
        if page is not None:
            return self.get_paginated_response(LogEntrySerializer(page, many=True).data)
        return Response(LogEntrySerializer(entries, many=True).data)

    @action(detail=True, methods=["post"], permission_classes=[IsManagement])
    def preview(self, request, pk=None):
        """POST /api/vehicles/{id}/preview/ — diff de los cambios propuestos."""
        vehicle = self.get_object()
        serializer = self.get_serializer(vehicle, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        changes = {}
        for field, new_value in serializer.validated_data.items():
            old_value = getattr(vehicle, field, None)
            if old_value != new_value:
                changes[field] = [_json_safe(old_value), _json_safe(new_value)]
        return Response({"changes": changes})


# --- Recursos que cuelgan del vehículo -----------------------------------

class ContractViewSet(ScopedByVehicleMixin, viewsets.ModelViewSet):
    serializer_class = ContractSerializer
    permission_classes = [AdminWriteManagementRead]
    queryset = Contract.objects.select_related("vehicle", "renting")
    filterset_fields = ["vehicle", "renting"]
    ordering_fields = ["start_date", "planned_end_date"]


class KmReadingViewSet(ScopedByVehicleMixin, viewsets.ModelViewSet):
    """Lecturas de km. El conductor registra las de su vehículo (HU-3.1)."""

    serializer_class = KmReadingSerializer
    permission_classes = [ManagementOrDriverReadWrite]
    queryset = KmReading.objects.select_related("vehicle")
    filterset_fields = ["vehicle"]
    ordering_fields = ["reading_date", "km_reading"]


class AssignmentViewSet(ScopedByVehicleMixin, viewsets.ModelViewSet):
    """Asignaciones. Escritura solo admin; conductor lee las suyas."""

    serializer_class = AssignmentSerializer
    permission_classes = [AdminWriteManagementOrDriverRead]
    queryset = Assignment.objects.select_related("vehicle", "driver")
    filterset_fields = ["vehicle", "driver", "status"]
    ordering_fields = ["start_date", "created_at"]


class VehicleUsageViewSet(ScopedByVehicleMixin, viewsets.ModelViewSet):
    """Reparto de uso. Admin (toda la flota) o supervisor (su grupo) — HU-2.5."""

    serializer_class = VehicleUsageSerializer
    permission_classes = [ManagementReadWrite]
    queryset = VehicleUsage.objects.select_related("vehicle", "driver")
    filterset_fields = ["vehicle", "driver"]


class VehicleLinkViewSet(ScopedByVehicleMixin, viewsets.ModelViewSet):
    serializer_class = VehicleLinkSerializer
    permission_classes = [AdminWriteManagementRead]
    queryset = VehicleLink.objects.select_related("main_vehicle", "substitute_vehicle")
    vehicle_lookup = "main_vehicle"
    filterset_fields = ["main_vehicle", "substitute_vehicle", "reason"]


class EventViewSet(ScopedByVehicleMixin, viewsets.ReadOnlyModelViewSet):
    """Histórico de eventos (solo lectura; los emiten los procesos de negocio)."""

    serializer_class = EventSerializer
    permission_classes = [AdminWriteManagementOrDriverRead]
    queryset = Event.objects.select_related("vehicle")
    filterset_fields = ["vehicle", "event_type"]
    ordering_fields = ["event_date"]


class InvoiceViewSet(ScopedByVehicleMixin, viewsets.ModelViewSet):
    serializer_class = InvoiceSerializer
    permission_classes = [AdminWriteManagementRead]
    queryset = Invoice.objects.select_related("vehicle")
    filterset_fields = ["vehicle"]
    ordering_fields = ["date", "amount"]


class InvoiceAllocationViewSet(ScopedByVehicleMixin, viewsets.ModelViewSet):
    serializer_class = InvoiceAllocationSerializer
    permission_classes = [AdminWriteManagementRead]
    queryset = InvoiceAllocation.objects.select_related("invoice", "project", "cost_center")
    vehicle_lookup = "invoice__vehicle"
    filterset_fields = ["invoice", "target_type"]


# --- Documentación e incidencias (Épica 4 / 6) ---------------------------

class DocumentPermission(BasePermission):
    """Lee/crea gestión o conductor; edita/borra solo gestión.

    El conductor sube documentos de su vehículo (HU-4.1); la gestión los
    administra (HU-4.4). El scoping por vehículo lo aplica el queryset.
    """

    message = "No tienes permiso para esta operación sobre documentos."

    def has_permission(self, request, view) -> bool:
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if request.method in SAFE_METHODS or request.method == "POST":
            return user.is_management or user.is_driver
        return user.is_management  # PUT / PATCH / DELETE


class IncidentViewSet(ScopedByVehicleMixin, viewsets.ModelViewSet):
    """Incidencias / mantenimiento. Gestión (admin toda; supervisor su grupo)."""

    serializer_class = IncidentSerializer
    permission_classes = [ManagementReadWrite]
    queryset = Incident.objects.select_related("vehicle")
    filterset_fields = ["vehicle", "type", "status"]
    ordering_fields = ["date", "created_at"]


class DocumentViewSet(ScopedByVehicleMixin, viewsets.ModelViewSet):
    """Documentos del vehículo. El conductor sube los de su vehículo (HU-4.1)."""

    serializer_class = DocumentSerializer
    permission_classes = [DocumentPermission]
    queryset = Document.objects.select_related("vehicle", "incident", "uploaded_by")
    filterset_fields = ["vehicle", "type", "status", "incident"]
    ordering_fields = ["created_at", "expiry_date"]

    def extra_create_kwargs(self) -> dict:
        return {"uploaded_by": self.request.user}


# --- Alertas (Épicas 3/5/10) ---------------------------------------------

class AlertViewSet(ScopedByVehicleMixin, viewsets.ReadOnlyModelViewSet):
    """Bandeja de alertas. Solo lectura + acciones de cierre.

    Las alertas las generan los trabajos programados (`fleet/services/alerts.py`);
    por API no se crean ni editan, solo se **resuelven/descartan** (gestión). El
    conductor ve las de sus vehículos (p. ej. la lectura de km pendiente).
    """

    serializer_class = AlertSerializer
    permission_classes = [IsManagementOrDriverReadOnly]
    queryset = Alert.objects.select_related("vehicle", "user")
    filterset_fields = ["vehicle", "type", "level", "status"]
    ordering_fields = ["created_at", "due_date", "level"]
    ordering = ["-created_at"]

    @action(detail=True, methods=["post"], permission_classes=[IsManagement])
    def resolve(self, request, pk=None):
        """POST /api/alerts/{id}/resolve/ — marca la alerta como resuelta."""
        alert = self.get_object()
        alert.close(status=AlertStatus.RESOLVED, by=request.user)
        return Response(self.get_serializer(alert).data)

    @action(detail=True, methods=["post"], permission_classes=[IsManagement])
    def dismiss(self, request, pk=None):
        """POST /api/alerts/{id}/dismiss/ — descarta la alerta sin acción."""
        alert = self.get_object()
        alert.close(status=AlertStatus.DISMISSED, by=request.user)
        return Response(self.get_serializer(alert).data)


# --- Catálogos (lectura gestión, escritura admin) ------------------------

class CountryViewSet(viewsets.ModelViewSet):
    queryset = Country.objects.all()
    serializer_class = CountrySerializer
    permission_classes = [AdminWriteManagementRead]
    search_fields = ["name"]


class BusinessUnitViewSet(viewsets.ModelViewSet):
    queryset = BusinessUnit.objects.all()
    serializer_class = BusinessUnitSerializer
    permission_classes = [AdminWriteManagementRead]
    search_fields = ["code", "name"]


class ProjectViewSet(viewsets.ModelViewSet):
    queryset = Project.objects.all()
    serializer_class = ProjectSerializer
    permission_classes = [AdminWriteManagementRead]
    search_fields = ["project_name"]


class PepViewSet(viewsets.ModelViewSet):
    queryset = Pep.objects.all()
    serializer_class = PepSerializer
    permission_classes = [AdminWriteManagementRead]
    search_fields = ["code", "name"]


class RentingViewSet(viewsets.ModelViewSet):
    queryset = Renting.objects.all()
    serializer_class = RentingSerializer
    permission_classes = [AdminWriteManagementRead]
    search_fields = ["name"]
