from decimal import Decimal

from auditlog.models import LogEntry
from django.conf import settings
from django.contrib.contenttypes.models import ContentType
from django.db import models, transaction
from django.http import HttpResponse
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
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
    NotificationSchedule,
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
    AlertType,
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
    NotificationScheduleSerializer,
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
from .services import events, importer, mailer, metrics, notifications, reports
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
        # Vehículos con asignación ACEPTADA en curso (BG12: contar cualquier
        # asignación incluía PROPUESTAS — un coche salía "asignado" y sin
        # conductor en la misma fila; mismo criterio que current_driver_map).
        active = Assignment.objects.filter(
            end_date__isnull=True, status=AssignmentStatus.ACCEPTED, is_active=True
        ).values("vehicle_id")
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
                # B4: `change_date` es la fecha CON EFECTO del cambio (la baja
                # puede ser de un día anterior); sin ella, el cliente la metía
                # dentro del motivo como texto castellano.
                events.emit_vehicle_state_change(
                    updated,
                    old_state,
                    updated.state,
                    reason=str(self.request.data.get("change_reason", "")),
                    when=parse_date(str(self.request.data.get("change_date", "") or "")),
                )

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
        old_state = instance.state
        with transaction.atomic():
            instance.state = VehicleState.BAJA
            instance.save(update_fields=["state", "updated_at"])
            # Misma traza que un cambio de estado normal: quién y por qué.
            events.emit_vehicle_state_change(instance, old_state, VehicleState.BAJA, reason=reason)

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

        # Bloqueo optimista opt-in, igual que el PATCH de la ficha.
        expected = request.data.get("expected_updated_at")
        if expected:
            parsed = parse_datetime(str(expected))
            if parsed is None or parsed != vehicle.updated_at:
                raise Conflict()

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
            if "supervisor" in request.data:
                supervisor_id = request.data.get("supervisor") or None
                if supervisor_id is not None:
                    from django.contrib.auth import get_user_model

                    if not get_user_model().objects.filter(pk=supervisor_id).exists():
                        raise ValidationError({"supervisor": "Supervisor no válido."})
                vehicle.supervisor_id = supervisor_id
                vehicle.save(update_fields=["supervisor", "updated_at"])

            current = (
                Assignment.objects.select_for_update()
                .filter(
                    vehicle=vehicle,
                    status=AssignmentStatus.ACCEPTED,
                    end_date__isnull=True,
                    is_active=True,
                )
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

        from django.core.mail import EmailMultiAlternatives
        from django.utils.html import strip_tags

        from .selectors import current_driver_map
        from .services import mailer

        vehicle = self.get_object()
        message = (request.data.get("message") or "").strip()
        # `template_key`: si se informa, asunto/cuerpo salen de la plantilla de
        # correo (10b) y el mensaje libre es opcional (variable {{mensaje}}). Sin
        # plantilla, el texto libre es el cuerpo y es obligatorio.
        template_key = (request.data.get("template_key") or "").strip()
        if not template_key and not message:
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
            notice = mailer.render_vehicle_notice(vehicle, template_key, message, lang)
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
        return Response({"sent": sent, "skipped": skipped})

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
        notice = mailer.render_vehicle_notice(vehicle, template_key, message, lang)
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


# --- Recursos que cuelgan del vehículo -----------------------------------


class ContractViewSet(DeactivateOnDestroyMixin, ScopedByVehicleMixin, viewsets.ModelViewSet):
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
            current = (
                Assignment.objects.select_for_update()
                .filter(
                    vehicle=assignment.vehicle,
                    status=AssignmentStatus.ACCEPTED,
                    end_date__isnull=True,
                    is_active=True,
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
            VehicleUsage.objects.filter(
                vehicle=vehicle, end_date__isnull=True, is_active=True
            ).update(end_date=data["start_date"])
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
    """Incidencias / mantenimiento. Gestión escribe todo (admin toda la flota;
    supervisor su grupo); el conductor LEE las de sus vehículos y CREA las suyas
    (C3: comunicar una avería desde la app de campo), pero no las cierra."""

    serializer_class = IncidentSerializer
    permission_classes = [IsManagementOrDriverCreate]
    # Front público (internet): el alta del conductor va acotada, como la de
    # documentos — es la misma superficie expuesta a la red abierta.
    throttle_classes = [UserRateThrottle, PublicWriteThrottle]
    throttle_scope = "public_write"
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
        """POST /api/alerts/{id}/resolve/ — marca la alerta como resuelta."""
        alert = self.get_object()
        alert.close(status=AlertStatus.RESOLVED, by=request.user)
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
        drivers = Assignment.objects.filter(vehicle__in=scope).values("driver_id")
        return qs.filter(
            models.Q(requester=user)
            | models.Q(vehicle__in=scope)
            | models.Q(requester_id__in=drivers)
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
                    is_active=True,
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

    `kind` ∈ `reports.REPORT_KINDS` (los siete de la pantalla de Informes) y
    `fmt` ∈ {xlsx, csv}. (Se usa `fmt` y no `format`, que DRF reserva para la
    negociación de contenido.) Los envíos programados usan el mismo servicio,
    pero solo en CSV. Acotado por rol: el admin exporta toda la flota; el
    supervisor solo su grupo.
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
            mailer.send_outbox()
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
