from decimal import Decimal
from pathlib import Path

from auditlog.models import LogEntry
from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import models
from django.utils import timezone
from rest_framework import serializers

from .models import (
    Alert,
    Assignment,
    BusinessUnit,
    Contract,
    Country,
    Document,
    Event,
    EventFeeChange,
    EventItv,
    EventLocationChange,
    Incident,
    Invoice,
    InvoiceAllocation,
    KmReading,
    Pep,
    Project,
    Renting,
    Vehicle,
    VehicleLink,
    VehicleRequest,
    VehicleUsage,
)
from .models.enums import (
    AllocationTarget,
    AssignmentStatus,
    EventType,
    UseType,
    VehicleState,
)
from .selectors import current_driver_map


class LogEntrySerializer(serializers.ModelSerializer):
    """Entrada de auditoría de campos (django-auditlog) para el histórico."""

    action = serializers.CharField(source="get_action_display", read_only=True)
    actor = serializers.SerializerMethodField()
    changes = serializers.SerializerMethodField()

    class Meta:
        model = LogEntry
        fields = ["id", "action", "actor", "changes", "timestamp"]
        read_only_fields = fields

    def get_actor(self, obj) -> str:
        actor = obj.actor
        if not actor:
            return ""
        return actor.get_full_name() or actor.get_username()

    def get_changes(self, obj) -> dict:
        # En auditlog 3.x `changes` ya es dict; defensivo por si viniera como texto.
        return obj.changes if isinstance(obj.changes, dict) else obj.changes_dict


class VehicleContractInputSerializer(serializers.ModelSerializer):
    """Contrato anidado del ALTA transaccional de vehículo (HU-1.3, G3)."""

    class Meta:
        model = Contract
        fields = [
            "contract_number",
            "contract_time",
            "contract_km",
            "renting",
            "start_date",
            "planned_end_date",
            "month_fee",
            "penalty_per_km",
        ]


class VehicleSerializer(serializers.ModelSerializer):
    """Serializer de vehículo (nuevo esquema).

    El conductor se relaciona vía `Assignment`, no con un campo directo. Se
    exponen etiquetas legibles y el nombre del supervisor para pintar sin joins
    extra en el front.
    """

    state_display = serializers.CharField(source="get_state_display", read_only=True)
    supervisor_name = serializers.SerializerMethodField()
    driver_name = serializers.SerializerMethodField()
    # Alta transaccional (HU-1.3): contrato y conductor OPCIONALES en el POST;
    # con `km_start` se registra además la primera lectura. Solo en el alta —
    # editar contrato/conductor/kilometraje va por sus flujos propios.
    contract = VehicleContractInputSerializer(write_only=True, required=False)
    driver = serializers.PrimaryKeyRelatedField(
        queryset=get_user_model().objects.filter(is_active=True),
        write_only=True,
        required=False,
        allow_null=True,
    )

    class Meta:
        model = Vehicle
        fields = [
            "id",
            "plate",
            "brand",
            "model",
            "year",
            "vin",
            "registration_date",
            "version",
            "state",
            "state_display",
            "is_substitute",
            "supervisor",
            "supervisor_name",
            "business_unit",
            "country",
            "project",
            "cost_center",
            "fuel",
            "type",
            "size",
            "market_segment",
            "veh_use",
            "property",
            "business_use",
            "consumption",
            "km_start",
            "km_end",
            "next_itv_date",
            "driver_name",
            "drive_folder_url",
            "drive_folder_id",
            "contract",
            "driver",
            "created_at",
            "updated_at",
        ]
        # next_itv_date lo mantiene el job refresh_next_itv (denormalizado).
        # La carpeta de Drive la mantiene el archivador (Fase A3).
        # updated_at se expone para el bloqueo optimista (expected_updated_at).
        read_only_fields = [
            "id",
            "next_itv_date",
            "drive_folder_url",
            "drive_folder_id",
            "created_at",
            "updated_at",
        ]

    def get_supervisor_name(self, obj: Vehicle) -> str:
        sup = obj.supervisor
        if not sup:
            return ""
        return sup.get_full_name() or sup.get_username()

    def get_driver_name(self, obj: Vehicle) -> str:
        """Conductor vigente (HU-1.1). El mapa se calcula UNA vez por respuesta
        (cacheado en el context) para no hacer una query por fila del listado."""
        drivers = self.context.get("_current_drivers")
        if drivers is None:
            instance = self.parent.instance if self.parent is not None else obj
            ids = (
                [v.id for v in instance]
                if isinstance(instance, list | models.QuerySet)
                else [obj.id]
            )
            drivers = current_driver_map(ids)
            self.context["_current_drivers"] = drivers
        driver = drivers.get(obj.id)
        return (driver.get_full_name() or driver.get_username()) if driver else ""

    def validate(self, attrs):
        # HU-1.3: proyecto obligatorio cuando el uso empresarial es "proyecto".
        business_use = attrs.get("business_use", getattr(self.instance, "business_use", ""))
        project = attrs.get("project", getattr(self.instance, "project", None))
        if business_use == UseType.ON_PROJECT and project is None:
            raise serializers.ValidationError(
                {"project": "El proyecto es obligatorio cuando el uso es 'Proyecto'."}
            )
        # Los anidados del alta no valen en edición: tienen flujo propio
        # (contratos por su CRUD; conductor por "Cambiar conductor" — HU-1.4).
        if self.instance is not None:
            forbidden = {"contract", "driver"} & set(self.initial_data.keys())
            if forbidden:
                raise serializers.ValidationError(
                    dict.fromkeys(sorted(forbidden), "Solo se admite en el alta.")
                )
        driver = attrs.get("driver")
        if driver is not None and not driver.is_driver:
            raise serializers.ValidationError(
                {"driver": "El usuario asignado no tiene rol de conductor."}
            )
        return attrs

    def create(self, validated_data):
        """Alta transaccional (HU-1.3): vehículo + contrato + 1ª lectura +
        asignación, o NADA (corre dentro del `atomic` de `perform_create`)."""
        from .services import events

        contract_data = validated_data.pop("contract", None)
        driver = validated_data.pop("driver", None)
        vehicle = super().create(validated_data)
        today = timezone.localdate()
        if contract_data:
            Contract.objects.create(vehicle=vehicle, **contract_data)
        if vehicle.km_start is not None:
            reading = KmReading.objects.create(
                vehicle=vehicle, reading_date=today, km_reading=vehicle.km_start
            )
            events.emit_km_reading(reading)
        if driver is not None:
            Assignment.objects.create(
                vehicle=vehicle,
                driver=driver,
                start_date=today,
                status=AssignmentStatus.ACCEPTED,
            )
            events.emit_driver_change(vehicle, None, driver)
        return vehicle


# --- Recursos que cuelgan del vehículo -----------------------------------


class ContractSerializer(serializers.ModelSerializer):
    class Meta:
        model = Contract
        fields = "__all__"
        read_only_fields = ["id", "created_at", "updated_at"]


class KmReadingSerializer(serializers.ModelSerializer):
    class Meta:
        model = KmReading
        fields = "__all__"
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate(self, attrs):
        # HU-3.1: el odómetro no puede retroceder (valida contra la última lectura).
        vehicle = attrs.get("vehicle", getattr(self.instance, "vehicle", None))
        km = attrs.get("km_reading", getattr(self.instance, "km_reading", None))
        if vehicle is not None and km is not None:
            qs = KmReading.objects.filter(vehicle=vehicle, km_reading__isnull=False)
            if self.instance is not None:
                qs = qs.exclude(pk=self.instance.pk)
            previous = qs.order_by("-reading_date", "-id").first()
            if previous and km < previous.km_reading:
                raise serializers.ValidationError(
                    {
                        "km_reading": (
                            f"El odómetro no puede retroceder (última: {previous.km_reading} km)."
                        )
                    }
                )
        return attrs


class AssignmentSerializer(serializers.ModelSerializer):
    driver_name = serializers.SerializerMethodField()

    class Meta:
        model = Assignment
        fields = "__all__"
        read_only_fields = ["id", "created_at", "updated_at"]

    def get_driver_name(self, obj) -> str:
        return obj.driver.get_full_name() or obj.driver.get_username()

    def validate(self, attrs):
        vehicle = attrs.get("vehicle", getattr(self.instance, "vehicle", None))
        if vehicle is not None and vehicle.state == VehicleState.BAJA:
            raise serializers.ValidationError(
                "No se puede asignar un conductor a un vehículo en baja."
            )
        # El usuario asignado debe tener rol de conductor (HU-2.1).
        driver = attrs.get("driver", getattr(self.instance, "driver", None))
        if driver is not None and not driver.is_driver:
            raise serializers.ValidationError(
                {"driver": "El usuario asignado no tiene rol de conductor."}
            )
        # HU-2.3: fin ≥ inicio (fin == inicio es válido: así cierra la gestión
        # la asignación vigente al aceptar una nueva).
        start = attrs.get("start_date", getattr(self.instance, "start_date", None))
        end = attrs.get("end_date", getattr(self.instance, "end_date", None))
        if start and end and end < start:
            raise serializers.ValidationError(
                {"end_date": "La fecha de fin no puede ser anterior a la de inicio."}
            )
        return attrs


class VehicleUsageSerializer(serializers.ModelSerializer):
    class Meta:
        model = VehicleUsage
        fields = "__all__"
        read_only_fields = ["id", "created_at", "updated_at"]


class UsageSplitItemSerializer(serializers.Serializer):
    """Línea del reparto de uso: persona + porcentaje."""

    driver = serializers.PrimaryKeyRelatedField(queryset=get_user_model().objects.all())
    usage_percent = serializers.DecimalField(
        max_digits=5, decimal_places=2, min_value=Decimal("0"), max_value=Decimal("100")
    )


class UsageSplitSerializer(serializers.Serializer):
    """Reparto completo de un vehículo (HU-2.5): la suma debe ser EXACTAMENTE 100.

    Se aplica de una vez (endpoint compuesto): cierra el reparto vigente y crea
    el nuevo en una transacción — así el invariante "suma 100 por periodo" no se
    rompe fila a fila.
    """

    vehicle = serializers.PrimaryKeyRelatedField(queryset=Vehicle.objects.all())
    start_date = serializers.DateField()
    end_date = serializers.DateField(required=False, allow_null=True)
    items = UsageSplitItemSerializer(many=True, allow_empty=False)

    def validate(self, attrs):
        end = attrs.get("end_date")
        if end and end < attrs["start_date"]:
            raise serializers.ValidationError(
                {"end_date": "La fecha de fin no puede ser anterior a la de inicio."}
            )
        drivers = [item["driver"].pk for item in attrs["items"]]
        if len(drivers) != len(set(drivers)):
            raise serializers.ValidationError({"items": "Hay personas repetidas en el reparto."})
        total = sum(item["usage_percent"] for item in attrs["items"])
        if total != Decimal("100"):
            raise serializers.ValidationError(
                {"items": f"La suma de porcentajes debe ser exactamente 100 (suma {total})."}
            )
        return attrs


class VehicleLinkSerializer(serializers.ModelSerializer):
    class Meta:
        model = VehicleLink
        fields = "__all__"
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate(self, attrs):
        # HU-1.8: validar aquí lo que la constraint garantiza en BD, para que el
        # cliente reciba un 400 legible y no un IntegrityError (500).
        main = attrs.get("main_vehicle", getattr(self.instance, "main_vehicle", None))
        substitute = attrs.get(
            "substitute_vehicle", getattr(self.instance, "substitute_vehicle", None)
        )
        if main is not None and substitute is not None and main == substitute:
            raise serializers.ValidationError(
                {"substitute_vehicle": "El sustituto no puede ser el propio vehículo."}
            )
        end_date = attrs.get("end_date", getattr(self.instance, "end_date", None))
        if main is not None and end_date is None:
            existing = VehicleLink.objects.filter(main_vehicle=main, end_date__isnull=True)
            if self.instance is not None:
                existing = existing.exclude(pk=self.instance.pk)
            if existing.exists():
                raise serializers.ValidationError(
                    "El vehículo ya tiene un sustituto activo; cierra ese vínculo primero."
                )
        return attrs


# Tipos de evento que se pueden registrar A MANO por la API (Fase A1). El resto
# los emiten los procesos de negocio (alta, cambios de estado/conductor, km…).
MANUAL_EVENT_TYPES = {EventType.ITV, EventType.FEE_CHANGE, EventType.LOCATION_CHANGE}


class EventItvSerializer(serializers.ModelSerializer):
    class Meta:
        model = EventItv
        fields = ["result", "next_due"]


class EventFeeChangeSerializer(serializers.ModelSerializer):
    class Meta:
        model = EventFeeChange
        fields = ["old_fee", "new_fee"]


class EventLocationChangeSerializer(serializers.ModelSerializer):
    class Meta:
        model = EventLocationChange
        fields = ["old_location", "new_location"]


class EventSerializer(serializers.ModelSerializer):
    """Histórico de eventos + alta manual (HU-5.1/1.4).

    Alta manual solo de `MANUAL_EVENT_TYPES`, con el detalle anidado que toque:
    `itv` (registrar ITV → la señal cierra alertas y refresca `next_itv_date`),
    `fee_change` (cuota) o `location_change` (ubicación). El conductor solo
    puede registrar ITV (de sus vehículos, por scoping); la gestión, los tres.
    """

    event_type_display = serializers.CharField(source="get_event_type_display", read_only=True)
    itv = EventItvSerializer(write_only=True, required=False)
    fee_change = EventFeeChangeSerializer(write_only=True, required=False)
    location_change = EventLocationChangeSerializer(write_only=True, required=False)
    details = serializers.SerializerMethodField()

    class Meta:
        model = Event
        fields = "__all__"
        read_only_fields = ["id", "created_at", "updated_at"]

    def get_details(self, obj) -> dict | None:
        # Reverse one-to-one: si el subtipo no existe, getattr devuelve None
        # (RelatedObjectDoesNotExist hereda de AttributeError).
        itv = getattr(obj, "itv", None)
        if itv:
            return {"kind": "itv", "result": itv.result, "next_due": itv.next_due}
        fee = getattr(obj, "fee_change", None)
        if fee:
            return {"kind": "fee_change", "old_fee": fee.old_fee, "new_fee": fee.new_fee}
        loc = getattr(obj, "location_change", None)
        if loc:
            return {
                "kind": "location_change",
                "old_location": loc.old_location,
                "new_location": loc.new_location,
            }
        drv = getattr(obj, "driver_change", None)
        if drv:
            return {
                "kind": "driver_change",
                "old_driver": drv.old_driver_id,
                "new_driver": drv.new_driver_id,
            }
        penalty = getattr(obj, "penalty", None)
        if penalty:
            return {"kind": "penalty", "amount": penalty.amount, "paid": penalty.paid}
        return None

    def validate(self, attrs):
        if self.instance is not None:  # los eventos no se editan por la API
            return attrs
        event_type = attrs.get("event_type")
        if event_type not in MANUAL_EVENT_TYPES:
            valid = ", ".join(sorted(MANUAL_EVENT_TYPES))
            raise serializers.ValidationError(
                {"event_type": f"Solo se registran a mano estos tipos: {valid}."}
            )
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if user is not None and not user.is_management and event_type != EventType.ITV:
            raise serializers.ValidationError(
                {"event_type": "El conductor solo puede registrar ITV."}
            )
        if event_type == EventType.ITV:
            itv = attrs.get("itv")
            if not itv or not itv.get("next_due"):
                raise serializers.ValidationError(
                    {"itv": "Registrar una ITV requiere `itv.next_due` (próxima fecha)."}
                )
        return attrs

    def create(self, validated_data):
        itv = validated_data.pop("itv", None)
        fee_change = validated_data.pop("fee_change", None)
        location_change = validated_data.pop("location_change", None)
        validated_data.setdefault("event_date", timezone.localdate())
        event = Event.objects.create(**validated_data)
        # El subtipo se crea después: la señal post_save de EventItv es la que
        # cierra las alertas de ITV y refresca `next_itv_date` (HU-5.1).
        if itv:
            EventItv.objects.create(event=event, **itv)
        if fee_change:
            EventFeeChange.objects.create(event=event, **fee_change)
        if location_change:
            EventLocationChange.objects.create(event=event, **location_change)
        return event


def _https_only(value: str) -> str:
    """Las URLs de Drive que llegan del cliente deben ser https (patrón `list`):
    corta `javascript:`/`data:`/http plano antes de que lleguen a un href."""
    if value and not value.startswith("https://"):
        raise serializers.ValidationError("La URL debe empezar por https://.")
    return value


class InvoiceSerializer(serializers.ModelSerializer):
    class Meta:
        model = Invoice
        fields = "__all__"
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate_drive_url(self, value):
        return _https_only(value)


class InvoiceAllocationSerializer(serializers.ModelSerializer):
    class Meta:
        model = InvoiceAllocation
        fields = "__all__"
        read_only_fields = ["id", "created_at", "updated_at"]


class AllocationLineSerializer(serializers.Serializer):
    """Línea de refacturación: destino (proyecto o PEP/CECO) + % (y/o importe)."""

    target_type = serializers.ChoiceField(choices=AllocationTarget.choices)
    project = serializers.PrimaryKeyRelatedField(
        queryset=Project.objects.all(), required=False, allow_null=True
    )
    cost_center = serializers.PrimaryKeyRelatedField(
        queryset=Pep.objects.all(), required=False, allow_null=True
    )
    percentage = serializers.DecimalField(
        max_digits=5, decimal_places=2, min_value=Decimal("0"), max_value=Decimal("100")
    )
    amount = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=False, allow_null=True
    )

    def validate(self, attrs):
        if attrs["target_type"] == AllocationTarget.PROJECT and not attrs.get("project"):
            raise serializers.ValidationError(
                {"project": "Obligatorio cuando el destino es 'Proyecto'."}
            )
        if attrs["target_type"] == AllocationTarget.PEP and not attrs.get("cost_center"):
            raise serializers.ValidationError(
                {"cost_center": "Obligatorio cuando el destino es 'PEP / CECO'."}
            )
        return attrs


class InvoiceAllocateSerializer(serializers.Serializer):
    """Reparto completo de una factura (Épica 7): los % deben sumar 100.

    Sustituye las imputaciones existentes en una transacción. Si una línea no
    trae `amount`, se calcula desde el importe de la factura (% × total / 100).
    """

    lines = AllocationLineSerializer(many=True, allow_empty=False)

    def validate(self, attrs):
        total = sum(line["percentage"] for line in attrs["lines"])
        if total != Decimal("100"):
            raise serializers.ValidationError(
                {"lines": f"Los porcentajes deben sumar exactamente 100 (suman {total})."}
            )
        invoice: Invoice = self.context["invoice"]
        if invoice.amount is None and any(line.get("amount") is None for line in attrs["lines"]):
            raise serializers.ValidationError(
                {"lines": "La factura no tiene importe: indica el importe de cada línea."}
            )
        return attrs


# --- Documentación e incidencias (Épica 4 / 6) ---------------------------


class IncidentSerializer(serializers.ModelSerializer):
    type_display = serializers.CharField(source="get_type_display", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = Incident
        fields = "__all__"
        read_only_fields = ["id", "created_at", "updated_at"]


# Extensiones admitidas en la subida de documentos (fotos de cámara + PDF).
DOCUMENT_ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "webp", "heic", "pdf"}


class DocumentSerializer(serializers.ModelSerializer):
    type_display = serializers.CharField(source="get_type_display", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    uploaded_by_name = serializers.SerializerMethodField()
    file_url = serializers.SerializerMethodField()

    class Meta:
        model = Document
        fields = "__all__"
        # uploaded_by lo fija el servidor (el usuario de la petición).
        read_only_fields = ["id", "uploaded_by", "created_at", "updated_at"]

    def get_uploaded_by_name(self, obj) -> str:
        user = obj.uploaded_by
        if not user:
            return ""
        return user.get_full_name() or user.get_username()

    def get_file_url(self, obj) -> str:
        if not obj.file:
            return ""
        request = self.context.get("request")
        url = obj.file.url
        return request.build_absolute_uri(url) if request else url

    def validate_drive_url(self, value):
        return _https_only(value)

    def validate_file(self, value):
        if value is None:
            return value
        max_mb = settings.FLEET_DOCUMENT_MAX_MB
        if value.size > max_mb * 1024 * 1024:
            raise serializers.ValidationError(f"El fichero supera el máximo de {max_mb} MB.")
        extension = Path(value.name).suffix.lower().lstrip(".")
        if extension not in DOCUMENT_ALLOWED_EXTENSIONS:
            valid = ", ".join(sorted(DOCUMENT_ALLOWED_EXTENSIONS))
            raise serializers.ValidationError(
                f"Extensión '.{extension}' no admitida. Válidas: {valid}."
            )
        return value

    def validate(self, attrs):
        # HU-4.1: subir un documento exige el binario o, al menos, su URL.
        if self.instance is None and not attrs.get("file") and not attrs.get("drive_url"):
            raise serializers.ValidationError(
                "Adjunta un fichero (`file`) o indica la URL del documento (`drive_url`)."
            )
        return attrs


# --- Alertas (Épicas 3/5/10) ---------------------------------------------


class AlertSerializer(serializers.ModelSerializer):
    type_display = serializers.CharField(source="get_type_display", read_only=True)
    level_display = serializers.CharField(source="get_level_display", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    vehicle_plate = serializers.CharField(source="vehicle.plate", read_only=True, default="")

    class Meta:
        model = Alert
        fields = "__all__"
        # Las alertas las generan los trabajos programados; por API solo se
        # cambian de estado (resolver/descartar) vía acciones dedicadas.
        read_only_fields = [
            "id",
            "type",
            "level",
            "vehicle",
            "user",
            "message",
            "due_date",
            "dedup_key",
            "status",
            "resolved_at",
            "resolved_by",
            "created_at",
            "updated_at",
        ]


# --- Solicitudes de vehículo (Épica 8) -----------------------------------


class VehicleRequestSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    requester_name = serializers.SerializerMethodField()

    class Meta:
        model = VehicleRequest
        fields = "__all__"
        read_only_fields = ["id", "created_at", "updated_at"]

    def get_requester_name(self, obj) -> str:
        user = obj.requester
        if not user:
            return ""
        return user.get_full_name() or user.get_username()


class VehicleRequestMineSerializer(serializers.ModelSerializer):
    """Solicitud self-service del usuario sin vehículo (Fase A2).

    El usuario abre el ticket en Jira y registra aquí su clave para el
    seguimiento. `requester` y `status` los fija el servidor: la solicitud nace
    `pending` y se aprueba por la sincronización con Jira o a mano por la
    administración (conceder = asignar vehículo).
    """

    status_display = serializers.CharField(source="get_status_display", read_only=True)
    vehicle_plate = serializers.CharField(source="vehicle.plate", read_only=True, default="")

    class Meta:
        model = VehicleRequest
        fields = [
            "id",
            "requested_type",
            "start_date",
            "end_date",
            "jira_key",
            "notes",
            "status",
            "status_display",
            "vehicle",
            "vehicle_plate",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "status", "vehicle", "created_at", "updated_at"]

    def validate_jira_key(self, value):
        value = (value or "").strip()
        if value:
            qs = VehicleRequest.objects.filter(jira_key=value)
            if self.instance is not None:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError(
                    "Ese ticket de Jira ya está asociado a otra solicitud."
                )
        return value

    def validate(self, attrs):
        start = attrs.get("start_date", getattr(self.instance, "start_date", None))
        end = attrs.get("end_date", getattr(self.instance, "end_date", None))
        if start and end and end < start:
            raise serializers.ValidationError(
                {"end_date": "La fecha de fin no puede ser anterior a la de inicio."}
            )
        return attrs


# --- Catálogos ------------------------------------------------------------


class CountrySerializer(serializers.ModelSerializer):
    class Meta:
        model = Country
        fields = ["id", "name"]


class BusinessUnitSerializer(serializers.ModelSerializer):
    class Meta:
        model = BusinessUnit
        fields = ["id", "code", "name"]


class ProjectSerializer(serializers.ModelSerializer):
    # Obligatorio en altas (el modelo es nullable solo por las filas legacy).
    # En PATCH parcial no se exige, así los proyectos antiguos siguen editables.
    cost_center = serializers.PrimaryKeyRelatedField(
        queryset=Pep.objects.all(), required=True, allow_null=False
    )
    cost_center_display = serializers.StringRelatedField(
        source="cost_center", read_only=True
    )

    class Meta:
        model = Project
        fields = ["id", "project_name", "cost_center", "cost_center_display"]


class PepSerializer(serializers.ModelSerializer):
    class Meta:
        model = Pep
        fields = ["id", "code", "name"]


class RentingSerializer(serializers.ModelSerializer):
    class Meta:
        model = Renting
        fields = ["id", "name"]
