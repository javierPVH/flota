from decimal import Decimal

from auditlog.models import LogEntry
from django.conf import settings
from django.db import models, transaction
from django.http import HttpResponse
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django_filters import rest_framework as filters
from django_filters.widgets import BooleanWidget
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError
from rest_framework.permissions import SAFE_METHODS, BasePermission, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from rest_framework.views import APIView

from accounts.models import Role, UserRole
from accounts.permissions import (
    AdminWriteManagementOrDriverRead,
    AdminWriteManagementRead,
    IsAdmin,
    IsDriver,
    IsManagement,
    IsManagementOrDriverReadOnly,
    ManagementOrDriverReadWrite,
    ManagementReadWrite,
)
from core.throttling import PublicWriteThrottle

from .models import (
    Alert,
    Assignment,
    Brand,
    BusinessUnit,
    Company,
    Contract,
    Country,
    Document,
    EmailLog,
    EmailSignature,
    EmailTemplate,
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
    VehicleModel,
    VehicleRequest,
    VehicleUsage,
)
from .models.enums import (
    AlertStatus,
    AssignmentStatus,
    DocumentStatus,
    VehicleRequestStatus,
    VehicleState,
)
from .scoping import vehicles_for
from .serializers import (
    AlertSerializer,
    AssignmentSerializer,
    BrandSerializer,
    BusinessUnitSerializer,
    CompanySerializer,
    ContractSerializer,
    CountrySerializer,
    DocumentSerializer,
    EmailLogSerializer,
    EmailSignatureSerializer,
    EmailTemplateSerializer,
    EventSerializer,
    IncidentSerializer,
    InvoiceAllocateSerializer,
    InvoiceAllocationSerializer,
    InvoiceSerializer,
    KmReadingSerializer,
    LogEntrySerializer,
    PepSerializer,
    ProjectSerializer,
    RentingSerializer,
    UsageSplitSerializer,
    VehicleLinkSerializer,
    VehicleModelSerializer,
    VehicleRequestMineSerializer,
    VehicleRequestSerializer,
    VehicleSerializer,
    VehicleUsageSerializer,
)
from .services import events, metrics, reports
from .services.archiver import archive_document


class Conflict(APIException):
    """409: el registro cambió desde que se cargó (bloqueo optimista)."""

    status_code = status.HTTP_409_CONFLICT
    default_detail = "El registro ha cambiado desde que lo cargaste. Recarga y reintenta."
    default_code = "conflict"


def _json_safe(value):
    """Valor serializable para el diff de preview (FKs → pk)."""
    if value is None or isinstance(value, bool | int | float | str):
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

    def perform_update(self, serializer):
        # SEC1: sin esto, un PATCH {"vehicle": <ajeno>} movía el recurso (lectura,
        # incidencia, documento…) a un vehículo fuera del ámbito del autor.
        user = self.request.user
        if not user.is_admin and self.vehicle_lookup:
            vehicle = serializer.validated_data.get("vehicle")
            if vehicle is not None and not vehicles_for(user).filter(pk=vehicle.pk).exists():
                raise PermissionDenied("El vehículo está fuera de tu ámbito.")
        serializer.save()

    def extra_create_kwargs(self) -> dict:
        """Kwargs extra al crear (p. ej. fijar el autor). Sobrescríbelo si hace falta."""
        return {}


# --- N7: nada se borra ----------------------------------------------------


class DeactivateOnDestroyMixin:
    """N7: `DELETE` desactiva (actor + momento + motivo) en vez de borrar.

    Los listados excluyen inactivos por defecto; la gestión puede verlos con
    `?include_inactive=1`. El borrado real (purge) solo existe en el espacio
    de erratas y exige superusuario.
    """

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if params.get("include_inactive") in ("1", "true", "True") and (
            self.request.user.is_authenticated and self.request.user.is_management
        ):
            return qs
        return qs.filter(is_active=True)

    def perform_destroy(self, instance):
        # El motivo llega por query (`?reason=`, los DELETE sin cuerpo del front)
        # o por cuerpo JSON.
        reason = str(self.request.query_params.get("reason", "") or "")
        if not reason and isinstance(self.request.data, dict):
            reason = str(self.request.data.get("reason", "") or "")
        instance.deactivate(by=self.request.user, reason=reason)


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
        # Vehículos con asignación ACEPTADA en curso (BG12: contar cualquier
        # asignación incluía PROPUESTAS — un coche salía "asignado" y sin
        # conductor en la misma fila; mismo criterio que current_driver_map).
        active = Assignment.objects.filter(
            end_date__isnull=True, status=AssignmentStatus.ACCEPTED
        ).values("vehicle_id")
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
        "plate",
        "brand",
        "model",
        "assignments__driver__first_name",
        "assignments__driver__last_name",
        "assignments__driver__username",
    ]
    ordering_fields = ["plate", "state", "year", "created_at"]
    ordering = ["plate"]

    def get_queryset(self):
        qs = (
            super()
            .get_queryset()
            .select_related("supervisor", "business_unit", "project", "cost_center")
        )
        params = self.request.query_params
        include_baja = params.get("include_baja") in ("1", "true", "True")
        if params.get("state") != VehicleState.BAJA and not include_baja:
            qs = qs.exclude(state=VehicleState.BAJA)
        return qs

    def perform_create(self, serializer):
        # Alta + evento de negocio en una transacción (HU-1.3).
        with transaction.atomic():
            super().perform_create(serializer)
            events.emit_vehicle_created(serializer.instance)

    def perform_update(self, serializer):
        instance = serializer.instance
        # Bloqueo optimista (opt-in): si el cliente envía `expected_updated_at`
        # y no coincide con el actual, la ficha cambió entre medias → 409.
        expected = self.request.data.get("expected_updated_at")
        if expected:
            parsed = parse_datetime(str(expected))
            if parsed is None or parsed != instance.updated_at:
                raise Conflict()
        old_state = instance.state
        with transaction.atomic():
            super().perform_update(serializer)
            updated = serializer.instance
            if updated.state != old_state:
                # Cambio de estado → evento (HU-1.5/1.6), con motivo opcional.
                events.emit_vehicle_state_change(
                    updated,
                    old_state,
                    updated.state,
                    reason=str(self.request.data.get("change_reason", "")),
                )

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

    @action(detail=True, methods=["get"])
    def summary(self, request, pk=None):
        """GET /api/vehicles/{id}/summary/ — métricas de la ficha (HU-1.2/3.4).

        Coste, km, proyección lineal a fin de contrato con nivel
        `within`/`watch`/`over` y penalización estimada. Mismo scoping de
        lectura que la ficha (conductor: sus vehículos; supervisor: su grupo).
        """
        return Response(metrics.vehicle_summary(self.get_object()))

    @action(
        detail=True, methods=["post"], url_path="convert-to-fleet", permission_classes=[IsAdmin]
    )
    def convert_to_fleet(self, request, pk=None):
        """N9: sustituto → flota (vía explícita; la inversa está prohibida).

        Solo si NO tiene un vínculo de sustitución activo: primero se cierra
        el vínculo, después se convierte.
        """
        from .selectors import active_link_blocking

        vehicle = self.get_object()
        if not vehicle.is_substitute:
            raise ValidationError({"is_substitute": "El vehículo ya es de flota."})
        busy = VehicleLink.objects.filter(substitute_vehicle=vehicle, end_date__isnull=True).first()
        if busy is not None:
            raise ValidationError(
                {
                    "is_substitute": (
                        "Está cubriendo a "
                        f"{busy.main_vehicle.plate}: cierra ese vínculo antes de convertirlo."
                    )
                }
            )
        # Defensa extra: tampoco debe estar bloqueado como principal (no debería
        # poder tener sustituto siendo sustituto, pero por si hay datos legados).
        if active_link_blocking(vehicle) is not None:
            raise ValidationError({"is_substitute": "Tiene un vínculo activo como principal."})
        vehicle.is_substitute = False
        vehicle.save(update_fields=["is_substitute", "updated_at"])
        return Response(self.get_serializer(vehicle).data)


# --- Recursos que cuelgan del vehículo -----------------------------------


class ContractViewSet(ScopedByVehicleMixin, viewsets.ModelViewSet):
    serializer_class = ContractSerializer
    permission_classes = [AdminWriteManagementRead]
    queryset = Contract.objects.select_related("vehicle", "renting")
    filterset_fields = ["vehicle", "renting"]
    ordering_fields = ["start_date", "planned_end_date"]


class KmReadingViewSet(DeactivateOnDestroyMixin, ScopedByVehicleMixin, viewsets.ModelViewSet):
    """Lecturas de km. El conductor registra las de su vehículo (HU-3.1)."""

    serializer_class = KmReadingSerializer
    permission_classes = [ManagementOrDriverReadWrite]
    # Front público (internet): acota las escrituras del conductor.
    throttle_classes = [UserRateThrottle, PublicWriteThrottle]
    throttle_scope = "public_write"
    queryset = KmReading.objects.select_related("vehicle")
    filterset_fields = ["vehicle"]
    ordering_fields = ["reading_date", "km_reading"]

    def perform_create(self, serializer):
        # Lectura + evento de negocio (HU-3.1) en una transacción.
        with transaction.atomic():
            super().perform_create(serializer)
            events.emit_km_reading(serializer.instance)

    def _require_management(self):
        # SEC4: para el conductor el registro es append-only — editar o borrar
        # la última lectura permitiría esquivar el no-retroceso.
        if not self.request.user.is_management:
            raise PermissionDenied("Solo la gestión puede modificar o borrar lecturas.")

    def perform_update(self, serializer):
        self._require_management()
        super().perform_update(serializer)

    def perform_destroy(self, instance):
        self._require_management()
        super().perform_destroy(instance)

    @action(detail=False, methods=["get"], permission_classes=[IsAuthenticated])
    def window(self, request):
        """GET /km-readings/window/ — estado de la ventana de registro (N8a).

        La app de campo lo usa para avisar y deshabilitar el formulario fuera
        de plazo (la autoridad real es la validación del serializer).
        """
        from .services import km_window

        today = timezone.localdate()
        return Response(
            {
                "open": km_window.field_window_open(today) or request.user.is_management,
                "start_day": settings.FLEET_KM_WINDOW_START,
                "last_day": km_window.last_day_of_month(today),
                "today": today,
                "management_exempt": request.user.is_management,
            }
        )

    @action(detail=False, methods=["get", "post"], permission_classes=[IsAdmin])
    def estimate(self, request):
        """N8b — completar km faltantes del mes anterior (solo admin, días 1-10).

        - `GET`: recuento de vehículos sin lectura del mes anterior + ventana.
        - `POST {months: 1|2|3|6}`: crea las lecturas estimadas (media mensual
          de los N últimos meses, redondeada, nunca retrocede, `estimated=True`)
          y devuelve el resumen. Idempotente por periodo.
        """
        from .services import km_window

        today = timezone.localdate()
        window_open = km_window.estimate_window_open(today)
        if request.method == "GET":
            missing = km_window.missing_last_month(today)
            return Response(
                {
                    "open": window_open,
                    "window_end_day": settings.FLEET_KM_ESTIMATE_WINDOW_END,
                    "missing_count": len(missing),
                    "missing": [{"vehicle": v.id, "plate": v.plate} for v in missing],
                }
            )
        if not window_open:
            raise ValidationError(
                {
                    "detail": (
                        "El cálculo de km faltantes solo está disponible del día 1 al "
                        f"{settings.FLEET_KM_ESTIMATE_WINDOW_END} del mes."
                    )
                }
            )
        try:
            months = int(request.data.get("months", 0))
        except (TypeError, ValueError):
            months = 0
        if months not in (1, 2, 3, 6):
            raise ValidationError({"months": "Indica la media a usar: 1, 2, 3 o 6 meses."})
        with transaction.atomic():
            result = km_window.estimate_missing(months, today)
        return Response(result)


class AssignmentViewSet(ScopedByVehicleMixin, viewsets.ModelViewSet):
    """Asignaciones. Escritura solo admin; conductor lee las suyas.

    El ciclo propuesta → aceptada/rechazada va por las acciones `accept`/`reject`
    (HU-2.4): son la transición de negocio completa (cierran la vigente y emiten
    el evento), no un simple cambio de `status`.
    """

    serializer_class = AssignmentSerializer
    permission_classes = [AdminWriteManagementOrDriverRead]
    queryset = Assignment.objects.select_related("vehicle", "driver")
    filterset_fields = ["vehicle", "driver", "status"]
    ordering_fields = ["start_date", "created_at"]

    def perform_create(self, serializer):
        # Nueva asignación, atómico. El evento de cambio de conductor solo se
        # emite si nace ACEPTADA: una propuesta (HU-2.3) no altera nada hasta
        # que la gestión la confirme.
        with transaction.atomic():
            super().perform_create(serializer)
            assignment = serializer.instance
            if assignment.status == AssignmentStatus.ACCEPTED:
                events.emit_driver_change(
                    assignment.vehicle, old_driver=None, new_driver=assignment.driver
                )

    @action(detail=True, methods=["post"], permission_classes=[IsAdmin])
    def accept(self, request, pk=None):
        """POST /assignments/{id}/accept/ — confirma una propuesta (HU-2.4).

        Cierra la asignación vigente (fin = inicio de la nueva), acepta la
        propuesta y emite el evento de cambio de conductor, todo atómico.
        """
        assignment = self.get_object()
        if assignment.status != AssignmentStatus.PROPOSED:
            raise ValidationError({"status": "Solo se puede aceptar una propuesta."})
        with transaction.atomic():
            current = (
                Assignment.objects.select_for_update()
                .filter(
                    vehicle=assignment.vehicle,
                    status=AssignmentStatus.ACCEPTED,
                    end_date__isnull=True,
                )
                .exclude(pk=assignment.pk)
                .select_related("driver")
                .first()
            )
            old_driver = current.driver if current else None
            if current:
                current.status = AssignmentStatus.FINISHED
                current.end_date = assignment.start_date or timezone.localdate()
                current.save(update_fields=["status", "end_date", "updated_at"])
            assignment.status = AssignmentStatus.ACCEPTED
            if not assignment.start_date:
                assignment.start_date = timezone.localdate()
            assignment.save(update_fields=["status", "start_date", "updated_at"])
            events.emit_driver_change(
                assignment.vehicle, old_driver=old_driver, new_driver=assignment.driver
            )
        return Response(self.get_serializer(assignment).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAdmin])
    def reject(self, request, pk=None):
        """POST /assignments/{id}/reject/ — rechaza la propuesta sin tocar la vigente."""
        assignment = self.get_object()
        if assignment.status != AssignmentStatus.PROPOSED:
            raise ValidationError({"status": "Solo se puede rechazar una propuesta."})
        assignment.status = AssignmentStatus.REJECTED
        assignment.save(update_fields=["status", "updated_at"])
        return Response(self.get_serializer(assignment).data)

    @action(
        detail=False,
        methods=["post"],
        permission_classes=[IsDriver],
        # SEC9: escritura alcanzable desde internet — mismo scope que km/docs.
        throttle_classes=[UserRateThrottle, PublicWriteThrottle],
    )
    def propose(self, request):
        """POST /assignments/propose/ — el conductor propone fechas (HU-2.3).

        Crea una asignación `proposed` a su nombre sobre un vehículo de su
        ámbito. NO altera la asignación vigente: queda pendiente en la bandeja
        de la gestión (accept/reject).
        """
        data = {
            "vehicle": request.data.get("vehicle"),
            "driver": request.user.pk,
            "start_date": request.data.get("start_date"),
            "end_date": request.data.get("end_date"),
            "status": AssignmentStatus.PROPOSED,
        }
        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        vehicle = serializer.validated_data["vehicle"]
        if not vehicles_for(request.user).filter(pk=vehicle.pk).exists():
            raise PermissionDenied("El vehículo está fuera de tu ámbito.")
        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class VehicleUsageViewSet(ScopedByVehicleMixin, viewsets.ModelViewSet):
    """Reparto de uso. Admin (toda la flota) o supervisor (su grupo) — HU-2.5."""

    serializer_class = VehicleUsageSerializer
    permission_classes = [ManagementReadWrite]
    queryset = VehicleUsage.objects.select_related("vehicle", "driver")
    filterset_fields = ["vehicle", "driver"]

    @action(detail=False, methods=["post"], url_path="set", url_name="set")
    def set_split(self, request):
        """POST /vehicle-usages/set/ — aplica el reparto completo de un vehículo.

        Valida que la suma sea **exactamente 100** (HU-2.5) y, en una
        transacción, cierra el reparto vigente (fin = inicio del nuevo) y crea
        las filas nuevas. Así el invariante no se rompe fila a fila.
        """
        serializer = UsageSplitSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        vehicle = data["vehicle"]
        user = request.user
        if not user.is_admin and not vehicles_for(user).filter(pk=vehicle.pk).exists():
            raise PermissionDenied("El vehículo está fuera de tu ámbito.")
        with transaction.atomic():
            VehicleUsage.objects.filter(vehicle=vehicle, end_date__isnull=True).update(
                end_date=data["start_date"]
            )
            rows = VehicleUsage.objects.bulk_create(
                VehicleUsage(
                    vehicle=vehicle,
                    driver=item["driver"],
                    usage_percent=item["usage_percent"],
                    start_date=data["start_date"],
                    end_date=data.get("end_date"),
                )
                for item in data["items"]
            )
        return Response(
            VehicleUsageSerializer(rows, many=True).data, status=status.HTTP_201_CREATED
        )


class VehicleLinkViewSet(ScopedByVehicleMixin, viewsets.ModelViewSet):
    serializer_class = VehicleLinkSerializer
    permission_classes = [AdminWriteManagementRead]
    queryset = VehicleLink.objects.select_related("main_vehicle", "substitute_vehicle")
    vehicle_lookup = "main_vehicle"
    filterset_fields = ["main_vehicle", "substitute_vehicle", "reason"]


class EventPermission(BasePermission):
    """Lectura para cualquier rol (scoping por queryset); alta para todos los
    roles PERO el serializer restringe el conductor a registrar solo ITV
    (HU-5.1/2.8) y los tipos manuales permitidos. Sin edición ni borrado."""

    message = "No tienes permiso para esta operación sobre eventos."

    def has_permission(self, request, view) -> bool:
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if request.method in SAFE_METHODS or request.method == "POST":
            return user.is_management or user.is_driver
        return False


class EventViewSet(ScopedByVehicleMixin, mixins.CreateModelMixin, viewsets.ReadOnlyModelViewSet):
    """Histórico de eventos + registro manual (Fase A1).

    Los procesos de negocio siguen emitiendo los suyos; por API solo se dan de
    alta los tipos manuales (`MANUAL_EVENT_TYPES`): **ITV** (HU-5.1 — al crearse
    su `EventItv`, la señal cierra las alertas y refresca `next_itv_date`),
    cambio de **cuota** y de **ubicación** (HU-1.4). El conductor solo ITV, de
    sus vehículos (scoping).
    """

    serializer_class = EventSerializer
    permission_classes = [EventPermission]
    # PR1: los subtipos son one-to-one inversos que get_details toca fila a
    # fila — sin select_related eran hasta 5 queries por evento.
    queryset = Event.objects.select_related(
        "vehicle", "itv", "fee_change", "location_change", "project_change", "pep_change"
    )
    filterset_fields = ["vehicle", "event_type"]
    ordering_fields = ["event_date"]

    def perform_create(self, serializer):
        # Evento + subtipo (y efectos de la señal de ITV) en una transacción.
        with transaction.atomic():
            super().perform_create(serializer)


class InvoiceViewSet(DeactivateOnDestroyMixin, ScopedByVehicleMixin, viewsets.ModelViewSet):
    serializer_class = InvoiceSerializer
    permission_classes = [AdminWriteManagementRead]
    queryset = Invoice.objects.select_related("vehicle")
    filterset_fields = ["vehicle"]
    ordering_fields = ["date", "amount"]

    @action(detail=True, methods=["post"])
    def allocate(self, request, pk=None):
        """POST /invoices/{id}/allocate/ — refacturación por líneas (Épica 7).

        Sustituye las imputaciones de la factura por las líneas recibidas.
        Valida que los % sumen **exactamente 100**; si una línea no trae
        importe, se calcula desde el total de la factura. Todo atómico.
        (Escritura = solo admin, por el permiso del viewset.)
        """
        invoice = self.get_object()
        serializer = InvoiceAllocateSerializer(data=request.data, context={"invoice": invoice})
        serializer.is_valid(raise_exception=True)
        lines = serializer.validated_data["lines"]
        with transaction.atomic():
            invoice.allocations.all().delete()
            rows = InvoiceAllocation.objects.bulk_create(
                InvoiceAllocation(
                    invoice=invoice,
                    target_type=line["target_type"],
                    project=line.get("project"),
                    cost_center=line.get("cost_center"),
                    percentage=line["percentage"],
                    amount=line.get("amount")
                    if line.get("amount") is not None
                    else (invoice.amount * line["percentage"] / Decimal("100")).quantize(
                        Decimal("0.01")
                    ),
                )
                for line in lines
            )
        return Response(
            InvoiceAllocationSerializer(rows, many=True).data, status=status.HTTP_201_CREATED
        )


class InvoiceAllocationViewSet(
    DeactivateOnDestroyMixin, ScopedByVehicleMixin, viewsets.ModelViewSet
):
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


class IncidentViewSet(DeactivateOnDestroyMixin, ScopedByVehicleMixin, viewsets.ModelViewSet):
    """Incidencias / mantenimiento. Escribe gestión (admin toda; supervisor su
    grupo); el conductor LEE las de sus vehículos (ficha de campo)."""

    serializer_class = IncidentSerializer
    permission_classes = [IsManagementOrDriverReadOnly]
    queryset = Incident.objects.select_related("vehicle")
    filterset_fields = ["vehicle", "type", "status"]
    ordering_fields = ["date", "created_at"]


class DocumentViewSet(DeactivateOnDestroyMixin, ScopedByVehicleMixin, viewsets.ModelViewSet):
    """Documentos del vehículo. El conductor sube los de su vehículo (HU-4.1)."""

    serializer_class = DocumentSerializer
    permission_classes = [DocumentPermission]
    # Front público (internet): acota la subida de documentos del conductor.
    throttle_classes = [UserRateThrottle, PublicWriteThrottle]
    throttle_scope = "public_write"
    queryset = Document.objects.select_related("vehicle", "incident", "uploaded_by")
    filterset_fields = ["vehicle", "type", "status", "incident"]
    ordering_fields = ["created_at", "expiry_date"]

    def extra_create_kwargs(self) -> dict:
        return {"uploaded_by": self.request.user}

    def perform_create(self, serializer):
        # PR3: el archivado hace I/O de red (hasta >90 s con reintentos) — se
        # dispara en on_commit, FUERA de la transacción. Hasta entonces el
        # documento nace `pendiente_archivar` (estado veraz en la respuesta);
        # si el archivado falla, lo reintenta el job.
        with transaction.atomic():
            super().perform_create(serializer)
            document = serializer.instance
            if not document.drive_url and document.status != DocumentStatus.PENDING_ARCHIVE:
                document.status = DocumentStatus.PENDING_ARCHIVE
                document.save(update_fields=["status", "updated_at"])
            transaction.on_commit(lambda: archive_document(document))


# --- Alertas (Épicas 3/5/10) ---------------------------------------------


class AlertViewSet(ScopedByVehicleMixin, viewsets.ReadOnlyModelViewSet):
    """Bandeja de alertas. Solo lectura + acciones de cierre.

    Las alertas las generan los trabajos programados (`fleet/services/alerts.py`);
    por API no se crean ni editan, solo se **resuelven/descartan** (gestión). El
    conductor ve las de sus vehículos (p. ej. la lectura de km pendiente).
    """

    serializer_class = AlertSerializer
    permission_classes = [IsManagementOrDriverReadOnly]
    # BG11: `level` es texto — ordenar por él ponía warning antes que critical.
    # Se expone `level_rank` (0=critical) anotado para ordenar por gravedad real.
    queryset = Alert.objects.select_related("vehicle", "user").annotate(
        level_rank=models.Case(
            models.When(level="critical", then=0),
            models.When(level="warning", then=1),
            default=2,
            output_field=models.IntegerField(),
        )
    )
    filterset_fields = ["vehicle", "type", "level", "status"]
    ordering_fields = ["created_at", "due_date", "level_rank"]
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


# --- Solicitudes de vehículo (Épica 8) -----------------------------------


class VehicleRequestViewSet(viewsets.ModelViewSet):
    """Solicitudes de vehículo. Gestión (front VPN) + self-service (Fase A2).

    Tres orígenes: importadas aprobadas desde Jira (`import_vehicle_requests`),
    alta a mano por la gestión, o **`mine`** — el usuario sin vehículo registra
    su solicitud con la clave del ticket de Jira para seguirla. El estado se
    sincroniza con Jira (`sync_jira_requests`); si no se puede saber, la
    administración **concede a mano** (`grant` = asignar vehículo) o rechaza.
    """

    serializer_class = VehicleRequestSerializer
    permission_classes = [ManagementReadWrite]
    queryset = VehicleRequest.objects.select_related("requester", "vehicle")
    filterset_fields = ["status", "requester", "vehicle", "requested_type"]
    search_fields = ["jira_key", "notes"]
    ordering_fields = ["created_at", "start_date"]

    @action(
        detail=False,
        methods=["get", "post"],
        permission_classes=[IsAuthenticated],
        # SEC9: el POST de la solicitud self-service llega desde internet.
        throttle_classes=[UserRateThrottle, PublicWriteThrottle],
    )
    def mine(self, request):
        """GET/POST /vehicle-requests/mine/ — la solicitud del propio usuario.

        - `GET`: sus solicitudes (para pintar el estado en el portón de acceso).
        - `POST`: crea su solicitud `pending` (o **actualiza la abierta**, p. ej.
          para añadir la `jira_key` cuando ya ha abierto el ticket). Vale para
          cualquier usuario autenticado, incluso sin rol todavía (recién creado
          por Google): es justo el caso "existe pero no tiene coche".
        """
        open_statuses = [VehicleRequestStatus.PENDING, VehicleRequestStatus.APPROVED]
        if request.method == "GET":
            requests = VehicleRequest.objects.filter(requester=request.user).order_by("-created_at")
            return Response(VehicleRequestMineSerializer(requests, many=True).data)
        existing = (
            VehicleRequest.objects.filter(requester=request.user, status__in=open_statuses)
            .order_by("-created_at")
            .first()
        )
        serializer = VehicleRequestMineSerializer(
            instance=existing, data=request.data, partial=existing is not None
        )
        serializer.is_valid(raise_exception=True)
        if existing is None:
            serializer.save(requester=request.user, status=VehicleRequestStatus.PENDING)
            code = status.HTTP_201_CREATED
        else:
            serializer.save()  # actualiza la abierta (jira_key, fechas, notas)
            code = status.HTTP_200_OK
        return Response(serializer.data, status=code)

    @action(detail=True, methods=["post"], permission_classes=[IsAdmin])
    def grant(self, request, pk=None):
        """POST /vehicle-requests/{id}/grant/ — concede el vehículo (Fase A2).

        Cuerpo: `{"vehicle": <id>}`. Atómico: asegura el rol conductor del
        solicitante, cierra la asignación vigente del vehículo, crea la nueva
        **aceptada**, emite el evento y marca la solicitud `assigned`. Es la vía
        manual cuando Jira no puede confirmar la concesión.
        """
        vehicle_request = self.get_object()
        if vehicle_request.status not in (
            VehicleRequestStatus.PENDING,
            VehicleRequestStatus.APPROVED,
        ):
            raise ValidationError({"status": "Solo se conceden solicitudes pendientes/aprobadas."})
        if vehicle_request.requester is None:
            raise ValidationError({"requester": "La solicitud no tiene solicitante."})
        try:
            vehicle = Vehicle.objects.get(pk=request.data.get("vehicle"))
        except (Vehicle.DoesNotExist, TypeError, ValueError) as exc:
            raise ValidationError({"vehicle": "Indica un vehículo válido."}) from exc
        if vehicle.state == VehicleState.BAJA:
            raise ValidationError({"vehicle": "No se puede conceder un vehículo en baja."})
        requester = vehicle_request.requester
        start = vehicle_request.start_date or timezone.localdate()
        with transaction.atomic():
            # El concedido pasa a ser conductor si aún no lo era (usuario nuevo).
            UserRole.objects.get_or_create(user=requester, role=Role.DRIVER)
            requester.__dict__.pop("role_values", None)  # invalida el caché por instancia
            current = (
                Assignment.objects.select_for_update()
                .filter(
                    vehicle=vehicle,
                    status=AssignmentStatus.ACCEPTED,
                    end_date__isnull=True,
                )
                .select_related("driver")
                .first()
            )
            old_driver = current.driver if current else None
            if current:
                current.status = AssignmentStatus.FINISHED
                current.end_date = start
                current.save(update_fields=["status", "end_date", "updated_at"])
            Assignment.objects.create(
                vehicle=vehicle,
                driver=requester,
                start_date=start,
                end_date=vehicle_request.end_date,
                status=AssignmentStatus.ACCEPTED,
            )
            events.emit_driver_change(vehicle, old_driver=old_driver, new_driver=requester)
            vehicle_request.vehicle = vehicle
            vehicle_request.status = VehicleRequestStatus.ASSIGNED
            vehicle_request.save(update_fields=["vehicle", "status", "updated_at"])
        return Response(self.get_serializer(vehicle_request).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAdmin])
    def reject(self, request, pk=None):
        """POST /vehicle-requests/{id}/reject/ — rechaza la solicitud (vía manual)."""
        vehicle_request = self.get_object()
        if vehicle_request.status not in (
            VehicleRequestStatus.PENDING,
            VehicleRequestStatus.APPROVED,
        ):
            raise ValidationError({"status": "Solo se rechazan solicitudes pendientes/aprobadas."})
        vehicle_request.status = VehicleRequestStatus.REJECTED
        vehicle_request.save(update_fields=["status", "updated_at"])
        return Response(self.get_serializer(vehicle_request).data)


# --- Summary de flota (dashboard G1) --------------------------------------


class FleetSummaryView(APIView):
    """GET /api/summary/ — agregados de la flota para el dashboard (Fase A1).

    Totales por estado/uso, asignados/sin asignar, coste mensual (contratos
    vigentes), facturado del mes y del anterior (tendencia), ITV en 30 días y
    vencidas, y alertas abiertas por tipo. Acotado por rol: el supervisor ve
    los agregados de **su grupo**.
    """

    permission_classes = [IsManagement]

    def get(self, request):
        return Response(metrics.fleet_summary(request.user))


class VehicleSummariesView(APIView):
    """GET /api/summary/vehicles/ — summaries de TODO el ámbito en UNA respuesta.

    O2 de OPTIMIZACION_Y_ERRORES.md: la app de campo hacía un
    GET /vehicles/<id>/summary/ por coche (N+1 por HTTP). Mismo scoping por rol
    que el listado de vehículos (conductor: los suyos; supervisor: su grupo;
    admin: toda la flota) y consultas acotadas en el servicio.
    """

    permission_classes = [IsManagementOrDriverReadOnly]

    def get(self, request):
        # PR5/PF4: `?ids=1,2,3` acota la respuesta a esos vehículos (dentro del
        # ámbito del rol) — quien necesita unos pocos no carga toda la flota.
        ids_param = (request.query_params.get("ids") or "").strip()
        ids = None
        if ids_param:
            try:
                ids = [int(x) for x in ids_param.split(",") if x.strip()]
            except ValueError as exc:
                raise ValidationError({"ids": "Lista de ids separados por comas."}) from exc
        return Response(metrics.vehicle_summaries(request.user, ids=ids))


# --- Informes / exportación (Épica 10) -----------------------------------


class ReportsView(APIView):
    """GET /api/reports/?kind=&fmt= — descarga un informe (Excel/CSV).

    `kind` ∈ {fleet, alerts, costs}; `fmt` ∈ {xlsx, csv}. (Se usa `fmt` y no
    `format`, que DRF reserva para la negociación de contenido.) Acotado por rol:
    el admin exporta toda la flota; el supervisor solo su grupo.
    """

    permission_classes = [IsManagement]

    def get(self, request):
        kind = request.query_params.get("kind", "fleet")
        fmt = request.query_params.get("fmt", "xlsx")
        if kind not in reports.REPORT_KINDS:
            valid = ", ".join(reports.REPORT_KINDS)
            return Response(
                {"detail": f"Informe desconocido: {kind}. Válidos: {valid}."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if fmt not in reports.FORMATS:
            return Response(
                {"detail": f"Formato no soportado: {fmt}. Válidos: {', '.join(reports.FORMATS)}."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        filename, content_type, payload = reports.render(kind, request.user, fmt)
        response = HttpResponse(payload, content_type=content_type)
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response


# --- Catálogos (lectura gestión, escritura admin) ------------------------


class CountryViewSet(DeactivateOnDestroyMixin, viewsets.ModelViewSet):
    queryset = Country.objects.all()
    serializer_class = CountrySerializer
    permission_classes = [AdminWriteManagementRead]
    search_fields = ["name"]


class BusinessUnitViewSet(DeactivateOnDestroyMixin, viewsets.ModelViewSet):
    queryset = BusinessUnit.objects.all()
    serializer_class = BusinessUnitSerializer
    permission_classes = [AdminWriteManagementRead]
    search_fields = ["code", "name"]


class ProjectViewSet(DeactivateOnDestroyMixin, viewsets.ModelViewSet):
    queryset = Project.objects.select_related("cost_center")
    serializer_class = ProjectSerializer
    permission_classes = [AdminWriteManagementRead]
    search_fields = ["project_name", "cost_center__code", "cost_center__name"]


class PepViewSet(DeactivateOnDestroyMixin, viewsets.ModelViewSet):
    queryset = Pep.objects.all()
    serializer_class = PepSerializer
    permission_classes = [AdminWriteManagementRead]
    search_fields = ["code", "name"]


class RentingViewSet(DeactivateOnDestroyMixin, viewsets.ModelViewSet):
    queryset = Renting.objects.all()
    serializer_class = RentingSerializer
    permission_classes = [AdminWriteManagementRead]
    search_fields = ["name"]


class BrandViewSet(DeactivateOnDestroyMixin, viewsets.ModelViewSet):
    queryset = Brand.objects.all()
    serializer_class = BrandSerializer
    permission_classes = [AdminWriteManagementRead]
    search_fields = ["name"]


class VehicleModelViewSet(DeactivateOnDestroyMixin, viewsets.ModelViewSet):
    """N5: `?brand=<id>` alimenta el desplegable dependiente del alta."""

    queryset = VehicleModel.objects.select_related("brand")
    serializer_class = VehicleModelSerializer
    permission_classes = [AdminWriteManagementRead]
    filterset_fields = ["brand"]
    search_fields = ["name", "brand__name"]


class CompanyViewSet(DeactivateOnDestroyMixin, viewsets.ModelViewSet):
    queryset = Company.objects.all()
    serializer_class = CompanySerializer
    permission_classes = [AdminWriteManagementRead]
    search_fields = ["code", "name", "description"]


# --- N10: plantillas de correo (gestor maestro, solo admin) -----------------


class EmailSignatureViewSet(DeactivateOnDestroyMixin, viewsets.ModelViewSet):
    queryset = EmailSignature.objects.all()
    serializer_class = EmailSignatureSerializer
    permission_classes = [IsAdmin]
    search_fields = ["name"]


class EmailTemplateViewSet(DeactivateOnDestroyMixin, viewsets.ModelViewSet):
    """CRUD de plantillas (N10b) + previsualización y envío de prueba (10c)."""

    queryset = EmailTemplate.objects.select_related("signature")
    serializer_class = EmailTemplateSerializer
    permission_classes = [IsAdmin]

    SAMPLE_CONTEXT = {
        "matricula": "1234KLM",
        "conductor": "Carlos Ruiz",
        "empresa": "ALD Automotive",
        "fecha_vencimiento": "2026-08-15",
        "km_exceso": "11.525",
        "mensaje": "Seguro en 15 día(s) (vence el 2026-08-15).",
    }

    @action(detail=True, methods=["post"])
    def preview(self, request, pk=None):
        """POST /email-templates/{id}/preview/ — render con datos de ejemplo."""
        from .services import mailer

        template = self.get_object()
        body = mailer.render(template.body_html, self.SAMPLE_CONTEXT)
        if template.signature is not None and template.signature.is_active:
            body += template.signature.body_html
        return Response(
            {
                "subject": mailer.render(template.subject, self.SAMPLE_CONTEXT),
                "body_html": body,
                "sample_context": self.SAMPLE_CONTEXT,
            }
        )

    @action(detail=True, methods=["post"])
    def test(self, request, pk=None):
        """POST /email-templates/{id}/test/ — envía la prueba a MI correo."""
        from django.core.mail import EmailMultiAlternatives
        from django.utils.html import strip_tags

        from .services import mailer

        if not request.user.email:
            raise ValidationError({"detail": "Tu usuario no tiene email configurado."})
        if not mailer.email_enabled():
            raise ValidationError(
                {"detail": "El correo saliente no está configurado (EMAIL_HOST)."}
            )
        template = self.get_object()
        subject = mailer.render(template.subject, self.SAMPLE_CONTEXT)
        body = mailer.render(template.body_html, self.SAMPLE_CONTEXT)
        if template.signature is not None and template.signature.is_active:
            body += template.signature.body_html
        message = EmailMultiAlternatives(
            subject=f"[PRUEBA] {subject}",
            body=strip_tags(body),
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[request.user.email],
        )
        message.attach_alternative(body, "text/html")
        message.send(fail_silently=False)
        return Response({"sent_to": request.user.email})


class EmailLogViewSet(viewsets.ReadOnlyModelViewSet):
    """Traza de envíos (soporte). Solo lectura, solo admin."""

    queryset = EmailLog.objects.select_related("alert")
    serializer_class = EmailLogSerializer
    permission_classes = [IsAdmin]
    filterset_fields = ["status", "template_key"]
    search_fields = ["recipient", "subject"]
