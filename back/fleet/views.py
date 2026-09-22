from datetime import timedelta
from decimal import Decimal

from auditlog.models import LogEntry
from django.conf import settings
from django.contrib.contenttypes.models import ContentType
from django.db import models, transaction
from django.http import Http404, HttpResponse
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from django.utils.text import slugify
from django_filters import rest_framework as filters
from django_filters.widgets import BooleanWidget
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
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
    IsManagementOrDriverCreate,
    IsManagementOrDriverReadOnly,
    ManagementOrDriverReadWrite,
    ManagementReadWrite,
)
from core.throttling import PublicWriteThrottle

from .idempotency import IdempotentCreateMixin, run_idempotent
from .models import (
    Alert,
    Assignment,
    Brand,
    BusinessUnit,
    Company,
    Contract,
    Country,
    Document,
    DocumentDeletionRequest,
    DriverChangeRequest,
    EmailLog,
    EmailSignature,
    EmailTemplate,
    Event,
    FuelConsumption,
    FuelType,
    Incident,
    Invoice,
    InvoiceAllocation,
    KmReading,
    MaintenancePlan,
    MaintenanceProgram,
    NotificationSchedule,
    Pep,
    ProfileChangeRequest,
    Project,
    Renting,
    Site,
    SupervisorPeriod,
    Vehicle,
    VehicleLink,
    VehicleModel,
    VehicleRequest,
    VehicleUsage,
    Workshop,
    driver_assignment_clash,
    driver_clash_message,
)
from .models.enums import (
    AlertLevel,
    AlertStatus,
    AlertType,
    AssignmentStatus,
    DocumentDeletionStatus,
    DocumentRequestKind,
    DocumentStatus,
    DriverChangeStatus,
    EventType,
    IncidentStatus,
    IncidentType,
    ProfileChangeStatus,
    VehicleRequestStatus,
    VehicleState,
)
from .scoping import default_responsible, readable_documents, users_for, vehicles_for
from .selectors import current_assignment_q
from .serializers import (
    AlertSerializer,
    AssignmentSerializer,
    BrandSerializer,
    BusinessUnitSerializer,
    CompanySerializer,
    ContractSerializer,
    CountrySerializer,
    DocumentDeletionRequestSerializer,
    DocumentSerializer,
    DriverChangeRequestSerializer,
    EmailLogSerializer,
    EmailSignatureSerializer,
    EmailTemplateSerializer,
    EventSerializer,
    FuelConsumptionSerializer,
    FuelTypeSerializer,
    IncidentResolutionSerializer,
    IncidentSerializer,
    InvoiceAllocateSerializer,
    InvoiceAllocationSerializer,
    InvoiceSerializer,
    KmReadingSerializer,
    LogEntrySerializer,
    MaintenancePlanSerializer,
    MaintenanceProgramSerializer,
    NotificationScheduleSerializer,
    PepSerializer,
    ProfileChangeRequestSerializer,
    ProjectSerializer,
    RentingSerializer,
    SiteSerializer,
    SupervisorPeriodSerializer,
    UsageSplitSerializer,
    VehicleLinkSerializer,
    VehicleModelSerializer,
    VehicleRequestMineSerializer,
    VehicleRequestSerializer,
    VehicleSerializer,
    VehicleUsageSerializer,
    WorkshopSerializer,
    sanitize_email_html,
)
from .services import (
    document_requests,
    driver_requests,
    events,
    importer,
    incidents,
    insurance,
    itv,
    mailer,
    maintenance,
    metrics,
    notifications,
    profile_requests,
    reports,
    returns,
    substitution,
    supervisors,
    vehicle_requests,
)
from .services.archiver import (
    INLINE_MIME_TYPES,
    ExternalDeleteError,
    archive_document,
    extension_of,
    fetch_document,
    purge_document,
    verify_documents,
)


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
        return self.scope_queryset(qs, user)

    def scope_queryset(self, qs, user):
        """Filtro de ámbito del NO-admin. Sobrescríbelo si el recurso puede
        colgar de algo más que de un vehículo (p. ej. documentos personales)."""
        vehicle_ids = vehicles_for(user).values_list("id", flat=True)
        lookup = "id__in" if self.vehicle_lookup == "" else f"{self.vehicle_lookup}__in"
        return qs.filter(**{lookup: vehicle_ids})

    def _assert_in_scope(self, serializer) -> None:
        """SEC1/M1: el no-admin solo escribe sobre vehículos de su ámbito.

        Sin esto, un PATCH {"vehicle": <ajeno>} movía el recurso (lectura,
        incidencia, documento…) fuera del ámbito del autor.

        M1: se resuelve el vehículo por `vehicle_lookup`, no por la clave
        literal `vehicle`. Con `main_vehicle` (vínculos) o `invoice__vehicle`
        (imputaciones) el `get("vehicle")` devolvía siempre None y la
        comprobación se saltaba **en silencio**: hoy esos dos son de escritura
        solo-admin, así que no era explotable, pero era una trampa para el
        siguiente recurso que colgara de un vehículo por otro campo.
        """
        user = self.request.user
        if user.is_admin or not self.vehicle_lookup:
            return
        data = serializer.validated_data
        # Primer salto del path (`vehicle`, `main_vehicle`, `invoice`…).
        first = self.vehicle_lookup.split("__")[0]
        target = data.get(first)
        if target is None:
            return
        # Si el path tiene más saltos, se recorre hasta el vehículo.
        for step in self.vehicle_lookup.split("__")[1:]:
            target = getattr(target, step, None)
            if target is None:
                return
        if not vehicles_for(user).filter(pk=target.pk).exists():
            raise PermissionDenied("El vehículo está fuera de tu ámbito.")

    def perform_create(self, serializer):
        self._assert_in_scope(serializer)
        serializer.save(**self.extra_create_kwargs())

    def perform_update(self, serializer):
        self._assert_in_scope(serializer)
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
        # Vehículos con asignación ACEPTADA vigente (BG12: contar cualquier
        # asignación incluía PROPUESTAS — un coche salía "asignado" y sin
        # conductor en la misma fila; mismo criterio que current_driver_map,
        # fin programado incluido — R3-02).
        active = Assignment.objects.filter(current_assignment_q()).values("vehicle_id")
        return queryset.filter(id__in=active) if value else queryset.exclude(id__in=active)


class VehicleViewSet(ScopedByVehicleMixin, viewsets.ModelViewSet):
    """CRUD de vehículos.

    - Admin: CRUD sobre toda la flota.
    - Supervisor: lectura de **su grupo** (`supervisor=user`) — HU-2.8.
    - Conductor: lectura de sus vehículos asignados.

    Escritura solo admin (no alta/baja para el supervisor). Los vehículos en
    `baja` no salen por defecto; se ven con `?state=retired` (el valor real
    del enum) o con `?include_baja=1`.
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
    # C7: `next_itv_date` e `insurance_expiry_date` FALTABAN, y el panel las
    # pedía para sus modales de vencimientos: `OrderingFilter` descarta en
    # silencio lo que no está en la lista y cae al orden por defecto, así que la
    # gestión veía "los más próximos a vencer" ordenados por matrícula.
    ordering_fields = [
        "plate",
        "state",
        "year",
        "created_at",
        "next_itv_date",
        "insurance_expiry_date",
    ]
    ordering = ["plate"]

    def get_queryset(self):
        qs = (
            super()
            .get_queryset()
            # GAP-4: `site` viaja como nombre (site_display) → sin el join
            # sería una consulta por fila del listado.
            .select_related("supervisor", "business_unit", "project", "cost_center", "site")
        )
        # BG: ocultar las bajas es cosa del LISTADO. En una petición de detalle
        # —`retrieve` o cualquier acción sobre un vehículo concreto (`summary`,
        # `history`, `set-driver`…)— el id es explícito y el vehículo debe
        # resolverse aunque esté de baja; si se filtra aquí, abrir la ficha de un
        # coche dado de baja devolvía 404 «No Vehicle matches the given query».
        if self.action == "list":
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
        expected_parsed = parse_datetime(str(expected)) if expected else None
        old_state = instance.state
        old_site = instance.site
        old_supervisor = instance.supervisor
        old_insurance = instance.insurance_expiry_date
        with transaction.atomic():
            # R5-05: la comparación va DENTRO de la transacción y sobre la fila
            # bloqueada: dos PATCH simultáneos con el mismo `expected_updated_at`
            # ya no pasan los dos el corte.
            locked = Vehicle.objects.select_for_update().get(pk=instance.pk)
            if expected and (expected_parsed is None or expected_parsed != locked.updated_at):
                raise Conflict()
            super().perform_update(serializer)
            updated = serializer.instance
            # GAP-4: cambiar la sede emite su evento con la ubicación anterior
            # y la nueva (el subtipo existía; ahora por fin lo alimenta algo).
            if updated.site != old_site:
                events.emit_location_change(updated, old_site, updated.site)
            # Histórico de supervisores: el relevo (incluido quitarlo) deja su
            # evento venga del modal (set-driver) o del PATCH de la ficha.
            if (old_supervisor.pk if old_supervisor else None) != updated.supervisor_id:
                events.emit_supervisor_change(updated, old_supervisor, updated.supervisor)
                # El histórico con fechas sigue al vigente: cierra el periodo
                # anterior hoy y abre el del nuevo.
                supervisors.apply_supervisor_change(updated, updated.supervisor)
            # N2: adelantar el vencimiento del seguro desde la ficha cierra las
            # alertas de seguro que quedaron atrás (antes seguían abiertas para
            # siempre). Sin evento: la renovación como acto va por
            # `renew-insurance`; esto es corrección de dato.
            new_insurance = updated.insurance_expiry_date
            if new_insurance and new_insurance != old_insurance:
                insurance.close_alerts_before(updated, new_insurance, actor=self.request.user)
            if updated.state != old_state:
                # Cambio de estado → evento (HU-1.5/1.6), con motivo opcional.
                # B4: `change_date` es la fecha CON EFECTO del cambio (la baja
                # puede ser de un día anterior); sin ella, el cliente la metía
                # dentro del motivo como texto castellano.
                when = parse_date(str(self.request.data.get("change_date", "") or ""))
                events.emit_vehicle_state_change(
                    updated,
                    old_state,
                    updated.state,
                    reason=str(self.request.data.get("change_reason", "")),
                    when=when,
                )
                # Editar el estado a BAJA es una baja como cualquier otra: quita
                # el conductor (con su histórico), y cierra sustituciones,
                # alertas y contrato. Sin esto el coche salía del listado pero
                # seguía «ocupando» al conductor y lo bloqueaba para otro coche.
                if updated.state == VehicleState.BAJA:
                    returns.close_vehicle_relations(updated, when or timezone.localdate())

    def perform_destroy(self, instance):
        """N7: un vehículo NO se borra — se da de BAJA.

        `baja` es el estado terminal de la flota: sale de los listados (se ve
        con `?include_baja=1`) y aparece en el espacio de erratas, donde la
        administración puede reactivarlo y solo un superusuario purgarlo de
        verdad. Borrar la fila se llevaría en cascada sus facturas, documentos,
        lecturas de km, contratos, incidencias y TODO su histórico de eventos.
        """
        if instance.state == VehicleState.BAJA:
            return  # Idempotente: ya estaba de baja, no hay nada que hacer.
        # El motivo llega por query (`?reason=`, los DELETE sin cuerpo del
        # front) o por cuerpo JSON, igual que en `DeactivateOnDestroyMixin`.
        reason = str(self.request.query_params.get("reason", "") or "")
        if not reason and isinstance(self.request.data, dict):
            reason = str(self.request.data.get("reason", "") or "")
        # La baja quita el conductor (con su histórico), cierra sustituciones,
        # alertas y contrato, y emite el evento de estado — en una transacción.
        with transaction.atomic():
            returns.retire_vehicle(instance, reason=reason)

    # --- Importación masiva (IMPORTACION_MASIVA.md) -------------------------
    # detect-columns → preview-import → bulk-create (tandas del cliente).

    @action(
        detail=False,
        methods=["post"],
        url_path="detect-columns",
        permission_classes=[IsAdmin],
        parser_classes=[MultiPartParser, FormParser],
    )
    def detect_columns(self, request):
        """POST multipart {file} → cabeceras + auto-mapeo por alias."""
        parsed = importer.read_uploaded_file(request.FILES.get("file"))
        return Response(
            {
                "columns": parsed["headers"],
                "auto_mapping": importer.detect_mapping(
                    parsed["headers"], importer.VEHICLE_ALIASES
                ),
                "total_rows": parsed["total_rows"],
                "omitted_count": parsed["omitted_count"],
                "sheet_names": parsed["sheet_names"],
            }
        )

    @action(
        detail=False,
        methods=["post"],
        url_path="preview-import",
        permission_classes=[IsAdmin],
        parser_classes=[MultiPartParser, FormParser],
    )
    def preview_import(self, request):
        """POST multipart {file, mapping, defaults} → valida SIN escribir.

        Devuelve `records` (solo filas válidas, con `_row`) listos para
        reenviarse por tandas a `bulk-create`, y los avisos por cubos.
        """
        parsed = importer.read_uploaded_file(request.FILES.get("file"))
        normalizer = importer.VehicleRowNormalizer()
        mapping = importer.parse_client_mapping(
            request.data.get("mapping"), set(importer.VEHICLE_ALIASES)
        )
        defaults = importer.parse_client_defaults(request.data.get("defaults"))
        return Response(importer.build_preview(parsed, mapping, defaults, normalizer))

    @action(
        detail=False,
        methods=["post"],
        url_path="bulk-create",
        permission_classes=[IsAdmin],
    )
    def bulk_create(self, request):
        """POST {rows} (≤1000) → crea con savepoint por fila + evento de alta."""
        result = importer.run_bulk_create(
            request.data.get("rows"),
            lambda data: self.get_serializer(data=data),
            on_created=events.emit_vehicle_created,
        )
        return Response(result)

    @action(detail=True, methods=["post"], url_path="return", permission_classes=[IsAdmin])
    def return_vehicle(self, request, pk=None):
        """POST /api/vehicles/{id}/return/ — devolución guiada (GAP-7).

        Una sola operación transaccional: lectura final + `km_end`, cierre del
        contrato vigente, fin de las asignaciones en curso, baja con su evento
        y cálculo del exceso de km con su penalización estimada. Cuerpo:
        `{km_end?, end_date?, reason?}`.
        """
        vehicle = self.get_object()
        data = request.data if isinstance(request.data, dict) else {}
        km_end = data.get("km_end")
        if km_end in ("", None):
            km_end = None
        else:
            try:
                km_end = int(km_end)
            except (TypeError, ValueError) as exc:
                raise ValidationError({"km_end": "Debe ser un número entero de km."}) from exc
            if km_end < 0:
                raise ValidationError({"km_end": "Los km no pueden ser negativos."})
        end_date = parse_date(str(data.get("end_date", "") or "")) or None
        with transaction.atomic():
            summary = returns.return_vehicle(
                vehicle,
                km_end=km_end,
                end_date=end_date,
                reason=str(data.get("reason", "") or ""),
            )
        return Response(summary)

    @action(
        detail=True,
        methods=["post"],
        url_path="release-substitute",
        permission_classes=[IsManagement],
    )
    def release_substitute(self, request, pk=None):
        """POST /api/v1/vehicles/{id}/release-substitute/ — vuelta al servicio.

        Suelta el coche de sustitución que le cubre y devuelve este a `Activo`,
        que es una sola decisión: se toma al cerrar la petición que lo paró, y
        entra desde los seis modales de «Resolver». Cuerpo: `{date?}` (por
        defecto hoy). Si queda otra petición abierta que lo bloquea, el
        sustituto se libera igual pero el estado NO cambia: la respuesta dice
        cuál lo impide (`blocked_by`).
        """
        vehicle = self.get_object()
        data = request.data if isinstance(request.data, dict) else {}
        day = parse_date(str(data.get("date", "") or "")) or None
        result = substitution.release_substitute(vehicle, actor=request.user, when=day)
        result["blocked_by"] = substitution.blocked_payload(result.get("blocked_by"))
        return Response(result)

    @action(detail=True, methods=["post"], url_path="renew-insurance", permission_classes=[IsAdmin])
    def renew_insurance(self, request, pk=None):
        """POST /api/v1/vehicles/{id}/renew-insurance/ — renovación del seguro (N2).

        `{expiry_date*, notes?}`. Solo admin: el seguro es asunto de
        administración (como sus alertas). Aplica el vencimiento nuevo, emite
        `insurance_renewal` y cierra las alertas de seguro CON actor. Idempotente:
        la misma fecha no cambia nada (`changed: false`); una anterior es 400 (la
        corrección de una fecha va por la ficha). La póliza, si la hay, se sube
        aparte como `Document` de seguro y no duplica el evento. Responde el
        vehículo + `previous_expiry_date`, `changed`, `event`, `alerts_resolved`.
        """
        vehicle = self.get_object()
        if vehicle.state == VehicleState.BAJA:
            raise ValidationError({"vehicle": "El vehículo está de baja."})
        expiry = parse_date(str(request.data.get("expiry_date") or ""))
        if expiry is None:
            raise ValidationError({"expiry_date": "Indica la nueva fecha de vencimiento."})
        current = vehicle.insurance_expiry_date
        if current is not None and expiry < current:
            raise ValidationError(
                {
                    "expiry_date": (
                        "La renovación no puede adelantar el vencimiento; "
                        "corrige la fecha desde la ficha."
                    )
                }
            )
        notes = str(request.data.get("notes", "") or "").strip()
        with transaction.atomic():
            result = insurance.apply_new_expiry(
                vehicle, expiry, actor=request.user, notes=notes, source="renewal"
            )
        data = self.get_serializer(vehicle).data
        data["previous_expiry_date"] = result["previous"]
        data["changed"] = result["changed"]
        data["event"] = result["event"].pk if result["event"] else None
        data["alerts_resolved"] = result["alerts_resolved"]
        return Response(data)

    @action(detail=True, methods=["post"], url_path="schedule-itv", permission_classes=[IsAdmin])
    def schedule_itv(self, request, pk=None):
        """POST /api/v1/vehicles/{id}/schedule-itv/ — programa la próxima ITV.

        `{date*, postal_code?}`. La cita es UNA por vehículo (`next_itv_date`):
        si ya hay fecha esto la CORRIGE, no añade otra. Queda marcada como
        manual para que el job `refresh_next_itv` no la borre —el histórico de
        `EventItv` no la conoce— y registrar la ITV real vuelve a dejar el
        mando al histórico. El CP preferente (5 cifras) es la ubicación desde
        la que un tercero busca la estación más cercana.

        Responde el vehículo + `previous_next_itv_date`, `changed` y
        `alerts_resolved` (los avisos de la cita anterior se cierran con actor).
        """
        vehicle = self.get_object()
        if vehicle.state == VehicleState.BAJA:
            raise ValidationError({"vehicle": "El vehículo está de baja."})
        due = parse_date(str(request.data.get("date") or ""))
        if due is None:
            raise ValidationError({"date": "Indica la fecha de la ITV."})
        postal_code = str(request.data.get("postal_code", "") or "").strip()
        if postal_code and (not postal_code.isdigit() or len(postal_code) != 5):
            raise ValidationError({"postal_code": "Indica un código postal de 5 cifras."})
        result = itv.schedule_itv(vehicle, due, actor=request.user, postal_code=postal_code)
        data = self.get_serializer(vehicle).data
        data["previous_next_itv_date"] = result["previous"]
        data["changed"] = result["changed"]
        data["alerts_resolved"] = result["alerts_resolved"]
        return Response(data)

    @action(detail=True, methods=["get"], permission_classes=[IsManagement])
    def history(self, request, pk=None):
        """GET /api/vehicles/{id}/history/ — auditoría EXHAUSTIVA del vehículo.

        Además de los cambios en la propia ficha (Vehicle), agrega la auditoría
        de los modelos relacionados (contrato, lecturas de km, conductor/reparto,
        vínculos de sustitución, facturas, incidencias y documentos) para que el
        histórico refleje cualquier modificación que afecte al vehículo, no solo
        las de su tabla. Cada entrada incluye el modelo de origen (`model`).
        """
        vehicle = self.get_object()
        # Cambios en la propia ficha + en todo lo colgado del vehículo.
        related_querysets = (
            Contract.objects.filter(vehicle=vehicle),
            KmReading.objects.filter(vehicle=vehicle),
            Assignment.objects.filter(vehicle=vehicle),
            VehicleUsage.objects.filter(vehicle=vehicle),
            Invoice.objects.filter(vehicle=vehicle),
            Incident.objects.filter(vehicle=vehicle),
            Document.objects.filter(vehicle=vehicle),
            VehicleLink.objects.filter(
                models.Q(main_vehicle=vehicle) | models.Q(substitute_vehicle=vehicle)
            ),
        )
        # M4: UNA consulta con `(content_type, object_id IN subconsulta)` por
        # modelo. Antes se traían a memoria los ids de LogEntry de los nueve
        # modelos (`get_for_objects` hace `count()` + `values_list` cada vez: 24
        # consultas) para acabar filtrando por un `pk__in` de miles de enteros,
        # y la paginación llegaba cuando ya se había materializado el conjunto.
        # `object_id` es el entero que usa auditlog cuando la pk es int (ver
        # `LogEntryManager.get_for_object`), así que la subconsulta encaja.
        criteria = models.Q(
            content_type=ContentType.objects.get_for_model(Vehicle), object_id=vehicle.pk
        )
        for related in related_querysets:
            criteria |= models.Q(
                content_type=ContentType.objects.get_for_model(related.model),
                object_id__in=models.Subquery(related.values("pk")),
            )
        entries = (
            LogEntry.objects.filter(criteria)
            .select_related("actor", "content_type")
            .order_by("-timestamp")
        )
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
        from .selectors import active_link_blocking, active_link_q

        vehicle = self.get_object()
        if not vehicle.is_substitute:
            raise ValidationError({"is_substitute": "El vehículo ya es de flota."})
        busy = VehicleLink.objects.filter(active_link_q(), substitute_vehicle=vehicle).first()
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

    @action(detail=True, methods=["post"], url_path="set-driver", permission_classes=[IsAdmin])
    def set_driver(self, request, pk=None):
        """POST /api/v1/vehicles/{id}/set-driver/ — cambia el conductor, atómico.

        A6: el front lo hacía en tres pasos (PATCH del supervisor → crear
        propuesta → aceptarla) con un `deleteAssignment` de compensación si algo
        fallaba. Eso dejaba propuestas huérfanas cuando la compensación también
        fallaba (y una propuesta huérfana daba ámbito al conductor, C1), podía
        guardar el supervisor sin el conductor, y **borraba físicamente** una
        asignación desde la ficha, cuando el borrado definitivo vive solo en
        Ajustes (R0).

        Cuerpo: `{driver, start_date?, supervisor?, expected_updated_at?}`.
        - `driver: null` LIBERA el vehículo (cierra la asignación vigente).
        - `supervisor` solo se toca si viene en el cuerpo (`null` = ninguno).
        - Mismo cierre que `assignments/{id}/accept/`: fin de la vigente = inicio
          de la nueva, evento `driver_change` con old→new, todo o nada.
        """
        vehicle = self.get_object()
        if vehicle.state == VehicleState.BAJA:
            raise ValidationError({"vehicle": "El vehículo está de baja."})

        # N9: un principal bloqueado por sustitución no admite asignaciones.
        from .selectors import active_link_blocking

        link = active_link_blocking(vehicle)
        if link is not None:
            raise ValidationError(
                {
                    "vehicle": (
                        "Vehículo bloqueado por sustitución — opera sobre "
                        f"{link.substitute_vehicle.plate}."
                    )
                }
            )

        # Bloqueo optimista opt-in, igual que el PATCH de la ficha. Se compara
        # dentro de la transacción, sobre la fila bloqueada (R5-05).
        expected = request.data.get("expected_updated_at")
        expected_parsed = parse_datetime(str(expected)) if expected else None

        driver = None
        if "driver" not in request.data and "supervisor" not in request.data:
            raise ValidationError({"detail": "Indica `driver` y/o `supervisor`."})
        driver_id = request.data.get("driver")
        if driver_id not in (None, "", "null"):
            from django.contrib.auth import get_user_model

            driver = get_user_model().objects.filter(pk=driver_id, is_active=True).first()
            if driver is None:
                raise ValidationError({"driver": "Conductor no válido."})
            if not driver.is_driver:
                raise ValidationError({"driver": "El usuario asignado no tiene rol de conductor."})

        start = parse_date(str(request.data.get("start_date") or "")) or timezone.localdate()

        with transaction.atomic():
            vehicle = (
                Vehicle.objects.select_for_update().select_related("supervisor").get(pk=vehicle.pk)
            )
            if expected and (expected_parsed is None or expected_parsed != vehicle.updated_at):
                raise Conflict()
            if "supervisor" in request.data:
                supervisor_id = request.data.get("supervisor") or None
                if supervisor_id is not None:
                    from django.contrib.auth import get_user_model

                    candidate = get_user_model().objects.filter(pk=supervisor_id).first()
                    if candidate is None:
                        raise ValidationError({"supervisor": "Supervisor no válido."})
                    # R5-03: el responsable tiene que poder ver el coche.
                    supervisors.validate_supervisor(candidate)
                old_supervisor = vehicle.supervisor
                if (old_supervisor.pk if old_supervisor else None) != supervisor_id:
                    vehicle.supervisor_id = supervisor_id
                    vehicle.save(update_fields=["supervisor", "updated_at"])
                    # Histórico de supervisores: el relevo (incluido quitarlo)
                    # deja su evento, igual que el cambio de conductor…
                    events.emit_supervisor_change(vehicle, old_supervisor, vehicle.supervisor)
                    # …y mueve los periodos con fechas.
                    supervisors.apply_supervisor_change(vehicle, vehicle.supervisor)

            # R3-02: la vigente a cerrar puede tener fin PROGRAMADO (grant con
            # fechas); el criterio es el mismo que da el ámbito.
            current = (
                Assignment.objects.select_for_update()
                .filter(current_assignment_q(), vehicle=vehicle)
                .select_related("driver")
                .first()
            )
            old_driver = current.driver if current else None
            if "driver" in request.data and (driver is None or old_driver != driver):
                if current is not None:
                    current.status = AssignmentStatus.FINISHED
                    current.end_date = start
                    current.save(update_fields=["status", "end_date", "updated_at"])
                if driver is not None:
                    # Un coche por conductor a la vez (+ sustituto aparte): si
                    # ya lleva otro, la gestión debe cerrarlo (o devolverlo)
                    # antes — no se le quita en silencio.
                    clash = driver_assignment_clash(
                        driver.pk,
                        is_substitute=vehicle.is_substitute,
                        start_date=start,
                        exclude_vehicle_id=vehicle.pk,
                    )
                    if clash:
                        raise ValidationError({"driver": driver_clash_message(clash)})
                    Assignment.objects.create(
                        vehicle=vehicle,
                        driver=driver,
                        start_date=start,
                        status=AssignmentStatus.ACCEPTED,
                    )
                if old_driver != driver:
                    events.emit_driver_change(vehicle, old_driver=old_driver, new_driver=driver)

        vehicle.refresh_from_db()
        return Response(self.get_serializer(vehicle).data)

    @action(detail=True, methods=["post"], permission_classes=[IsManagement])
    def notify(self, request, pk=None):
        """POST /api/v1/vehicles/{id}/notify/ — envía un comunicado por email al
        conductor vigente y/o al supervisor del vehículo.

        Best-effort (como el mailer de alertas): un fallo de SMTP no lanza 500;
        cada intento queda trazado en `EmailLog`. Devuelve qué se envió y qué se
        omitió (sin email / correo deshabilitado / fallo)."""
        import html

        from django.core.mail import EmailMultiAlternatives, get_connection
        from django.utils.html import strip_tags

        from .selectors import current_driver_map
        from .services import mailer

        vehicle = self.get_object()
        message = (request.data.get("message") or "").strip()
        # `body`: cuerpo retocado en el modal antes de enviar. Se sanea igual
        # que el de una plantilla (nh3) porque acaba en el correo tal cual.
        body_override = (request.data.get("body") or "").strip()
        if body_override:
            body_override = sanitize_email_html(body_override)
        # `template_key`: si se informa, asunto/cuerpo salen de la plantilla de
        # correo (10b) y el mensaje libre es opcional (variable {{mensaje}}). Sin
        # plantilla, el texto libre es el cuerpo y es obligatorio.
        template_key = (request.data.get("template_key") or "").strip()
        if not template_key and not message and not body_override:
            raise ValidationError({"message": "El comunicado no puede estar vacío."})
        # `lang`: es | en | both. Con `both` van las dos versiones en un mismo
        # correo. Solo afecta a la plantilla; el texto libre va tal cual.
        lang = (request.data.get("lang") or "es").strip()
        if lang not in mailer.NOTICE_LANGS:
            raise ValidationError({"lang": "Idioma no válido."})
        to_driver = bool(request.data.get("to_driver"))
        to_supervisor = bool(request.data.get("to_supervisor"))
        to_admin = bool(request.data.get("to_admin"))
        # `to_renting`: email de la compañía de renting del contrato vigente
        # (destinatario típico del aviso de seguro, N10a).
        to_renting = bool(request.data.get("to_renting"))
        extra_email = (request.data.get("email") or "").strip()
        if extra_email:
            # R5-10: un destinatario LIBRE desde el SMTP corporativo es un vector
            # de suplantación; solo administración, y siempre con formato válido.
            from django.core.exceptions import ValidationError as DjangoValidationError
            from django.core.validators import validate_email

            if not request.user.is_admin:
                raise ValidationError(
                    {"email": "Solo administración puede añadir un destinatario libre."}
                )
            try:
                validate_email(extra_email)
            except DjangoValidationError as exc:
                raise ValidationError({"email": "Dirección de correo no válida."}) from exc
        if not (to_driver or to_supervisor or to_admin or to_renting or extra_email):
            raise ValidationError({"detail": "Elige al menos un destinatario."})

        targets = []  # (rol, email)
        if to_driver:
            driver = current_driver_map([vehicle.id]).get(vehicle.id)
            targets.append(("driver", driver.email if driver else ""))
        if to_supervisor:
            sup = vehicle.supervisor
            targets.append(("supervisor", sup.email if sup else ""))
        if to_admin:
            # Todos los administradores activos (incluye superusuarios).
            from django.contrib.auth import get_user_model
            from django.db.models import Q

            from accounts.models import Role

            admin_emails = list(
                get_user_model()
                .objects.filter(is_active=True)
                .filter(Q(roles__role=Role.ADMIN) | Q(is_superuser=True))
                .exclude(email="")
                .values_list("email", flat=True)
                .distinct()
            )
            if admin_emails:
                targets.extend(("admin", e) for e in admin_emails)
            else:
                targets.append(("admin", ""))
        if to_renting:
            contract = (
                vehicle.contracts.filter(end_date__isnull=True, is_active=True)
                .order_by("-start_date")
                .first()
                or vehicle.contracts.filter(is_active=True).order_by("-start_date").first()
            )
            renting = contract.renting if contract else None
            targets.append(("renting", renting.email if renting else ""))
        if extra_email:
            targets.append(("otro", extra_email))

        if template_key:
            # Asunto/cuerpo desde la plantilla (o texto por defecto si no existe).
            notice = mailer.render_vehicle_notice(
                vehicle, template_key, message, lang, body_override
            )
            subject, body_html, log_key = notice.subject, notice.body_html, notice.used_key
            override = (request.data.get("subject") or "").strip()
            if override:
                subject = override
            subject = subject[:200]
        else:
            log_key = "comunicado"
            subject = (
                request.data.get("subject") or f"[Flota] {vehicle.plate} · Comunicado"
            ).strip()[:200]
            safe = html.escape(message).replace("\n", "<br>")
            body_html = (
                f"<p>Comunicado sobre el vehículo <strong>{html.escape(vehicle.plate)}</strong> "
                f"(estado: {html.escape(vehicle.get_state_display())}):</p>"
                f"<p>{safe}</p>"
            )

        enabled = mailer.email_enabled()
        sent, skipped, seen = [], [], set()
        # R3-13: una conexión SMTP para todo el comunicado (un envío a 5
        # destinatarios abría y cerraba 5 conexiones: handshake + TLS + auth
        # por correo). El error por destinatario se sigue tratando por fila.
        connection = get_connection()
        try:
            for role, email in targets:
                if not email:
                    skipped.append({"role": role, "reason": "sin_email"})
                    EmailLog.objects.create(
                        template_key=log_key,
                        recipient="",
                        subject=subject,
                        status=EmailLog.Status.SKIPPED,
                        error=f"{role} sin email",
                    )
                    continue
                if email in seen:
                    continue
                seen.add(email)
                if not enabled:
                    skipped.append({"role": role, "email": email, "reason": "correo_deshabilitado"})
                    EmailLog.objects.create(
                        template_key=log_key,
                        recipient=email,
                        subject=subject,
                        status=EmailLog.Status.SKIPPED,
                        error="Correo saliente no configurado (EMAIL_HOST).",
                    )
                    continue
                try:
                    msg = EmailMultiAlternatives(
                        subject=subject,
                        body=strip_tags(body_html),
                        from_email=settings.DEFAULT_FROM_EMAIL,
                        to=[email],
                        connection=connection,
                    )
                    msg.attach_alternative(body_html, "text/html")
                    msg.send(fail_silently=False)
                    sent.append({"role": role, "email": email})
                    EmailLog.objects.create(
                        template_key=log_key,
                        recipient=email,
                        subject=subject,
                        status=EmailLog.Status.SENT,
                    )
                except Exception as exc:  # noqa: BLE001 — best-effort por diseño
                    skipped.append({"role": role, "email": email, "reason": "fallo_envio"})
                    EmailLog.objects.create(
                        template_key=log_key,
                        recipient=email,
                        subject=subject,
                        status=EmailLog.Status.FAILED,
                        error=str(exc)[:1000],
                    )
        finally:
            try:
                connection.close()
            except Exception:  # noqa: BLE001 — cerrar la conexión es best-effort
                pass
        return Response({"sent": sent, "skipped": skipped})

    @action(detail=True, methods=["post"], permission_classes=[IsManagement])
    def remind(self, request, pk=None):
        """POST /api/v1/vehicles/{id}/remind/ — recordatorio al conductor por
        los km sin registrar, la ITV o el mantenimiento (app de campo, M6).

        Dos canales, cada uno opt-in: `send_email` (inmediato y best-effort,
        con plantilla si existe y traza en `EmailLog`) y `create_alert` (alerta
        en la app con su push, idempotente por día vía `dedup_key`). El correo
        automático del motor de alertas NO se encola aquí (`queue_email=False`):
        el email es la casilla del modal, encolar además lo duplicaría.
        """
        from .selectors import current_driver_map
        from .services import alerts as alerts_service
        from .services import mailer
        from .services.metrics import _maintenance_due_map

        vehicle = self.get_object()
        kind = (request.data.get("kind") or "").strip()
        if kind not in {AlertType.KM_READING_PENDING, AlertType.ITV_DUE, AlertType.MAINTENANCE_DUE}:
            raise ValidationError({"kind": "Tipo de recordatorio no válido."})
        send_email = bool(request.data.get("send_email"))
        create_alert = bool(request.data.get("create_alert"))
        if not send_email and not create_alert:
            raise ValidationError({"detail": "Elige al menos un canal (correo o alerta)."})
        message = (request.data.get("message") or "").strip()

        today = timezone.localdate()
        due = None
        if kind == AlertType.ITV_DUE:
            due = vehicle.next_itv_date
        elif kind == AlertType.MAINTENANCE_DUE:
            due = _maintenance_due_map([vehicle.id]).get(vehicle.id)

        base = {
            AlertType.KM_READING_PENDING: "Recordatorio: lectura de km pendiente este mes.",
            AlertType.ITV_DUE: "Recordatorio: ITV del vehículo.",
            AlertType.MAINTENANCE_DUE: "Recordatorio: mantenimiento programado.",
        }[kind]
        if due:
            base += f" Vencimiento: {due.isoformat()}."
        text = f"{base} {message}".strip()

        driver = current_driver_map([vehicle.id]).get(vehicle.id)

        alert_created = False
        if create_alert:
            alert_created = alerts_service.upsert_alert(
                dedup_key=f"reminder:{kind}:{vehicle.pk}:{today.isoformat()}",
                type=kind,
                level=AlertLevel.WARNING,
                message=text,
                vehicle=vehicle,
                user=driver,
                due_date=due,
                queue_email=False,
            )

        email_sent, email_skipped = False, ""
        if send_email:
            # Asunto/cuerpo de la plantilla del tipo si existe (10b); si no, el
            # texto neutro del mailer con el mensaje compuesto. Va al conductor.
            notice = mailer.render_vehicle_notice(vehicle, kind, text, "es")
            email_sent, email_skipped = mailer.send_notice_now(
                to=driver.email if driver else "",
                subject=notice.subject,
                body_html=notice.body_html,
                template_key=notice.used_key or kind,
            )

        return Response(
            {
                "alert_created": alert_created,
                "email_sent": email_sent,
                "email_skipped": email_skipped,
            }
        )

    @action(
        detail=True,
        methods=["post"],
        permission_classes=[IsManagement],
        url_path="notice-preview",
    )
    def notice_preview(self, request, pk=None):
        """POST /api/v1/vehicles/{id}/notice-preview/ — asunto y cuerpo (HTML)
        que se enviarían con la plantilla indicada, para la vista previa del
        modal de correo. No envía nada."""
        from .services import mailer

        vehicle = self.get_object()
        template_key = (request.data.get("template_key") or "").strip()
        message = (request.data.get("message") or "").strip()
        lang = (request.data.get("lang") or "es").strip()
        body_override = (request.data.get("body") or "").strip()
        if body_override:
            body_override = sanitize_email_html(body_override)
        notice = mailer.render_vehicle_notice(vehicle, template_key, message, lang, body_override)
        return Response(
            {
                "subject": notice.subject,
                "body_html": notice.body_html,
                "has_template": bool(notice.used_key),
                # Para avisar en la UI de que la versión inglesa no existe y se
                # está enseñando la castellana.
                "has_en": notice.has_en,
            }
        )

    @action(
        detail=True,
        methods=["get"],
        permission_classes=[IsAdmin],
        url_path="driver-candidates",
    )
    def driver_candidates(self, request, pk=None):
        """GET /api/v1/vehicles/{id}/driver-candidates/ — conductores ordenados
        por su media mensual de km, para el modal de resolver un exceso de km
        proyectado (cambiar el coche a alguien que ruede menos).

        La media de cada conductor es la SUMA de las medias mensuales observadas
        de los vehículos que lleva ahora (la misma proyección de la ficha,
        HU-3.4); sin coche o sin datos suficientes va como `null`, que para este
        caso son los mejores candidatos. Solo admin: es la antesala de
        `set-driver`, que también lo es.
        """
        from django.contrib.auth import get_user_model

        from .selectors import current_driver_map

        vehicle = self.get_object()
        fleet_ids = list(vehicles_for(request.user).values_list("id", flat=True))
        driver_map = current_driver_map(fleet_ids)  # vehículo → conductor vigente
        by_driver: dict[int, list[int]] = {}
        for vid, drv in driver_map.items():
            by_driver.setdefault(drv.pk, []).append(vid)

        # Solo hace falta el ritmo de los vehículos implicados (los que ya llevan
        # los candidatos y el del aviso). R5-15: y de ellos, solo matrícula y
        # media mensual (`monthly_pace_map`, tres consultas), no el summary
        # completo de casi toda la flota para rellenar un desplegable.
        involved = {vid for vids in by_driver.values() for vid in vids} | {vehicle.pk}
        paces = metrics.monthly_pace_map(request.user, list(involved))

        def monthly_avg(vid: int) -> int | None:
            return (paces.get(vid) or {}).get("monthly_avg")

        current = driver_map.get(vehicle.pk)
        candidates = []
        for person in (
            get_user_model()
            .objects.filter(is_active=True, roles__role=Role.DRIVER)
            .distinct()
            .order_by("first_name", "last_name", "username")
        ):
            if current is not None and person.pk == current.pk:
                continue
            vids = [vid for vid in by_driver.get(person.pk, []) if vid in paces]
            averages = [avg for avg in (monthly_avg(vid) for vid in vids) if avg is not None]
            candidates.append(
                {
                    "id": person.pk,
                    "name": person.get_full_name() or person.username,
                    "vehicles": [{"id": vid, "plate": paces[vid]["plate"]} for vid in vids],
                    "monthly_avg": sum(averages) if averages else None,
                }
            )
        # Sin datos primero (no ruedan o no se les puede medir), luego de menos a más.
        candidates.sort(key=lambda c: (c["monthly_avg"] is not None, c["monthly_avg"] or 0))

        return Response(
            {
                "vehicle": {
                    "id": vehicle.pk,
                    "plate": vehicle.plate,
                    "monthly_avg": monthly_avg(vehicle.pk),
                    "driver": (
                        {"id": current.pk, "name": current.get_full_name() or current.username}
                        if current
                        else None
                    ),
                },
                "candidates": candidates,
            }
        )


# --- Recursos que cuelgan del vehículo -----------------------------------


class ContractViewSet(DeactivateOnDestroyMixin, ScopedByVehicleMixin, viewsets.ModelViewSet):
    serializer_class = ContractSerializer
    permission_classes = [AdminWriteManagementRead]
    queryset = Contract.objects.select_related("vehicle", "renting")
    filterset_fields = ["vehicle", "renting"]
    ordering_fields = ["start_date", "planned_end_date"]


class KmReadingViewSet(
    IdempotentCreateMixin, DeactivateOnDestroyMixin, ScopedByVehicleMixin, viewsets.ModelViewSet
):
    """Lecturas de km. El conductor registra las de su vehículo (HU-3.1).

    El alta acepta `client_ref` (R3-34): el reenvío de la cola offline de la
    PWA no duplica la lectura si el POST original ya había llegado.
    """

    serializer_class = KmReadingSerializer
    permission_classes = [ManagementOrDriverReadWrite]
    # Front público (internet): acota las escrituras del conductor.
    throttle_classes = [UserRateThrottle, PublicWriteThrottle]
    throttle_scope = "public_write"
    queryset = KmReading.objects.select_related("vehicle")
    # M10: la pantalla de Kilometraje trabaja MES A MES pero se traía todas las
    # lecturas de la flota (histórico completo, ~36 páginas encadenadas en una
    # flota de 500). Con el rango por fecha pide solo la ventana que pinta.
    filterset_fields = {"vehicle": ["exact"], "reading_date": ["exact", "gte", "lte"]}
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
                # Exento el admin, NO el supervisor (es campo) — ver el
                # validador de `KmReadingSerializer`, que manda de verdad.
                "open": km_window.field_window_open(today) or request.user.is_admin,
                # `enabled=False` (FLEET_KM_WINDOW_START=0): no hay plazo, y el
                # front oculta todo lo relativo a él en vez de darlo por abierto.
                "enabled": bool(settings.FLEET_KM_WINDOW_START),
                "start_day": settings.FLEET_KM_WINDOW_START,
                "last_day": km_window.last_day_of_month(today),
                "today": today,
                "admin_exempt": request.user.is_admin,
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
                    # Ídem N8b: sin ventana configurada, el front no enseña plazos.
                    "window_enabled": bool(settings.FLEET_KM_ESTIMATE_WINDOW_END),
                    "window_end_day": settings.FLEET_KM_ESTIMATE_WINDOW_END,
                    "missing_count": len(missing),
                    "missing": [{"vehicle": v.id, "plate": v.plate} for v in missing],
                }
            )
        # `override`: la administración puede forzar el cálculo fuera de la
        # ventana (p. ej. tras confirmar las advertencias en la interfaz).
        override = bool(request.data.get("override", False))
        if not window_open and not override:
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


class AssignmentViewSet(DeactivateOnDestroyMixin, ScopedByVehicleMixin, viewsets.ModelViewSet):
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
            # R3-02: cierra también una vigente con fin programado.
            current = (
                Assignment.objects.select_for_update()
                .filter(current_assignment_q(), vehicle=assignment.vehicle)
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
            # Un coche por conductor a la vez (+ sustituto aparte). Se mira
            # DESPUÉS de cerrar la vigente del vehículo: un relevo del mismo
            # conductor en su coche no debe chocar consigo mismo. El atomic
            # revierte ese cierre si la regla corta aquí.
            clash = driver_assignment_clash(
                assignment.driver_id,
                is_substitute=assignment.vehicle.is_substitute,
                start_date=assignment.start_date,
                end_date=assignment.end_date,
                exclude_pk=assignment.pk,
                exclude_vehicle_id=assignment.vehicle_id,
            )
            if clash:
                raise ValidationError({"driver": driver_clash_message(clash)})
            assignment.save(update_fields=["status", "start_date", "updated_at"])
            events.emit_driver_change(
                assignment.vehicle, old_driver=old_driver, new_driver=assignment.driver
            )
        return Response(self.get_serializer(assignment).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAdmin])
    def reject(self, request, pk=None):
        """POST /assignments/{id}/reject/ — rechaza la propuesta sin tocar la vigente.

        C1: además de marcar el estado, CIERRA la asignación (`end_date`). Una
        propuesta rechazada con `end_date=NULL` seguía contando como "en curso"
        para el ámbito del conductor (`scoping.vehicles_for`), así que un rechazo
        dejaba abierto el acceso al vehículo para siempre.
        """
        assignment = self.get_object()
        if assignment.status != AssignmentStatus.PROPOSED:
            raise ValidationError({"status": "Solo se puede rechazar una propuesta."})
        assignment.status = AssignmentStatus.REJECTED
        # Cierre coherente con `accept`: nunca anterior al inicio propuesto.
        assignment.end_date = assignment.start_date or timezone.localdate()
        assignment.save(update_fields=["status", "end_date", "updated_at"])
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


class SupervisorPeriodViewSet(
    DeactivateOnDestroyMixin, ScopedByVehicleMixin, viewsets.ModelViewSet
):
    """Histórico de supervisores con fechas (uno por coche a la vez).

    Escribir aquí es corregir el histórico, así que es cosa de admin; la
    gestión lo lee. Cada escritura **sincroniza el vigente** del vehículo
    (`Vehicle.supervisor`) con el periodo que cubre hoy, y ese cambio deja su
    evento como cualquier otro relevo.
    """

    serializer_class = SupervisorPeriodSerializer
    permission_classes = [AdminWriteManagementRead]
    queryset = SupervisorPeriod.objects.select_related("vehicle", "supervisor")
    filterset_fields = ["vehicle", "supervisor"]
    ordering_fields = ["start_date", "created_at"]

    def _guardar(self, serializer):
        with transaction.atomic():
            serializer.save()
            supervisors.sync_vehicle_supervisor(serializer.instance.vehicle)

    def perform_create(self, serializer):
        self._guardar(serializer)

    def perform_update(self, serializer):
        self._guardar(serializer)

    def perform_destroy(self, instance):
        # N7: se desactiva, no se borra — y el vigente se recalcula.
        with transaction.atomic():
            super().perform_destroy(instance)
            supervisors.sync_vehicle_supervisor(instance.vehicle)


class VehicleUsageViewSet(DeactivateOnDestroyMixin, ScopedByVehicleMixin, viewsets.ModelViewSet):
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
            # R3-24: cierre fila a fila (no `queryset.update()`) — VehicleUsage
            # está auditado y el diff del cierre debe quedar, con su updated_at.
            for usage in VehicleUsage.objects.filter(
                vehicle=vehicle, end_date__isnull=True, is_active=True
            ):
                usage.end_date = data["start_date"]
                usage.save(update_fields=["end_date", "updated_at"])
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


class VehicleLinkViewSet(DeactivateOnDestroyMixin, ScopedByVehicleMixin, viewsets.ModelViewSet):
    serializer_class = VehicleLinkSerializer
    permission_classes = [AdminWriteManagementRead]
    queryset = VehicleLink.objects.select_related("main_vehicle", "substitute_vehicle")
    vehicle_lookup = "main_vehicle"
    # `reason` NO se expone como filtro: choca con el `?reason=` del motivo de
    # baja de N7 (`DeactivateOnDestroyMixin`), que viaja por query en los DELETE
    # sin cuerpo del front. Con ambos, django-filter validaba el motivo contra
    # las opciones de `LinkReason` y el DELETE respondía 400. Ningún cliente
    # filtra por motivo; si hiciera falta, exponerlo como `link_reason`.
    filterset_fields = ["main_vehicle", "substitute_vehicle"]


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


class _ItvEffectsCreateMixin:
    """Añade a la respuesta del alta los efectos del registro de una ITV.

    Va DETRÁS de `IdempotentCreateMixin` en el MRO a propósito: así la
    respuesta que se guarda en el recibo del `client_ref` ya lleva
    `alerts_resolved` / `incident_closed` / `vehicle_reactivated`, y el reenvío
    de la cola offline devuelve exactamente lo mismo que el primer intento.
    """

    def create(self, request, *args, **kwargs):
        self._itv_effects = None
        response = super().create(request, *args, **kwargs)
        if self._itv_effects:
            response.data.update(self._itv_effects)
        return response


class EventViewSet(
    IdempotentCreateMixin,
    _ItvEffectsCreateMixin,
    ScopedByVehicleMixin,
    mixins.CreateModelMixin,
    viewsets.ReadOnlyModelViewSet,
):
    """Histórico de eventos + registro manual (Fase A1).

    Los procesos de negocio siguen emitiendo los suyos; por API solo se dan de
    alta los tipos manuales (`MANUAL_EVENT_TYPES`): **ITV** (HU-5.1 — al crearse
    su `EventItv`, la señal refresca `next_itv_date` y `services/itv.register_itv`
    cierra las alertas CON actor, cierra la incidencia «En ITV» y, si se pide
    `return_to_active`, devuelve el coche a Activo), cambio de **cuota** y de
    **ubicación** (HU-1.4). El conductor solo ITV, de sus vehículos (scoping).
    El alta acepta `client_ref` (R3-34): el reenvío offline de una ITV no crea
    un segundo evento.
    """

    serializer_class = EventSerializer
    permission_classes = [EventPermission]
    # PR1: los subtipos son one-to-one inversos que get_details toca fila a
    # fila — sin select_related eran hasta 5 queries por evento. R3-03: la
    # lista es EXACTAMENTE lo que lee el serializer (faltaban driver_change y
    # penalty, y los FK internos de project/pep — 1-2 queries extra por fila).
    queryset = Event.objects.select_related(
        "vehicle",
        "itv__workshop",
        "fee_change",
        "location_change",
        "project_change__old_project",
        "project_change__new_project",
        "pep_change__old_pep",
        "pep_change__new_pep",
        "driver_change",
        # `supervisor_change` resuelve nombres en get_details → trae los dos FK.
        "supervisor_change__old_supervisor",
        "supervisor_change__new_supervisor",
        "insurance_renewal",
        "penalty",
    )
    filterset_fields = ["vehicle", "event_type"]
    ordering_fields = ["event_date"]

    def perform_create(self, serializer):
        # Evento + subtipo + efectos de la ITV (alertas, incidencia «En ITV»,
        # vuelta a Activo) en UNA transacción: o queda todo o no queda nada.
        with transaction.atomic():
            super().perform_create(serializer)
            event = serializer.instance
            if event.event_type == EventType.ITV:
                flag = str(self.request.data.get("return_to_active", "")).lower() in ("1", "true")
                effects = itv.register_itv(event, actor=self.request.user, return_to_active=flag)
                effects["blocked_by"] = substitution.blocked_payload(effects.get("blocked_by"))
                self._itv_effects = effects


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
            # A2/R0: el reparto anterior se DESACTIVA, no se borra. `delete()`
            # destruía físicamente a qué proyecto/CECO se había imputado la
            # factura —el dato que necesita una revisión contable— y lo hacía
            # desde la pantalla de Facturas, cuando el borrado definitivo solo
            # existe en Ajustes → Borrado.
            for previous in invoice.allocations.filter(is_active=True):
                previous.deactivate(by=request.user, reason="Refacturación de la factura")
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

    El conductor sube documentos de su vehículo (HU-4.1) y los suyos personales
    (permiso de conducir); la gestión los administra (HU-4.4). El scoping por
    vehículo/usuario lo aplica el queryset.
    """

    message = "No tienes permiso para esta operación sobre documentos."

    def has_permission(self, request, view) -> bool:
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if request.method in SAFE_METHODS or request.method == "POST":
            return user.is_management or user.is_driver
        return user.is_management  # PUT / PATCH / DELETE


class IncidentViewSet(
    IdempotentCreateMixin, DeactivateOnDestroyMixin, ScopedByVehicleMixin, viewsets.ModelViewSet
):
    """Incidencias / mantenimiento. Gestión escribe todo (admin toda la flota;
    supervisor su grupo); el conductor LEE las de sus vehículos y CREA las suyas
    (C3: comunicar una avería desde la app de campo), pero no las cierra.

    El alta acepta `client_ref` (R3-34/R3-27): el parte encolado sin cobertura
    se reenvía sin riesgo de crear dos incidencias idénticas.
    """

    serializer_class = IncidentSerializer
    permission_classes = [IsManagementOrDriverCreate]
    # Front público (internet): el alta del conductor va acotada, como la de
    # documentos — es la misma superficie expuesta a la red abierta.
    throttle_classes = [UserRateThrottle, PublicWriteThrottle]
    throttle_scope = "public_write"
    queryset = Incident.objects.select_related(
        "vehicle", "accident_report", "workshop", "resolved_by"
    ).prefetch_related("accident_report__third_parties", "accident_report__injured")
    filterset_fields = ["vehicle", "type", "status", "priority"]
    ordering_fields = ["date", "created_at"]

    def perform_create(self, serializer):
        super().perform_create(serializer)
        incident = serializer.instance
        # Si quien lo comunica dice que el coche necesita sustituto, la petición
        # abre además su SOLICITUD en la bandeja de vehículos: aquí no se toca
        # el estado del coche ni se vincula nada — incluir el coche o no lo
        # decide la administración desde esa bandeja.
        vehicle_requests.open_substitute_request(incident, actor=self.request.user)
        # Un registro que nace ya CERRADO (p. ej. un mantenimiento realizado que
        # se anota a posteriori) deja igualmente actor y momento del cierre.
        if incident.status == IncidentStatus.CLOSED and incident.resolved_at is None:
            incident.resolved_at = timezone.now()
            incident.resolved_by = self.request.user
            incident.resolution_date = incident.resolution_date or incident.date
            incident.save(
                update_fields=["resolved_at", "resolved_by", "resolution_date", "updated_at"]
            )

    @action(detail=True, methods=["post"], permission_classes=[IsManagement])
    def report(self, request, pk=None):
        """POST /api/v1/incidents/{id}/report/ — añade una actualización a la
        incidencia (sello de fecha y autor en la descripción) y, opcionalmente,
        cambia el estado. Es el parte rápido del supervisor desde la app de
        campo; el sello lo pone el servidor para que la autoría no se falsee.
        """
        self.get_object()  # scoping + 404; el candado va sobre la fila fresca
        text = (request.data.get("text") or "").strip()
        new_status = (request.data.get("status") or "").strip()
        if not text and not new_status:
            raise ValidationError({"text": "La actualización no puede estar vacía."})
        if new_status and new_status not in IncidentStatus.values:
            raise ValidationError({"status": "Estado no válido."})
        # Cerrar es la fase 3 con sus datos (fecha, coste, taller, actor…): va
        # por `/resolve/`. Por aquí se dejaba cerrada sin rastro de quién ni cómo.
        if new_status == IncidentStatus.CLOSED:
            raise ValidationError(
                {"status": "Para cerrar una incidencia usa la acción de resolver (/resolve/)."}
            )
        # R3-09: dos partes simultáneos concatenan AMBAS notas en vez de
        # pisarse (lectura-modificación-escritura bajo candado), y el
        # `update_fields` no arrastra el resto de la fila.
        with transaction.atomic():
            incident = Incident.objects.select_for_update().get(pk=self.kwargs["pk"])
            if text:
                author = request.user.get_full_name() or request.user.get_username()
                note = f"[{timezone.localdate().isoformat()} · {author}] {text}"
                incident.description = f"{incident.description}\n\n{note}".strip()
            if new_status:
                incident.status = new_status
            incident.save(update_fields=["description", "status", "updated_at"])
        return Response(self.get_serializer(incident).data)

    @action(detail=True, methods=["post"], permission_classes=[IsManagement])
    def manage(self, request, pk=None):
        """POST /api/v1/incidents/{id}/manage/ — fase 2 del ciclo de una
        incidencia (avería, mantenimiento, neumáticos…): la GESTIÓN. Guarda el
        código postal de la ubicación preferente desde la que se buscará el
        taller más cercano y deja la incidencia EN CURSO.
        """
        self.get_object()  # scoping + 404
        postal_code = (request.data.get("workshop_postal_code") or "").strip()
        if not postal_code.isdigit() or len(postal_code) != 5:
            raise ValidationError({"workshop_postal_code": "Indica un código postal de 5 cifras."})
        # Taller del catálogo, opcional: es la fase en la que se decide a dónde va.
        workshop = None
        workshop_id = request.data.get("workshop")
        if workshop_id not in (None, ""):
            workshop = Workshop.objects.filter(pk=workshop_id, is_active=True).first()
            if workshop is None:
                raise ValidationError({"workshop": "Taller no válido."})
        # R3-09: candado + update_fields — no pisa un parte concurrente.
        with transaction.atomic():
            incident = Incident.objects.select_for_update().get(pk=self.kwargs["pk"])
            # Gestionar una CERRADA la reabría en silencio: la fase 2 no aplica.
            if incident.status == IncidentStatus.CLOSED:
                raise ValidationError({"status": "La incidencia está cerrada."})
            incident.workshop_postal_code = postal_code
            incident.status = IncidentStatus.IN_PROGRESS
            fields = ["workshop_postal_code", "status", "updated_at"]
            if workshop is not None:
                incident.workshop = workshop
                fields.append("workshop")
            incident.save(update_fields=fields)
        return Response(self.get_serializer(incident).data)

    @action(detail=True, methods=["post"], permission_classes=[IsManagement])
    def resolve(self, request, pk=None):
        """POST /api/v1/incidents/{id}/resolve/ — fase 3 del ciclo: la SOLUCIÓN.

        Cuerpo tipado (`IncidentResolutionSerializer`): `resolution_date`*,
        `observations`, `cost` (alias legado `overcost`, R3-41), `workshop` del
        catálogo, `km`, `return_to_active`, y el bloque propio del tipo
        (`tires` / `accident`; `maintenance_plan` en mantenimiento). El servicio
        deja actor y momento, devuelve el vehículo a Activo si procede (con su
        evento) y, en mantenimiento, reancla el plan y cierra SUS alertas.
        Responde la incidencia + `vehicle_reactivated` y `alerts_resolved`.
        """
        incident = self.get_object()  # scoping + 404
        serializer = IncidentResolutionSerializer(
            data=request.data, context={"incident": incident, "request": request}
        )
        serializer.is_valid(raise_exception=True)
        result = incidents.resolve_incident(
            incident, actor=request.user, **serializer.to_service_kwargs()
        )
        data = self.get_serializer(result["incident"]).data
        data["vehicle_reactivated"] = result["vehicle_reactivated"]
        data["alerts_resolved"] = result["alerts_resolved"]
        # R5-02: si otra petición abierta impidió la vuelta a Activo, se dice cuál.
        data["blocked_by"] = substitution.blocked_payload(result.get("blocked_by"))
        return Response(data)


def _document_filename(document, mime: str) -> str:
    """Nombre con el que se guarda un documento al descargarlo.

    El tipo, la matrícula (si es del coche) y el id, que es lo que distingue
    dos pólizas del mismo vehículo. En **ASCII** a propósito (`slugify`): un
    nombre con acentos en la cabecera obliga al RFC 5987 y no todos los
    navegadores lo leen igual; aquí no aporta nada.
    """
    partes = [slugify(document.get_type_display()) or "documento"]
    if document.vehicle_id:
        partes.append(slugify(document.vehicle.plate))
    partes.append(str(document.pk))
    return "-".join(parte for parte in partes if parte) + extension_of(mime)


class DocumentViewSet(
    IdempotentCreateMixin, DeactivateOnDestroyMixin, ScopedByVehicleMixin, viewsets.ModelViewSet
):
    """Documentos del vehículo o PERSONALES de un usuario (permiso de conducir).

    El conductor sube los de su vehículo (HU-4.1) y los suyos propios; el
    titular es un vehículo O un usuario, nunca ambos (lo valida el serializer).
    La subida acepta `client_ref` (R3-34): el reenvío offline no duplica el
    documento (ni su archivado en Drive).
    """

    serializer_class = DocumentSerializer
    permission_classes = [DocumentPermission]
    # Front público (internet): acota la subida de documentos del conductor.
    throttle_classes = [UserRateThrottle, PublicWriteThrottle]
    throttle_scope = "public_write"
    queryset = Document.objects.select_related(
        "vehicle", "user", "incident", "event", "alert", "uploaded_by"
    ).annotate(
        # Si hay pedido su borrado y nadie lo ha decidido todavía. Va anotado y
        # no resuelto por fila: la lista de la ficha son decenas de documentos.
        deletion_pending=models.Exists(
            DocumentDeletionRequest.objects.filter(
                document=models.OuterRef("pk"), status=DocumentDeletionStatus.PENDING
            )
        )
    )
    filterset_fields = ["vehicle", "user", "type", "status", "incident", "event", "alert"]
    ordering_fields = ["created_at", "expiry_date"]

    def scope_queryset(self, qs, user):
        # El ámbito (de qué documentos se puede hablar) y la confidencialidad
        # (cuáles de esos se leen) van juntos y viven los dos en `scoping`:
        # `readable_documents` es la MISMA regla que aplican la descarga del
        # binario y el informe de documentos.
        return readable_documents(user, qs)

    def _assert_user_in_scope(self, serializer) -> None:
        # SEC1 para el titular PERSONA: un conductor solo se sube documentos a
        # sí mismo; un supervisor, a sí mismo o a sus conductores en curso. El
        # RESPONSABLE va por lo mismo: sin esto, un supervisor podría poner de
        # responsable a cualquiera de la organización.
        request_user = self.request.user
        if request_user.is_admin:
            return
        data = serializer.validated_data
        for campo in ("user", "responsible"):
            target = data.get(campo)
            if target is None:
                continue
            if not users_for(request_user).filter(pk=target.pk).exists():
                raise PermissionDenied("El usuario está fuera de tu ámbito.")

    def _fill_responsible(self, serializer) -> None:
        """Responsable por defecto, antes de guardar.

        `"responsible" in data` y no `is not None`: la gestión puede mandarlo a
        `null` a propósito, y eso no es lo mismo que no mandarlo. Para quien no
        es gestión el campo es de solo lectura, así que nunca está y el defecto
        se aplica siempre.
        """
        data = serializer.validated_data
        if "responsible" in data:
            return
        responsible = default_responsible(user=data.get("user"), vehicle=data.get("vehicle"))
        if responsible is not None:
            data["responsible"] = responsible

    def perform_update(self, serializer):
        self._assert_user_in_scope(serializer)
        super().perform_update(serializer)

    def perform_destroy(self, instance):
        super().perform_destroy(instance)
        # La gestión también elimina desde la ficha del coche, sin pasar por la
        # bandeja: si alguien había pedido su borrado, ya está hecho y la
        # petición no debe seguir esperando decisión.
        document_requests.close_pending_as_deleted(instance, actor=self.request.user)

    def extra_create_kwargs(self) -> dict:
        return {"uploaded_by": self.request.user}

    def perform_create(self, serializer):
        self._assert_user_in_scope(serializer)
        self._fill_responsible(serializer)
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

    def _serve_file(self, document, *, as_attachment: bool):
        """El binario de un documento, servido sin dejar copia en ningún sitio.

        Lo trae la **cuenta de servicio** (`fetch_document`: el staging local
        si aún está ahí y, si no, Drive) y se responde con la MISMA regla de
        siempre — `get_object` ya pasó por `readable_documents`, así que se
        sirve lo que se puede leer y nada más.

        No se guarda copia de nada: los bytes van a memoria y de ahí a la
        respuesta (`no-store`). Se sirve **inline** solo lo que es imagen o PDF
        (`INLINE_MIME_TYPES`) y no se ha pedido como descarga; cualquier otra
        cosa va como `attachment`, porque un HTML pintado en el origen de la
        API sería un XSS.
        """
        archivo = fetch_document(document)
        if archivo is None:
            raise Http404("Ese documento no tiene archivo que enseñar.")
        content, mime = archivo
        conocido = mime in INLINE_MIME_TYPES
        inline = conocido and not as_attachment
        tipo = mime if conocido else "application/octet-stream"
        response = HttpResponse(content, content_type=tipo)
        disposition = "inline" if inline else "attachment"
        nombre = _document_filename(document, mime)
        response["Content-Disposition"] = f'{disposition}; filename="{nombre}"'
        # Sin rastro en cachés intermedias ni en el disco del navegador.
        response["Cache-Control"] = "no-store, private"
        response["X-Content-Type-Options"] = "nosniff"
        return response

    @action(detail=True, methods=["get"])
    def preview(self, request, pk=None):
        """GET /documents/{id}/preview/ — el archivo, para VERLO en el front.

        Quien conduce **no tiene cuenta en Drive**: el enlace a la carpeta no
        le abre nada, así que el archivo lo trae el back. Lo que llega al móvil
        vive en un blob que la ventana suelta al cerrarse.
        """
        return self._serve_file(self.get_object(), as_attachment=False)

    @action(detail=True, methods=["get"])
    def download(self, request, pk=None):
        """GET /documents/{id}/download/ — el archivo, para GUARDARLO.

        Lo mismo que `preview` pero como `attachment` y con nombre: la descarga
        tampoco puede ir por Drive (`uc?export=download`), que a un conductor
        sin cuenta en esa carpeta le contesta «no tienes acceso». Aquí baja por
        la misma puerta que ya autoriza la lectura.
        """
        return self._serve_file(self.get_object(), as_attachment=True)

    @action(detail=False, methods=["post"], permission_classes=[IsAdmin])
    def verify(self, request):
        """Comprueba que los archivos de los documentos de un titular siguen
        donde se archivaron (`{vehicle}` o `{user}`).

        La lista de gestión lo llama en cada carga: lo que no se encuentra
        queda marcado (`drive_missing_at`) y la fila ofrece el borrado
        definitivo, porque ya no hay archivo que conservar. Solo los activos:
        lo desactivado se resuelve en erratas.
        """
        vehicle = request.data.get("vehicle")
        user = request.data.get("user")
        if not vehicle and not user:
            raise ValidationError({"vehicle": "Indica el vehículo o el usuario a comprobar."})
        rows = Document.objects.filter(is_active=True).select_related(
            "vehicle", "user", "uploaded_by"
        )
        rows = rows.filter(vehicle_id=vehicle) if vehicle else rows.filter(user_id=user)
        return Response(verify_documents(rows))

    @action(detail=True, methods=["post"], permission_classes=[IsAdmin])
    def purge(self, request, pk=None):
        """Borrado DEFINITIVO desde la lista, solo de un documento cuyo archivo
        ya no existe (lo dijo `verify`): no hay nada que conservar ni que
        restaurar. Lo demás sigue el camino de siempre: eliminar (erratas) y,
        desde allí, purgar el superusuario, que borra también en Drive.
        """
        document = self.get_object()
        if document.drive_missing_at is None:
            raise ValidationError(
                {
                    "detail": (
                        "Ese archivo existe: elimínalo (irá al espacio de erratas) y, desde "
                        "allí, el superusuario lo borra definitivamente."
                    )
                }
            )
        try:
            result = purge_document(document)
        except ExternalDeleteError as exc:
            raise ValidationError({"detail": str(exc)}) from exc
        return Response(result)


class DocumentDeletionRequestViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """Peticiones de borrado de un documento: el campo pide, la gestión decide.

    La papelera de la app de conductores **no borra**: abre una petición aquí y
    el documento se queda como estaba, marcado «Pendiente de borrado»
    (`Document.deletion_pending`). La administración la resuelve en su bandeja
    de solicitudes con `resolve`, y solo entonces el documento desaparece de la
    vista del conductor — por baja (erratas) o por candado.

    No hay `PUT`/`PATCH`/`DELETE`: una petición no se corrige, se resuelve. Y
    lo que se resuelve queda: es el rastro de quién pidió y quién decidió.
    """

    serializer_class = DocumentDeletionRequestSerializer
    permission_classes = [DocumentPermission]
    # Misma superficie pública que la subida: el alta llega de internet.
    throttle_classes = [UserRateThrottle, PublicWriteThrottle]
    throttle_scope = "public_write"
    queryset = DocumentDeletionRequest.objects.select_related(
        "document", "document__vehicle", "document__user", "requested_by", "resolved_by"
    )
    filterset_fields = ["status", "document"]
    ordering_fields = ["created_at", "resolved_at"]

    def get_queryset(self):
        """Cada uno ve lo suyo; la gestión, todo lo de su ámbito.

        Las propias van por delante del documento a propósito: al resolverse,
        el documento deja de ser legible (se va a erratas o queda protegido) y
        sin esto quien la abrió perdería de vista su propia petición y no
        sabría en qué quedó.
        """
        qs = super().get_queryset()
        user = self.request.user
        if user.is_admin:
            return qs
        legibles = readable_documents(user).values("id")
        return qs.filter(
            models.Q(requested_by=user) | models.Q(document_id__in=legibles)
        ).distinct()

    def create(self, request, *args, **kwargs):
        """Pide algo sobre un documento (o devuelve la petición ya abierta).

        Dos clases: **borrarlo** (la de siempre) y **corregirlo** (`kind`
        = `"change"` con `changes`). El documento tiene que estar **en el
        ámbito de quien pide**: se comprueba con `readable_documents`, la misma
        regla que sirve el listado y el binario — pedir algo sobre lo que no se
        puede ni leer no es una petición, es una sonda.
        """
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        datos = serializer.validated_data
        document = datos["document"]
        if not readable_documents(request.user, Document.objects.filter(pk=document.pk)).exists():
            raise PermissionDenied("Ese documento está fuera de tu ámbito.")
        if not document.is_active:
            raise ValidationError({"document": "Ese documento ya está dado de baja."})
        kind = datos.get("kind") or DocumentRequestKind.DELETE
        cambios = datos.get("changes") or {}
        if kind == DocumentRequestKind.CHANGE and not document_requests.clean_document_changes(
            cambios, document=document
        ):
            # Sin nada que cambiar no hay corrección que decidir: se dice aquí
            # en vez de llenar la bandeja de filas vacías.
            raise ValidationError({"changes": "No hay nada que corregir en ese documento."})
        peticion = document_requests.open_request(
            document,
            actor=request.user,
            reason=datos.get("reason", ""),
            kind=kind,
            changes=cambios,
        )
        salida = self.get_serializer(peticion)
        return Response(salida.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], permission_classes=[IsAdmin])
    def resolve(self, request, pk=None):
        """POST /document-deletion-requests/{id}/resolve/ — la decide la gestión.

        Cuerpo: `{"decision": …, "note": "…"}`. En una de **borrado**, `delete`
        la manda a erratas, `hide` la deja en la flota pero protegida y a
        nombre de quien decide, y `reject` no toca el documento; en una de
        **corrección**, `apply` escribe los cambios y `reject` no. Todas la
        sacan de pendiente, que es lo que quita la marca en el campo.
        """
        peticion = self.get_object()
        if peticion.status != DocumentDeletionStatus.PENDING:
            raise ValidationError({"status": "Esa petición ya está resuelta."})
        decision = str(request.data.get("decision", "") or "")
        # Cada clase tiene SUS salidas: aplicar un borrado o dar de baja un
        # documento porque su fecha estaba mal son cosas distintas.
        posibles = (
            (document_requests.DECISION_APPLY, document_requests.DECISION_REJECT)
            if peticion.kind == DocumentRequestKind.CHANGE
            else (
                document_requests.DECISION_DELETE,
                document_requests.DECISION_HIDE,
                document_requests.DECISION_REJECT,
            )
        )
        if decision not in posibles:
            raise ValidationError({"decision": f"Indica una decisión: {', '.join(posibles)}."})
        note = str(request.data.get("note", "") or "").strip()[:255]
        document_requests.resolve(peticion, decision=decision, actor=request.user, note=note)
        return Response(self.get_serializer(peticion).data)


# --- Alertas (Épicas 3/5/10) ---------------------------------------------


class AlertViewSet(ScopedByVehicleMixin, viewsets.ReadOnlyModelViewSet):
    """Bandeja de alertas. Solo lectura + cierre.

    Las alertas las generan los trabajos programados (`fleet/services/alerts.py`);
    por API no se crean ni editan, solo se **resuelven** (gestión). El conductor
    ve las de sus vehículos (p. ej. la lectura de km pendiente).

    Una alerta solo tiene dos estados: abierta o resuelta. `dismiss` existió y
    se retiró — descartar silenciaba el aviso sin resolver el problema y
    duplicaba el camino de cierre sin que nada aguas abajo distinguiera ambos
    estados (el motor solo mira `OPEN`).
    """

    serializer_class = AlertSerializer
    permission_classes = [IsManagementOrDriverReadOnly]
    # BG11: `level` es texto — ordenar por él ponía warning antes que critical.
    # Se expone `level_rank` (0=critical) anotado para ordenar por gravedad real.
    queryset = Alert.objects.select_related(
        "vehicle", "vehicle__supervisor", "user", "resolved_by"
    ).annotate(
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

    def get_queryset(self):
        """X1: el seguro es asunto de administración — fuera de la app de campo.

        `insurance_due` se emite sobre el VEHÍCULO (no sobre un usuario), y el
        scoping del mixin es por vehículo: sin este filtro, el conductor y el
        supervisor veían en su bandeja el vencimiento del seguro de su coche.
        El admin la sigue viendo entera (su front y su flujo con el renting).
        """
        qs = super().get_queryset()
        if not self.request.user.is_admin:
            qs = qs.exclude(type=AlertType.INSURANCE_DUE)
        return qs

    @action(detail=True, methods=["post"], permission_classes=[IsManagement])
    def resolve(self, request, pk=None):
        """POST /api/alerts/{id}/resolve/ — marca la alerta como resuelta.

        Admite `note` opcional (qué se hizo): queda en la bandeja de resueltas.
        """
        alert = self.get_object()
        note = str(request.data.get("note", "") or "").strip()[:255]
        alert.close(status=AlertStatus.RESOLVED, by=request.user, note=note)
        return Response(self.get_serializer(alert).data)


# --- Solicitudes de vehículo (Épica 8) -----------------------------------


class VehicleRequestViewSet(DeactivateOnDestroyMixin, viewsets.ModelViewSet):
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

    def get_queryset(self):
        """A10: el supervisor ve las solicitudes de SU ámbito, no las de todos.

        Era el único viewset de `fleet` sin acotar: cualquier supervisor
        listaba, editaba y borraba las solicitudes de toda la empresa.
        Criterio: las suyas propias y las de los conductores de sus
        vehículos (o las que ya apuntan a un vehículo de su grupo).
        """
        qs = super().get_queryset()
        user = self.request.user
        if user.is_admin:
            return qs
        scope = vehicles_for(user)
        # R3-22: «sus conductores» = el criterio canónico de `users_for`
        # (asignación aceptada VIGENTE). Antes bastaba CUALQUIER asignación
        # histórica —incluso una propuesta rechazada— para exponer las
        # solicitudes de esa persona al supervisor para siempre.
        return qs.filter(
            models.Q(requester=user)
            | models.Q(vehicle__in=scope)
            | models.Q(requester__in=users_for(user))
        ).distinct()

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
        from django.contrib.auth import get_user_model

        # R3-10: el «crea o actualiza la abierta» era get→save sin candado —
        # dos POST simultáneos (doble tap, reintento offline) creaban dos
        # solicitudes `pending`. La fila del propio usuario hace de mutex:
        # el segundo POST espera y ve la solicitud del primero.
        with transaction.atomic():
            get_user_model().objects.select_for_update().get(pk=request.user.pk)
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
            # R3-02: cierra también una vigente con fin programado.
            current = (
                Assignment.objects.select_for_update()
                .filter(current_assignment_q(), vehicle=vehicle)
                .select_related("driver")
                .first()
            )
            old_driver = current.driver if current else None
            if current:
                current.status = AssignmentStatus.FINISHED
                current.end_date = start
                current.save(update_fields=["status", "end_date", "updated_at"])
            # Un coche por conductor a la vez: si el solicitante ya lleva otro
            # en ese periodo, se resuelve ese primero (el atomic revierte).
            clash = driver_assignment_clash(
                requester.pk,
                is_substitute=vehicle.is_substitute,
                start_date=start,
                end_date=vehicle_request.end_date,
                exclude_vehicle_id=vehicle.pk,
            )
            if clash:
                raise ValidationError({"driver": driver_clash_message(clash)})
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
    """GET /api/reports/?kind=&fmt=&<filtros> — descarga un informe (Excel/CSV).

    `kind` ∈ `reports.REPORT_KINDS` (`vehicles` es el documento completo, una
    hoja por bloque) y `fmt` ∈ {xlsx, csv}. (Se usa `fmt` y no `format`, que DRF
    reserva para la negociación de contenido.) Admite además los filtros del
    informe pedido (`reports.REPORT_FILTERS[kind]`) como query params; el resto
    se ignora. Los envíos programados usan el mismo servicio, pero solo en CSV.
    Acotado por rol: el admin exporta toda la flota; el supervisor solo su grupo.

    `fmt=json` no descarga: devuelve las MISMAS tablas del documento (título,
    cabeceras y filas) para la vista previa de Descargas — lo que se ve es
    exactamente lo que se baja, generado por el mismo código. `fmt=columns`
    (solo `kind=vehicles`) tampoco: devuelve qué columnas aporta cada bloque
    (resumen del súper registro + hoja de detalle) para la ayuda «?» del
    selector de campos.
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
        if fmt not in ("json", "columns") and fmt not in reports.FORMATS:
            return Response(
                {"detail": f"Formato no soportado: {fmt}. Válidos: {', '.join(reports.FORMATS)}."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if fmt == "columns":
            if kind != "vehicles":
                return Response(
                    {"detail": "fmt=columns solo aplica al documento completo de vehículos."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            return Response({"sections": reports.vehicle_report_columns(request.user)})
        # Solo las claves que el informe declara: mismas que valida un envío
        # programado, para que la descarga a mano y lo programado coincidan.
        filters = {
            key: request.query_params.get(key, "") for key in reports.REPORT_FILTERS.get(kind, ())
        }
        # `fields` es el selector de secciones del documento completo (columnas
        # del súper registro + hojas de detalle). Solo en la descarga a mano:
        # los envíos programados van SIEMPRE completos (no está en REPORT_FILTERS).
        if kind == "vehicles":
            filters["fields"] = request.query_params.get("fields", "")
        if fmt == "json":
            tables = reports.build_report(kind, request.user, filters)
            return Response(
                {
                    "tables": [
                        {"title": title, "headers": headers, "rows": rows}
                        for title, headers, rows in tables
                    ]
                }
            )
        filename, content_type, payload = reports.render(kind, request.user, fmt, filters)
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


class FuelTypeViewSet(DeactivateOnDestroyMixin, viewsets.ModelViewSet):
    """GAP-1: catálogo de combustibles (lista HSE de factores de emisión)."""

    queryset = FuelType.objects.all()
    serializer_class = FuelTypeSerializer
    permission_classes = [AdminWriteManagementRead]
    search_fields = ["name"]


class SiteViewSet(DeactivateOnDestroyMixin, viewsets.ModelViewSet):
    """GAP-4: catálogo de sedes/oficinas."""

    queryset = Site.objects.all()
    serializer_class = SiteSerializer
    permission_classes = [AdminWriteManagementRead]
    search_fields = ["name"]


class WorkshopViewSet(DeactivateOnDestroyMixin, viewsets.ModelViewSet):
    """Catálogo de talleres y estaciones de ITV (dónde se cita el vehículo).

    Lo lee también el CONDUCTOR: al lanzar una avería desde la app de campo
    elige el taller en la fase de gestión, y el desplegable sale de aquí.
    """

    queryset = Workshop.objects.all()
    serializer_class = WorkshopSerializer
    permission_classes = [AdminWriteManagementOrDriverRead]
    filterset_fields = ["kind"]
    search_fields = ["name", "address", "postal_code"]


class FuelConsumptionViewSet(DeactivateOnDestroyMixin, ScopedByVehicleMixin, viewsets.ModelViewSet):
    """GAP-2: anotaciones del consumo medio del ordenador de a bordo.

    Cada fila es lo que marcaba el ordenador en una FECHA (l/km o kWh/km, el
    del último trayecto o ciclo de repostaje). Lo anota el conductor desde la
    PWA (`add/`) igual que registra los km, y también la gestión desde la
    ficha; siempre con el ámbito del rol acotando.

    Como en las lecturas de km (SEC4), para el conductor el registro es
    **append-only**: editar o borrar una anotación es cosa de gestión.
    """

    serializer_class = FuelConsumptionSerializer
    permission_classes = [ManagementOrDriverReadWrite]
    # Front público (internet): acota las escrituras del conductor, igual que
    # en las lecturas de km.
    throttle_classes = [UserRateThrottle, PublicWriteThrottle]
    throttle_scope = "public_write"
    queryset = FuelConsumption.objects.select_related("vehicle")
    filterset_fields = {"vehicle": ["exact"], "reading_date": ["exact", "gte", "lte"]}
    ordering_fields = ["reading_date", "avg_consumption"]
    ordering = ["-reading_date", "-pk"]

    def _require_management(self):
        if not self.request.user.is_management:
            raise PermissionDenied("Solo la gestión puede modificar o borrar el consumo.")

    def perform_create(self, serializer):
        # R3-38: el alta por el CRUD genérico (con la fecha libre) es de
        # GESTIÓN. El conductor anota por `add/`, que acota la fecha a lo
        # reciente y lleva la clave de idempotencia de la cola offline.
        self._require_management()
        super().perform_create(serializer)

    def perform_update(self, serializer):
        self._require_management()
        super().perform_update(serializer)

    def perform_destroy(self, instance):
        self._require_management()
        super().perform_destroy(instance)

    @action(detail=False, methods=["post"])
    def add(self, request):
        """POST /api/v1/fuel-consumptions/add/ — la anotación de campo.

        `{vehicle, avg_consumption, reading_date?, client_ref?}` crea una
        anotación del consumo medio que marcaba el ordenador de a bordo (por
        defecto, de hoy). Cada anotación es una fila: dos del mismo día son dos
        lecturas distintas y las dos valen (la última manda en el KPI).

        `client_ref` (R3-34): el reenvío de la cola offline con la misma
        referencia devuelve la respuesta original y no crea otra fila.
        """
        return run_idempotent(request, lambda: self._add_reading(request))

    def _add_reading(self, request):
        try:
            vehicle_id = int(request.data.get("vehicle") or 0)
        except (TypeError, ValueError) as exc:
            raise ValidationError({"vehicle": "Vehículo no válido."}) from exc
        # Se resuelve YA acotado (SEC1): en el camino bueno es UNA consulta, y
        # solo cuando falla se distingue "no existe" (400) de "no es tuyo" (403).
        vehicle = vehicles_for(request.user).filter(pk=vehicle_id).first()
        if vehicle is None:
            if Vehicle.objects.filter(pk=vehicle_id).exists():
                raise PermissionDenied("El vehículo está fuera de tu ámbito.")
            raise ValidationError({"vehicle": "Vehículo no válido."})
        today = timezone.localdate()
        raw_date = str(request.data.get("reading_date") or "")
        reading_date = parse_date(raw_date) if raw_date else today
        if reading_date is None:
            raise ValidationError({"reading_date": "Fecha no válida."})
        if reading_date > today:
            raise ValidationError({"reading_date": "La fecha no puede ser futura."})
        # R4-08: la fecha existe para el reenvío offline que llega días después
        # (R3-37) y para anotar lo que se miró ayer. El conductor no reescribe
        # meses viejos de la serie; eso es de gestión, por el CRUD (R3-38).
        if not request.user.is_management:
            previous_month = (today.replace(day=1) - timedelta(days=1)).replace(day=1)
            if reading_date < previous_month:
                raise ValidationError(
                    {"reading_date": "Solo se puede anotar el mes en curso o el anterior."}
                )
        raw = request.data.get("avg_consumption")
        if raw in (None, ""):
            raise ValidationError({"avg_consumption": "Este campo es obligatorio."})
        try:
            avg_consumption = Decimal(str(raw))
        except ArithmeticError as exc:
            raise ValidationError({"avg_consumption": "Valor no válido."}) from exc
        if avg_consumption < 0:
            raise ValidationError({"avg_consumption": "No puede ser negativo."})
        row = FuelConsumption.objects.create(
            vehicle=vehicle, reading_date=reading_date, avg_consumption=avg_consumption
        )
        serializer = self.get_serializer(row)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class MaintenanceProgramViewSet(DeactivateOnDestroyMixin, viewsets.ModelViewSet):
    """Catálogo COMÚN de programas de mantenimiento («cada X km / X meses»).

    No cuelga de ningún vehículo: se define una vez para toda la flota y el
    modal «Programar ITV y mantenimiento» elige de aquí. Lo mantiene la
    gestión igual que el resto de catálogos.
    """

    queryset = MaintenanceProgram.objects.all()
    serializer_class = MaintenanceProgramSerializer
    permission_classes = [AdminWriteManagementRead]
    search_fields = ["name", "notes"]


class MaintenancePlanViewSet(DeactivateOnDestroyMixin, ScopedByVehicleMixin, viewsets.ModelViewSet):
    """GAP-8: el mantenimiento programado de cada vehículo (uno a la vez)."""

    serializer_class = MaintenancePlanSerializer
    permission_classes = [AdminWriteManagementRead]
    queryset = MaintenancePlan.objects.select_related("vehicle", "program")
    filterset_fields = ["vehicle"]
    search_fields = ["name", "vehicle__plate"]

    @action(detail=True, methods=["post"], permission_classes=[IsManagement])
    def done(self, request, pk=None):
        """POST /api/v1/maintenance-plans/{id}/done/ — marca el plan como
        realizado (gestión; supervisor solo su grupo — editar el plan sigue
        siendo de admin).

        Cuerpo: `{date?, km?, cost?, note?, workshop?, return_to_active?,
        incident?}`. `services/maintenance.mark_plan_done` reancla el ciclo
        (fecha dada o hoy; si cicla por km, la lectura dada o la última), deja
        SIEMPRE una incidencia de mantenimiento cerrada como registro (o cierra
        la abierta que se indique en `incident`), cierra las alertas DE ESE PLAN
        (y los recordatorios manuales), emite el evento y, si se pide, devuelve
        el coche a Activo. Responde el plan + `alerts_resolved`, `incident`,
        `vehicle_reactivated`, `event`.
        """
        plan = self.get_object()
        note = str(request.data.get("note", "") or "").strip()[:255]
        cost = None
        raw_cost = request.data.get("cost")
        if raw_cost not in (None, ""):
            try:
                cost = Decimal(str(raw_cost))
            except ArithmeticError as exc:
                raise ValidationError({"cost": "Coste no válido."}) from exc
            if cost < 0:
                raise ValidationError({"cost": "El coste no puede ser negativo."})
        done_date = parse_date(str(request.data.get("date") or "")) or None
        km = None
        raw_km = request.data.get("km")
        if raw_km not in (None, ""):
            try:
                km = int(raw_km)
            except (TypeError, ValueError) as exc:
                raise ValidationError({"km": "Kilometraje no válido."}) from exc
            if km < 0:
                raise ValidationError({"km": "Kilometraje no válido."})
        workshop = None
        workshop_id = request.data.get("workshop")
        if workshop_id not in (None, ""):
            workshop = Workshop.objects.filter(pk=workshop_id, is_active=True).first()
            if workshop is None:
                raise ValidationError({"workshop": "Taller no válido."})
        source_incident = None
        incident_id = request.data.get("incident")
        if incident_id not in (None, ""):
            source_incident = Incident.objects.filter(
                pk=incident_id, vehicle=plan.vehicle, type=IncidentType.MAINTENANCE, is_active=True
            ).first()
            if source_incident is None:
                raise ValidationError(
                    {"incident": "La incidencia no es de mantenimiento de este vehículo."}
                )
        flag = str(request.data.get("return_to_active", "")).lower() in ("1", "true")

        result = maintenance.mark_plan_done(
            plan,
            actor=request.user,
            done_date=done_date,
            km=km,
            cost=cost,
            note=note,
            workshop=workshop,
            return_to_active=flag,
            source_incident=source_incident,
        )
        data = self.get_serializer(result["plan"]).data
        data["alerts_resolved"] = result["alerts_resolved"]
        data["incident"] = result["incident"].pk
        data["vehicle_reactivated"] = result["vehicle_reactivated"]
        data["event"] = result["event"].pk
        data["blocked_by"] = substitution.blocked_payload(result.get("blocked_by"))
        return Response(data)


class CatalogsBundleView(APIView):
    """GET /api/v1/catalogs/ — los catálogos del alta de vehículo en UNA respuesta.

    El formulario de vehículo necesita todos los maestros a la vez y hacía
    **siete** peticiones, cada una con su ronda de red, su autenticación y su
    paginación; el reparto de facturas hacía dos. Aquí van juntos.

    Devuelve los MISMOS objetos que los endpoints individuales (mismos
    serializers), no una versión reducida: los selects usan campos como
    `cost_center` del proyecto para autorrellenar, así que recortarlos sería un
    cambio de comportamiento y no una optimización.

    No incluye los modelos de vehículo a propósito: se consumen por marca
    (`/vehicle-models/?brand=<id>`) y meterlos aquí enteros sería mandar todo el
    catálogo para usar una parte. Tampoco pagina: son catálogos y el cliente los
    quiere completos, que es lo que ya hacía encadenando páginas.
    """

    permission_classes = [AdminWriteManagementRead]

    def get(self, request):
        # Las claves son las del recurso en la API, para que el front las use tal cual.
        return Response(
            {
                "countries": CountrySerializer(
                    Country.objects.filter(is_active=True), many=True
                ).data,
                "business-units": BusinessUnitSerializer(
                    BusinessUnit.objects.filter(is_active=True), many=True
                ).data,
                "projects": ProjectSerializer(
                    Project.objects.filter(is_active=True).select_related("cost_center"),
                    many=True,
                ).data,
                "peps": PepSerializer(Pep.objects.filter(is_active=True), many=True).data,
                "rentings": RentingSerializer(
                    Renting.objects.filter(is_active=True), many=True
                ).data,
                "brands": BrandSerializer(Brand.objects.filter(is_active=True), many=True).data,
                "companies": CompanySerializer(
                    Company.objects.filter(is_active=True), many=True
                ).data,
                # GAP-1/GAP-4: combustibles y sedes, también en el alta.
                "fuel-types": FuelTypeSerializer(
                    FuelType.objects.filter(is_active=True), many=True
                ).data,
                "sites": SiteSerializer(Site.objects.filter(is_active=True), many=True).data,
            }
        )


class NotificationScheduleViewSet(viewsets.ModelViewSet):
    """Envíos programados del usuario (Ajustes → Notificaciones).

    Cada uno ve y gestiona SOLO los suyos: el contenido se genera con el ámbito
    del dueño, así que un envío ajeno sería una vía para leer datos de otro rol.
    Por eso no hay parámetro de usuario ni listado global, ni siquiera para el
    admin, que para eso ya tiene el admin de Django.

    `DELETE` borra de verdad: es configuración personal y no histórico de
    negocio (ver el modelo). Para dejar de recibir sin perderla está `enabled`.
    """

    serializer_class = NotificationScheduleSerializer
    permission_classes = [IsManagement]
    filterset_fields = ["enabled", "content", "frequency"]

    def get_queryset(self):
        return NotificationSchedule.objects.filter(user=self.request.user).select_related("user")

    def perform_create(self, serializer):
        # `last_run_at` arranca en «ahora» para que crear un envío cuya hora ya
        # pasó hoy no lo dispare de inmediato: el primero sale en su próximo
        # turno, que es lo que espera quien lo acaba de configurar.
        serializer.save(user=self.request.user, last_run_at=timezone.now())

    @action(detail=True, methods=["post"])
    def run(self, request, pk=None):
        """POST /{id}/run/ — lo manda ahora mismo, para probarlo.

        No toca el calendario más que en `last_run_at`, así que la prueba puede
        adelantar el envío programado de ese periodo; es lo razonable: acabas de
        recibirlo.
        """
        schedule = self.get_object()
        resultado = notifications.run_schedule(schedule)
        if resultado["queued"] and mailer.email_enabled():
            # R3-15: entrega SOLO lo recién encolado — sin el filtro, la prueba
            # de UN envío se ponía a repartir hasta 200 correos pendientes de
            # otros dentro del request (con el timeout de gunicorn en contra).
            mailer.send_outbox(entry_ids=[resultado["outbox_id"]])
        schedule.refresh_from_db()
        return Response(
            {
                "queued": resultado["queued"],
                "drive_url": resultado["drive_url"],
                "error": resultado["error"],
                "last_status": schedule.last_status,
            },
            status=status.HTTP_200_OK,
        )


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

    @staticmethod
    def _edited_lang(request) -> str:
        """Idioma que se está editando (es/en); cualquier otro valor cae a `es`."""
        lang = (request.data.get("lang") or "es").strip()
        return "en" if lang == "en" else "es"

    @action(detail=True, methods=["post"])
    def preview(self, request, pk=None):
        """POST /email-templates/{id}/preview/ — render con datos de ejemplo, en
        la versión que se esté editando (`lang`)."""
        from .services import mailer

        template = self.get_object()
        raw_subject, raw_body = template.parts(self._edited_lang(request))
        body = mailer.render(raw_body, self.SAMPLE_CONTEXT)
        if template.signature is not None and template.signature.is_active:
            body += template.signature.body_html
        return Response(
            {
                "subject": mailer.render(raw_subject, self.SAMPLE_CONTEXT),
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
        raw_subject, raw_body = template.parts(self._edited_lang(request))
        subject = mailer.render(raw_subject, self.SAMPLE_CONTEXT)
        body = mailer.render(raw_body, self.SAMPLE_CONTEXT)
        if template.signature is not None and template.signature.is_active:
            body += template.signature.body_html
        message = EmailMultiAlternatives(
            subject=f"[PRUEBA] {subject}",
            body=strip_tags(body),
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[request.user.email],
        )
        message.attach_alternative(body, "text/html")
        # M8: el resto del correo es best-effort y traza en `EmailLog`; este
        # envío lanzaba y devolvía un 500 opaco, sin registro del intento.
        try:
            message.send(fail_silently=False)
        except Exception as exc:  # noqa: BLE001 — se traza y se informa
            EmailLog.objects.create(
                template_key=template.key,
                recipient=request.user.email,
                subject=subject[:200],
                status=EmailLog.Status.FAILED,
                error=str(exc)[:1000],
            )
            raise ValidationError({"detail": f"No se pudo enviar la prueba: {exc}"}) from exc
        EmailLog.objects.create(
            template_key=template.key,
            recipient=request.user.email,
            subject=subject[:200],
            status=EmailLog.Status.SENT,
        )
        return Response({"sent_to": request.user.email})


class EmailLogViewSet(viewsets.ReadOnlyModelViewSet):
    """Traza de envíos (soporte). Solo lectura, solo admin."""

    queryset = EmailLog.objects.select_related("alert")
    serializer_class = EmailLogSerializer
    permission_classes = [IsAdmin]
    filterset_fields = ["status", "template_key"]
    search_fields = ["recipient", "subject"]


class DriverChangeRequestViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """Propuestas de cambio de conductor: el campo propone, la gestión decide.

    Nace al resolver la alerta de **km contratados**: si el coche va camino de
    pasarse de los km del contrato, lo que lo arregla es que lo lleve otra
    persona, y eso no lo hace quien supervisa. Se propone a alguien de su
    ámbito (o se escribe una nota) y la fila espera en `/solicitudes`.

    No hay `PUT`/`PATCH`/`DELETE`: una propuesta no se corrige, se resuelve. Y
    resolverla NO mueve la asignación (`resolve` lo explica): el cambio se hace
    en «Cambiar conductor», que es el gesto de siempre.
    """

    serializer_class = DriverChangeRequestSerializer
    permission_classes = [ManagementOrDriverReadWrite]
    # Misma superficie pública que el resto de escrituras de campo (SEC9).
    throttle_classes = [UserRateThrottle, PublicWriteThrottle]
    throttle_scope = "public_write"
    queryset = DriverChangeRequest.objects.select_related(
        "vehicle", "alert", "requested_by", "proposed_driver", "resolved_by"
    )
    filterset_fields = ["status", "vehicle"]
    ordering_fields = ["created_at", "resolved_at"]

    def get_queryset(self):
        """El admin ve la bandeja entera; el resto, lo suyo y lo de su ámbito.

        Las propias van por delante del vehículo a propósito: quien propuso
        tiene que poder ver en qué quedó aunque el coche salga de su ámbito
        (justo lo que pasa cuando se le cambia el conductor).
        """
        qs = super().get_queryset()
        user = self.request.user
        if user.is_admin:
            return qs
        return qs.filter(
            models.Q(requested_by=user) | models.Q(vehicle__in=vehicles_for(user))
        ).distinct()

    def create(self, request, *args, **kwargs):
        """Propone un cambio de conductor (o devuelve la propuesta ya abierta).

        El coche tiene que estar en el ámbito de quien propone, y el candidato
        también: proponer a alguien de quien no se puede hablar no es una
        propuesta. Para cualquier otra persona está la nota, que es lo que lee
        la administración.
        """
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        datos = serializer.validated_data
        vehicle = datos["vehicle"]
        if not vehicles_for(request.user).filter(pk=vehicle.pk).exists():
            raise PermissionDenied("Ese vehículo está fuera de tu ámbito.")
        propuesto = datos.get("proposed_driver")
        if propuesto is not None and not users_for(request.user).filter(pk=propuesto.pk).exists():
            raise PermissionDenied("Esa persona está fuera de tu ámbito.")
        alerta = datos.get("alert")
        if alerta is not None and alerta.vehicle_id != vehicle.pk:
            raise ValidationError({"alert": "La alerta es de otro vehículo."})
        peticion = driver_requests.open_request(
            vehicle,
            actor=request.user,
            alert=alerta,
            proposed_driver=propuesto,
            proposed_name=datos.get("proposed_name", ""),
            proposed_email=datos.get("proposed_email", ""),
            note=datos.get("note", ""),
        )
        salida = self.get_serializer(peticion)
        return Response(salida.data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["get"])
    def candidates(self, request):
        """GET /driver-change-requests/candidates/ — a quién se puede proponer.

        Los conductores del ámbito de quien pregunta, con el coche que llevan
        hoy: se busca a alguien que ruede menos, así que la matrícula es parte
        de la elección. Cuando el directorio de Google esté conectado se suman
        los suyos con `source: "directory"`.
        """
        return Response(driver_requests.candidates_for(request.user))

    @action(detail=True, methods=["post"], permission_classes=[IsAdmin])
    def resolve(self, request, pk=None):
        """POST /driver-change-requests/{id}/resolve/ — la decide la gestión.

        Cuerpo: `{"decision": "done" | "reject", "note": "…"}`. Las dos salidas
        la sacan de pendiente; ninguna toca la asignación.
        """
        peticion = self.get_object()
        if peticion.status != DriverChangeStatus.PENDING:
            raise ValidationError({"status": "Esa propuesta ya está resuelta."})
        decision = str(request.data.get("decision", "") or "")
        if decision not in driver_requests.DECISIONS:
            raise ValidationError(
                {"decision": f"Indica una decisión: {', '.join(driver_requests.DECISIONS)}."}
            )
        note = str(request.data.get("note", "") or "").strip()[:255]
        driver_requests.resolve(peticion, decision=decision, actor=request.user, note=note)
        return Response(self.get_serializer(peticion).data)


class ProfileChangeRequestViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """Peticiones de corregir la ficha personal: la persona pide, gestión decide.

    En la app de campo «Mi perfil» es de lectura, así que la corrección se pide
    desde ahí y espera en `/solicitudes` con las otras tres. Se pide **sobre la
    propia ficha y nada más**: `user` no viaja en el cuerpo, lo pone la sesión.

    No hay `PUT`/`PATCH`/`DELETE`: una petición no se corrige, se resuelve.
    """

    serializer_class = ProfileChangeRequestSerializer
    permission_classes = [ManagementOrDriverReadWrite]
    # Misma superficie pública que el resto de escrituras de campo (SEC9).
    throttle_classes = [UserRateThrottle, PublicWriteThrottle]
    throttle_scope = "public_write"
    queryset = ProfileChangeRequest.objects.select_related("user", "requested_by", "resolved_by")
    filterset_fields = ["status", "user"]
    ordering_fields = ["created_at", "resolved_at"]

    def get_queryset(self):
        """El admin ve la bandeja entera; cualquier otro, solo la de su ficha.

        Ni siquiera quien supervisa ve las de su gente: son datos personales de
        otro (teléfono, permiso), y verlos no es parte de supervisar un coche.
        """
        qs = super().get_queryset()
        user = self.request.user
        if user.is_admin:
            return qs
        return qs.filter(user=user)

    def create(self, request, *args, **kwargs):
        """Pide corregir la PROPIA ficha (o devuelve la petición ya abierta).

        La ficha es la de quien firma: mandar `user` en el cuerpo no sirve de
        nada porque es de solo lectura, y así no hay forma de abrir una
        petición sobre la ficha de otra persona.
        """
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        datos = serializer.validated_data
        cambios = datos.get("changes") or {}
        # El correo y el DNI identifican a la persona en otras tablas: si el
        # nuevo ya es de otra cuenta se dice AQUÍ, y no cuando alguien intente
        # aplicar una petición que nunca pudo aplicarse.
        choque = profile_requests.conflicts(cambios, user=request.user)
        if choque:
            raise ValidationError(choque)
        peticion = profile_requests.open_request(
            request.user,
            actor=request.user,
            changes=cambios,
            note=datos.get("note", ""),
        )
        salida = self.get_serializer(peticion)
        return Response(salida.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], permission_classes=[IsAdmin])
    def resolve(self, request, pk=None):
        """POST /profile-change-requests/{id}/resolve/ — la decide la gestión.

        Cuerpo: `{"decision": "done" | "reject", "note": "…"}`. `done` **aplica**
        lo pedido sobre la ficha (`services.profile_requests.resolve` dice por
        qué); `reject` no toca nada. Las dos la sacan de pendiente.
        """
        peticion = self.get_object()
        if peticion.status != ProfileChangeStatus.PENDING:
            raise ValidationError({"status": "Esa petición ya está resuelta."})
        decision = str(request.data.get("decision", "") or "")
        if decision not in profile_requests.DECISIONS:
            raise ValidationError(
                {"decision": f"Indica una decisión: {', '.join(profile_requests.DECISIONS)}."}
            )
        note = str(request.data.get("note", "") or "").strip()[:255]
        try:
            profile_requests.resolve(peticion, decision=decision, actor=request.user, note=note)
        except profile_requests.ConflictingProfileChange as choque:
            # Otra cuenta se ha quedado ese correo o ese DNI: la petición sigue
            # pendiente y se dice qué campo estorba, que es lo accionable.
            raise ValidationError(choque.errors) from choque
        peticion.refresh_from_db()
        return Response(self.get_serializer(peticion).data)
