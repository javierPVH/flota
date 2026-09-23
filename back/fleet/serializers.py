import re
from datetime import timedelta
from decimal import Decimal
from pathlib import Path

from auditlog.models import LogEntry
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import models
from django.utils import timezone
from rest_framework import serializers

from .exceptions import InactiveConflict
from .models import (
    AccidentInjured,
    AccidentReport,
    AccidentThirdParty,
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
    EventFeeChange,
    EventItv,
    EventLocationChange,
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
    assignment_overlap_message,
    driver_assignment_clash,
    driver_clash_message,
    supervisor_overlap_message,
    supervisor_period_overlap,
    vehicle_assignment_overlap,
)
from .models.enums import (
    ALERT_LINKABLE_DOCUMENT_TYPES,
    EVENT_LINKABLE_DOCUMENT_TYPES,
    EXPIRING_DOCUMENT_TYPES,
    INCIDENT_BOUND_DOCUMENT_TYPES,
    LINK_REQUIRED_DOCUMENT_TYPES,
    TIRE_POSITIONS,
    AlertStatus,
    AllocationTarget,
    AssignmentStatus,
    DocumentType,
    EventType,
    IncidentLiability,
    IncidentStatus,
    IncidentType,
    ItvResult,
    UseType,
    VehicleState,
)
from .selectors import current_driver_map, latest_reading_map
from .services import document_requests, profile_requests, vehicle_requests


class LogEntrySerializer(serializers.ModelSerializer):
    """Entrada de auditoría de campos (django-auditlog) para el histórico."""

    action = serializers.CharField(source="get_action_display", read_only=True)
    actor = serializers.SerializerMethodField()
    changes = serializers.SerializerMethodField()
    # Modelo de origen (vehicle/contract/assignment/…) y su representación, para
    # que el histórico exhaustivo pueda etiquetar de dónde viene cada cambio.
    model = serializers.SerializerMethodField()
    object_repr = serializers.CharField(read_only=True)
    # Reversión (services.audit_revert): `reverts` es el id de la entrada que
    # esta deshizo, y `revertible` si ESTA se puede deshacer desde la ficha.
    reverts = serializers.SerializerMethodField()
    revertible = serializers.SerializerMethodField()

    class Meta:
        model = LogEntry
        fields = [
            "id",
            "action",
            "actor",
            "changes",
            "model",
            "object_repr",
            "timestamp",
            "reverts",
            "revertible",
        ]
        read_only_fields = fields

    def get_reverts(self, obj) -> int | None:
        data = obj.additional_data if isinstance(obj.additional_data, dict) else {}
        value = data.get("reverts")
        return int(value) if isinstance(value, int) else None

    def get_revertible(self, obj) -> bool:
        from .services import audit_revert

        return audit_revert.is_revertible(obj)

    def get_actor(self, obj) -> str:
        actor = obj.actor
        if not actor:
            return ""
        return actor.get_full_name() or actor.get_username()

    def get_model(self, obj) -> str:
        return obj.content_type.model if obj.content_type_id else ""

    def get_changes(self, obj) -> dict:
        # En auditlog 3.x `changes` ya es dict; defensivo por si viniera como texto.
        return obj.changes if isinstance(obj.changes, dict) else obj.changes_dict


def _validate_contract_dates(attrs: dict, instance=None) -> dict:
    """R3-17: fin previsto y fin real nunca anteriores al inicio.

    Sin esto el dato malo no rompía nada aguas abajo (las proyecciones
    descartan `total_days <= 0`) pero quedaba guardado y silenciosamente
    excluido de proyecciones y alertas de km — un contrato «invisible».
    """
    start = attrs.get("start_date", getattr(instance, "start_date", None))
    planned = attrs.get("planned_end_date", getattr(instance, "planned_end_date", None))
    end = attrs.get("end_date", getattr(instance, "end_date", None))
    if start and planned and planned < start:
        raise serializers.ValidationError(
            {"planned_end_date": "El fin previsto no puede ser anterior al inicio."}
        )
    if start and end and end < start:
        raise serializers.ValidationError(
            {"end_date": "El fin real no puede ser anterior al inicio."}
        )
    return attrs


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

    def validate(self, attrs):
        return _validate_contract_dates(attrs)


class VehicleSerializer(serializers.ModelSerializer):
    """Serializer de vehículo (nuevo esquema).

    El conductor se relaciona vía `Assignment`, no con un campo directo. Se
    exponen etiquetas legibles y el nombre del supervisor para pintar sin joins
    extra en el front.
    """

    state_display = serializers.CharField(source="get_state_display", read_only=True)
    supervisor_name = serializers.SerializerMethodField()
    driver_name = serializers.SerializerMethodField()
    driver_id = serializers.SerializerMethodField()
    # GAP-2: última anotación del consumo medio (valor y fecha). Va en el
    # LISTADO porque la tabla de gestion lo pinta como columna y no carga
    # summaries; el mapa se calcula una vez por respuesta, como el conductor.
    fuel_avg_consumption = serializers.SerializerMethodField()
    fuel_avg_date = serializers.SerializerMethodField()
    # Última lectura de km (valor, fecha y si fue estimada): mismo motivo y
    # mismo patrón que el gasto del mes — la tabla de gestión la pinta como
    # columna (kilómetros + cuánto lleva sin leerse) y no carga los summaries.
    km_current = serializers.SerializerMethodField()
    km_reading_date = serializers.SerializerMethodField()
    km_estimated = serializers.SerializerMethodField()
    # N5: marca/modelo por catálogo. Los CharField legados pasan a opcionales
    # (se rellenan desde las FKs); los fronts leen brand/model como siempre.
    brand = serializers.CharField(required=False, allow_blank=False, max_length=50)
    model = serializers.CharField(required=False, allow_blank=False, max_length=50)
    # GAP-1: combustible por catálogo — mismo esquema que brand/brand_ref.
    fuel = serializers.CharField(required=False, allow_blank=True, max_length=60)
    site_display = serializers.StringRelatedField(source="site", read_only=True)
    company_display = serializers.StringRelatedField(source="company", read_only=True)
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
            "brand_ref",
            "model_ref",
            "company",
            "company_display",
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
            "site",
            "site_display",
            "fuel",
            "fuel_ref",
            "fuel_card",
            "type",
            "size",
            "market_segment",
            "veh_use",
            "property",
            "business_use",
            "consumption",
            "km_start",
            "km_end",
            "unlimited_km",
            "insurance_expiry_date",
            "next_itv_date",
            "next_itv_manual",
            "itv_postal_code",
            "driver_name",
            "driver_id",
            "fuel_avg_consumption",
            "fuel_avg_date",
            "km_current",
            "km_reading_date",
            "km_estimated",
            "drive_folder_url",
            "drive_folder_id",
            "contract",
            "driver",
            "created_at",
            "updated_at",
        ]
        # next_itv_date lo mantiene el job refresh_next_itv (denormalizado) o
        # el gesto de programar la cita (`/schedule-itv/`), que es también el
        # único que fija `next_itv_manual` y el CP preferente.
        # La carpeta de Drive la mantiene el archivador (Fase A3).
        # updated_at se expone para el bloqueo optimista (expected_updated_at).
        read_only_fields = [
            "id",
            "next_itv_date",
            "next_itv_manual",
            "itv_postal_code",
            "driver_id",
            "fuel_avg_consumption",
            "fuel_avg_date",
            "km_current",
            "km_reading_date",
            "km_estimated",
            "drive_folder_url",
            "drive_folder_id",
            "created_at",
            "updated_at",
        ]

    def to_internal_value(self, data):
        """INP-7: la matrícula se normaliza (mayúsculas, sin espacios) ANTES de
        que corra el validador del modelo, igual que hace el importador; el
        formulario de gestión la manda tal cual se teclea."""
        plate = data.get("plate") if hasattr(data, "get") else None
        if isinstance(plate, str):
            normalizada = plate.strip().upper().replace(" ", "")
            if normalizada != plate:
                data = data.copy()
                data["plate"] = normalizada
        return super().to_internal_value(data)

    def get_supervisor_name(self, obj: Vehicle) -> str:
        sup = obj.supervisor
        if not sup:
            return ""
        return sup.get_full_name() or sup.get_username()

    def _response_map(self, key: str, obj: Vehicle, build) -> dict:
        """Mapa por vehículo calculado UNA vez por respuesta (cacheado en el
        context) a partir de los ids de la página: lo que el listado necesita y
        no sale del `select_related` (conductor vigente, gasto del mes) se
        resuelve en bloque, no fila a fila — es el N+1 clásico de este modelo."""
        cached = self.context.get(key)
        if cached is None:
            # En listado, `parent.instance` es la página; en detalle, el objeto.
            instance = self.parent.instance if self.parent is not None else obj
            ids = (
                [v.id for v in instance]
                if isinstance(instance, list | models.QuerySet)
                else [obj.id]
            )
            cached = build(ids)
            self.context[key] = cached
        return cached

    def _current_driver(self, obj: Vehicle):
        """Conductor vigente (HU-1.1)."""
        return self._response_map("_current_drivers", obj, current_driver_map).get(obj.id)

    def get_driver_name(self, obj: Vehicle) -> str:
        driver = self._current_driver(obj)
        return (driver.get_full_name() or driver.get_username()) if driver else ""

    def get_driver_id(self, obj: Vehicle) -> int | None:
        # Id del conductor vigente: permite enlazar a su ficha desde el listado.
        driver = self._current_driver(obj)
        return driver.id if driver else None

    @staticmethod
    def _fuel_latest_map(ids: list[int]) -> dict[int, dict]:
        """Última anotación del consumo medio ya en la forma que sale por la
        API: cadena de dos decimales, la MISMA que emite el summary
        (`metrics.decimal_str`), y la fecha."""
        from .services.metrics import decimal_str, fuel_latest_map

        return {
            vehicle_id: {
                "avg_consumption": decimal_str(row["avg_consumption"]),
                # ISO ya aquí: es lo que viaja y lo que compara el front.
                "reading_date": row["reading_date"].isoformat() if row["reading_date"] else None,
            }
            for vehicle_id, row in fuel_latest_map(ids).items()
        }

    def _fuel_latest(self, obj: Vehicle) -> dict:
        return self._response_map("_fuel_latest", obj, self._fuel_latest_map).get(obj.id) or {}

    def get_fuel_avg_consumption(self, obj: Vehicle) -> str | None:
        return self._fuel_latest(obj).get("avg_consumption")

    def get_fuel_avg_date(self, obj: Vehicle):
        return self._fuel_latest(obj).get("reading_date")

    def _latest_reading(self, obj: Vehicle):
        """Última lectura de km del vehículo (N8). Una consulta por respuesta,
        no una por fila: el mapa es el mismo que usan los summaries."""
        return self._response_map("_latest_readings", obj, latest_reading_map).get(obj.id)

    def get_km_current(self, obj: Vehicle) -> int | None:
        reading = self._latest_reading(obj)
        return reading.km_reading if reading else None

    def get_km_reading_date(self, obj: Vehicle) -> str | None:
        reading = self._latest_reading(obj)
        return reading.reading_date.isoformat() if reading and reading.reading_date else None

    def get_km_estimated(self, obj: Vehicle) -> bool:
        reading = self._latest_reading(obj)
        return bool(reading.estimated) if reading else False

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
            # N9: el tipo (flota / sustitución) se fija al crear. Sustituto →
            # flota va por la acción explícita convert-to-fleet; flota →
            # sustituto está prohibido.
            new_type = attrs.get("is_substitute", self.instance.is_substitute)
            if new_type != self.instance.is_substitute:
                raise serializers.ValidationError(
                    {
                        "is_substitute": (
                            "El tipo se fija al crear el vehículo. Un sustituto puede pasar "
                            "a flota con la acción 'convertir en flota'; un coche de flota "
                            "no puede convertirse en sustituto."
                        )
                    }
                )
        driver = attrs.get("driver")
        if driver is not None and not driver.is_driver:
            raise serializers.ValidationError(
                {"driver": "El usuario asignado no tiene rol de conductor."}
            )
        # R5-03: el supervisor, con rol y activo (misma regla que en set-driver
        # y en los periodos de supervisor).
        if attrs.get("supervisor") is not None:
            from .services import supervisors

            supervisors.validate_supervisor(attrs["supervisor"])
        # N3: con km ilimitados los km contratados no aplican — se limpian en el
        # alta para que no quede una cifra que nunca se usará.
        unlimited = attrs.get("unlimited_km", getattr(self.instance, "unlimited_km", False))
        if unlimited and attrs.get("contract"):
            attrs["contract"]["contract_km"] = None
        # N5: coherencia marca↔modelo y denormalización del texto legado.
        brand_ref = attrs.get("brand_ref", getattr(self.instance, "brand_ref", None))
        model_ref = attrs.get("model_ref", getattr(self.instance, "model_ref", None))
        if model_ref is not None and brand_ref is not None and model_ref.brand_id != brand_ref.id:
            raise serializers.ValidationError(
                {"model_ref": "El modelo no pertenece a la marca elegida."}
            )
        if model_ref is not None and brand_ref is None:
            raise serializers.ValidationError(
                {"brand_ref": "Elige la marca del modelo (el modelo depende de la marca)."}
            )
        if brand_ref is not None:
            attrs["brand"] = brand_ref.name
        if model_ref is not None:
            attrs["model"] = model_ref.name
        # GAP-1: la FK manda — el texto denormalizado siempre es su nombre.
        fuel_ref = attrs.get("fuel_ref", getattr(self.instance, "fuel_ref", None))
        if fuel_ref is not None and "fuel_ref" in attrs:
            attrs["fuel"] = fuel_ref.name
        if self.instance is None and not attrs.get("brand"):
            raise serializers.ValidationError({"brand": "Indica la marca (catálogo o texto)."})
        if self.instance is None and not attrs.get("model"):
            raise serializers.ValidationError({"model": "Indica el modelo (catálogo o texto)."})
        # El alta con conductor crea una asignación aceptada desde hoy: la
        # regla "un coche por conductor" se comprueba antes de crear nada.
        alta_driver = attrs.get("driver")
        if self.instance is None and alta_driver is not None:
            clash = driver_assignment_clash(
                alta_driver.pk,
                is_substitute=attrs.get("is_substitute", False),
                start_date=timezone.localdate(),
            )
            if clash:
                raise serializers.ValidationError({"driver": driver_clash_message(clash)})
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
        read_only_fields = [
            "id",
            "is_active",
            "deactivated_at",
            "deactivated_by",
            "deactivation_reason",
            "created_at",
            "updated_at",
        ]

    def validate(self, attrs):
        return _validate_contract_dates(attrs, self.instance)


class KmReadingSerializer(serializers.ModelSerializer):
    class Meta:
        model = KmReading
        fields = "__all__"
        # N7: la desactivación solo cambia por destroy/erratas, nunca por PATCH.
        # N8b: `estimated` lo fija el endpoint de completar faltantes.
        read_only_fields = [
            "id",
            "estimated",
            "is_active",
            "deactivated_at",
            "deactivated_by",
            "deactivation_reason",
            "created_at",
            "updated_at",
        ]

    def validate_reading_date(self, value):
        # SEC2: sin cota superior, una lectura fechada en el futuro bloquearía
        # (por el no-retroceso) los registros legítimos posteriores.
        if value and value > timezone.localdate():
            raise serializers.ValidationError("La fecha de lectura no puede ser futura.")
        return value

    def validate(self, attrs):
        # N9: un principal bloqueado por sustitución no admite lecturas — se
        # registra sobre el sustituto mientras dure el vínculo.
        from .selectors import active_link_blocking

        vehicle_for_block = attrs.get("vehicle", getattr(self.instance, "vehicle", None))
        if self.instance is None and vehicle_for_block is not None:
            link = active_link_blocking(vehicle_for_block)
            if link is not None:
                raise serializers.ValidationError(
                    {
                        "vehicle": (
                            "Vehículo bloqueado por sustitución — registra los km sobre "
                            f"{link.substitute_vehicle.plate}."
                        )
                    }
                )
        # N8a: el personal de campo solo registra en la ventana [día 20, fin de
        # mes]. Exento el ADMIN, no `is_management`: esa propiedad incluye al
        # supervisor, que es personal de CAMPO (usa la app móvil, ver README) y
        # a quien el plan 8a sujeta a la ventana igual que al conductor.
        # Mensaje explícito: la cola offline lo muestra tal cual cuando un
        # registro encolado llega fuera de plazo.
        from .services import km_window

        request = self.context.get("request")
        if (
            self.instance is None
            and request is not None
            and request.user.is_authenticated
            and not request.user.is_admin
            and not km_window.field_window_open()
        ):
            raise serializers.ValidationError({"reading_date": km_window.field_window_message()})
        # HU-3.1: el odómetro no puede retroceder (valida contra la última lectura).
        vehicle = attrs.get("vehicle", getattr(self.instance, "vehicle", None))
        km = attrs.get("km_reading", getattr(self.instance, "km_reading", None))
        if vehicle is not None and km is not None:
            qs = KmReading.objects.filter(vehicle=vehicle, km_reading__isnull=False, is_active=True)
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


class FuelConsumptionSerializer(serializers.ModelSerializer):
    """GAP-2: anotación del consumo medio del ordenador de a bordo en una fecha."""

    vehicle_plate = serializers.CharField(source="vehicle.plate", read_only=True)

    class Meta:
        model = FuelConsumption
        fields = [
            "id",
            "vehicle",
            "vehicle_plate",
            "reading_date",
            "avg_consumption",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate_reading_date(self, value):
        """Se anota lo que marcaba el ordenador ese día: nunca un día futuro."""
        if value > timezone.localdate():
            raise serializers.ValidationError("La fecha no puede ser futura.")
        return value

    def validate_avg_consumption(self, value):
        if value < 0:
            raise serializers.ValidationError("El consumo no puede ser negativo.")
        return value


class MaintenanceProgramSerializer(serializers.ModelSerializer):
    """Programa del catálogo común: el «cada cuánto» que comparte la flota."""

    cycle_label = serializers.CharField(read_only=True)

    class Meta:
        model = MaintenanceProgram
        fields = [
            "id",
            "name",
            "every_km",
            "every_months",
            "cycle_label",
            "notes",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "cycle_label", "created_at", "updated_at"]

    def validate(self, attrs):
        """Las reglas del ciclo son del modelo (`MaintenanceProgram.clean`)."""
        attrs = super().validate(attrs)
        instance = self.instance
        candidato = MaintenanceProgram(
            every_km=attrs.get("every_km", getattr(instance, "every_km", None)),
            every_months=attrs.get("every_months", getattr(instance, "every_months", None)),
        )
        try:
            candidato.clean()
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.message_dict) from exc
        # El nombre es único en el catálogo (lo hay ya a nivel de BD, pero un
        # 500 por IntegrityError no dice qué pasa).
        nombre = str(attrs.get("name", getattr(instance, "name", "") or "")).strip()
        if nombre:
            gemelos = MaintenanceProgram.objects.filter(name__iexact=nombre)
            if instance is not None:
                gemelos = gemelos.exclude(pk=instance.pk)
            if gemelos.exists():
                raise serializers.ValidationError(
                    {"name": f"«{nombre}» ya está en el catálogo de programas."}
                )
        return attrs


class MaintenancePlanSerializer(serializers.ModelSerializer):
    """GAP-8: el mantenimiento programado de un vehículo (uno a la vez)."""

    vehicle_plate = serializers.CharField(source="vehicle.plate", read_only=True)
    program_name = serializers.CharField(source="program.name", read_only=True, default="")

    class Meta:
        model = MaintenancePlan
        fields = [
            "id",
            "vehicle",
            "vehicle_plate",
            "program",
            "program_name",
            "name",
            "every_km",
            "every_months",
            "last_done_date",
            "last_done_km",
            "workshop_postal_code",
            "notes",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate(self, attrs):
        """Delega en `MaintenancePlan.clean` para no duplicar las reglas."""
        attrs = super().validate(attrs)
        instance = self.instance
        datos = {
            campo: attrs.get(campo, getattr(instance, campo, None))
            for campo in ("every_km", "every_months", "last_done_date", "last_done_km")
        }
        candidato = MaintenancePlan(**datos)
        try:
            candidato.clean()
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.message_dict) from exc

        errores: dict[str, str] = {}
        # CP preferente: el mismo formato que el del parte de una incidencia.
        postal_code = attrs.get(
            "workshop_postal_code", getattr(instance, "workshop_postal_code", "")
        )
        if postal_code and (not str(postal_code).isdigit() or len(str(postal_code)) != 5):
            errores["workshop_postal_code"] = "Indica un código postal de 5 cifras."

        # UN mantenimiento programado por vehículo: el que ya existe se
        # modifica o se resuelve (es lo que ofrece «Programar ITV y
        # mantenimiento»; sin esto, cada visita al modal apilaba otro ciclo del
        # mismo coche y el vencimiento salía duplicado en las alertas).
        vehicle = attrs.get("vehicle", getattr(instance, "vehicle", None))
        if vehicle is not None:
            gemelos = MaintenancePlan.objects.filter(vehicle=vehicle, is_active=True)
            if instance is not None:
                gemelos = gemelos.exclude(pk=instance.pk)
            otro = gemelos.first()
            if otro is not None:
                errores["vehicle"] = (
                    f"El vehículo ya tiene un mantenimiento programado («{otro.name}»): "
                    "modifícalo o resuélvelo antes de programar otro."
                )
        if errores:
            raise serializers.ValidationError(errores)
        return attrs


class AssignmentSerializer(serializers.ModelSerializer):
    driver_name = serializers.SerializerMethodField()

    class Meta:
        model = Assignment
        fields = "__all__"
        read_only_fields = [
            "id",
            "is_active",
            "deactivated_at",
            "deactivated_by",
            "deactivation_reason",
            "created_at",
            "updated_at",
        ]

    def get_driver_name(self, obj) -> str:
        return obj.driver.get_full_name() or obj.driver.get_username()

    def validate(self, attrs):
        vehicle = attrs.get("vehicle", getattr(self.instance, "vehicle", None))
        if vehicle is not None and vehicle.state == VehicleState.BAJA:
            raise serializers.ValidationError(
                "No se puede asignar un conductor a un vehículo en baja."
            )
        # N9: un principal bloqueado por sustitución no admite asignaciones ni
        # propuestas — se opera sobre el sustituto mientras dure el vínculo.
        if self.instance is None and vehicle is not None:
            from .selectors import active_link_blocking

            link = active_link_blocking(vehicle)
            if link is not None:
                raise serializers.ValidationError(
                    {
                        "vehicle": (
                            "Vehículo bloqueado por sustitución — opera sobre "
                            f"{link.substitute_vehicle.plate}."
                        )
                    }
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
        # Un coche por conductor a la vez (más el de sustitución aparte). Se
        # valida sobre el estado FINAL (create de una aceptada o PATCH que la
        # reabra/mueva de fechas); Model.clean() no lo llama DRF.
        status_final = attrs.get("status", getattr(self.instance, "status", None))
        if driver is not None and vehicle is not None and status_final == AssignmentStatus.ACCEPTED:
            clash = driver_assignment_clash(
                driver.pk,
                is_substitute=vehicle.is_substitute,
                start_date=start,
                end_date=end,
                exclude_pk=self.instance.pk if self.instance else None,
                exclude_vehicle_id=vehicle.pk,
            )
            if clash:
                raise serializers.ValidationError({"driver": driver_clash_message(clash)})
            # R4-01: UNA sola asignación VIGENTE por vehículo, también con fin
            # PROGRAMADO (R3-02) — la constraint parcial de BD solo cubre el
            # fin NULL (y con IntegrityError → 500, no 400). Los flujos
            # (`accept`/`grant`/`set-driver`) cierran la vigente antes; este es
            # el cinturón del CRUD directo.
            end_final = attrs.get("end_date", getattr(self.instance, "end_date", None))
            vigente = end_final is None or end_final > timezone.localdate()
            if vigente:
                from .selectors import current_assignment_q

                others = Assignment.objects.filter(current_assignment_q(), vehicle=vehicle)
                if self.instance is not None:
                    others = others.exclude(pk=self.instance.pk)
                ocupada = others.select_related("driver").first()
                if ocupada is not None:
                    raise serializers.ValidationError(
                        {
                            "vehicle": (
                                f"El vehículo ya tiene una asignación vigente "
                                f"(de {ocupada.driver}). Ciérrala primero o usa el "
                                "cambio de conductor de la ficha, que releva."
                            )
                        }
                    )
            # …y un coche tampoco tiene DOS conductores en el mismo tramo del
            # histórico: la regla de arriba solo mira lo vigente, así que un
            # periodo cerrado se podía colar encima de otro.
            solapada = vehicle_assignment_overlap(
                vehicle.pk,
                start_date=start,
                end_date=end_final,
                exclude_pk=self.instance.pk if self.instance else None,
            )
            if solapada is not None:
                raise serializers.ValidationError(
                    {"start_date": assignment_overlap_message(solapada)}
                )
        # SEC2: la máquina de estados no se salta por PATCH. La única transición
        # directa permitida es cerrar (→ finished, como hace la gestión); aceptar
        # o rechazar una propuesta va por las acciones accept/reject, que son la
        # transición de negocio completa.
        if self.instance is not None:
            new_status = attrs.get("status", self.instance.status)
            if new_status != self.instance.status and new_status != AssignmentStatus.FINISHED:
                raise serializers.ValidationError(
                    {"status": "Usa accept/reject para transicionar la propuesta."}
                )
        return attrs


class SupervisorPeriodSerializer(serializers.ModelSerializer):
    """Histórico de supervisores con fechas (uno por coche a la vez).

    El vigente sigue siendo `Vehicle.supervisor`: la vista lo sincroniza al
    guardar (v. `services/supervisors.py`).
    """

    supervisor_name = serializers.SerializerMethodField()

    class Meta:
        model = SupervisorPeriod
        fields = "__all__"
        read_only_fields = [
            "id",
            "is_active",
            "deactivated_at",
            "deactivated_by",
            "deactivation_reason",
            "created_at",
            "updated_at",
        ]

    def get_supervisor_name(self, obj) -> str:
        return obj.supervisor.get_full_name() or obj.supervisor.get_username()

    def validate(self, attrs):
        instance = self.instance
        vehicle = attrs.get("vehicle", getattr(instance, "vehicle", None))
        supervisor = attrs.get("supervisor", getattr(instance, "supervisor", None))
        start = attrs.get("start_date", getattr(instance, "start_date", None))
        end = attrs.get("end_date", getattr(instance, "end_date", None))

        if supervisor is not None and not supervisor.is_supervisor:
            raise serializers.ValidationError(
                {"supervisor": "El usuario no tiene rol de supervisor."}
            )
        if start and end and end < start:
            raise serializers.ValidationError(
                {"end_date": "La fecha de fin no puede ser anterior a la de inicio."}
            )
        if vehicle is not None and start:
            otro = supervisor_period_overlap(
                vehicle.pk,
                start_date=start,
                end_date=end,
                exclude_pk=instance.pk if instance is not None else None,
            )
            if otro is not None:
                raise serializers.ValidationError({"start_date": supervisor_overlap_message(otro)})
        return attrs


class VehicleUsageSerializer(serializers.ModelSerializer):
    """A11: el reparto individual también respeta el invariante de HU-2.5.

    La suma exacta de 100 se valida en el endpoint compuesto
    (`/vehicle-usages/set/`), que es por donde entra la interfaz. Pero el CRUD
    genérico quedaba sin ninguna validación —`Model.clean()` no lo llama DRF—,
    así que un `POST` suelto admitía un 500 % o un porcentaje negativo y rompía
    el invariante fila a fila.
    """

    def validate_usage_percent(self, value):
        if value is not None and not (Decimal("0") <= value <= Decimal("100")):
            raise serializers.ValidationError("El porcentaje debe estar entre 0 y 100.")
        return value

    def validate(self, attrs):
        vehicle = attrs.get("vehicle", getattr(self.instance, "vehicle", None))
        percent = attrs.get("usage_percent", getattr(self.instance, "usage_percent", None))
        end_date = attrs.get("end_date", getattr(self.instance, "end_date", None))
        start = attrs.get("start_date", getattr(self.instance, "start_date", None))
        if start and end_date and end_date < start:
            raise serializers.ValidationError(
                {"end_date": "La fecha de fin no puede ser anterior a la de inicio."}
            )
        # La suma de los repartos vigentes del vehículo no puede pasar de 100.
        if vehicle is not None and percent is not None and end_date is None:
            current = VehicleUsage.objects.filter(
                vehicle=vehicle, end_date__isnull=True, is_active=True
            )
            if self.instance is not None:
                current = current.exclude(pk=self.instance.pk)
            total = sum((row.usage_percent or Decimal("0")) for row in current) + percent
            if total > Decimal("100"):
                raise serializers.ValidationError(
                    {
                        "usage_percent": (
                            f"La suma de los repartos vigentes sería {total} %. "
                            "Usa /vehicle-usages/set/ para aplicar el reparto completo."
                        )
                    }
                )
        return attrs

    class Meta:
        model = VehicleUsage
        fields = "__all__"
        read_only_fields = [
            "id",
            "is_active",
            "deactivated_at",
            "deactivated_by",
            "deactivation_reason",
            "created_at",
            "updated_at",
        ]


class UsageSplitItemSerializer(serializers.Serializer):
    """Línea del reparto de uso: persona + porcentaje."""

    # R3-26: misma exigencia que `Assignment` — persona ACTIVA y con rol de
    # conductor. Sin ella, el reparto admitía usuarios de baja o sin rol.
    driver = serializers.PrimaryKeyRelatedField(
        queryset=get_user_model().objects.filter(is_active=True)
    )
    usage_percent = serializers.DecimalField(
        max_digits=5, decimal_places=2, min_value=Decimal("0"), max_value=Decimal("100")
    )

    def validate_driver(self, value):
        if not value.is_driver:
            raise serializers.ValidationError("El usuario asignado no tiene rol de conductor.")
        return value


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


# `active_link_q` vive en selectors: importado aquí dentro para no crear
# un ciclo selectors -> serializers en tiempo de importación.
class VehicleLinkSerializer(serializers.ModelSerializer):
    # M11: las matrículas de los dos extremos, como en el resto de listados
    # (`vehicle_plate`). Sin ellas, la ficha se traía TODA la flota solo para
    # poder traducir dos ids a matrículas en el histórico de vínculos.
    main_vehicle_plate = serializers.CharField(
        source="main_vehicle.plate", read_only=True, default=""
    )
    substitute_vehicle_plate = serializers.CharField(
        source="substitute_vehicle.plate", read_only=True, default=""
    )

    class Meta:
        model = VehicleLink
        fields = "__all__"
        read_only_fields = [
            "id",
            "is_active",
            "deactivated_at",
            "deactivated_by",
            "deactivation_reason",
            "created_at",
            "updated_at",
        ]

    def validate(self, attrs):
        from .selectors import active_link_q

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
        # N9: el sustituto debe SER de sustitución, y solo puede cubrir un coche.
        if substitute is not None and not substitute.is_substitute:
            raise serializers.ValidationError(
                {"substitute_vehicle": "El vehículo elegido no es de sustitución."}
            )
        if main is not None and main.is_substitute:
            raise serializers.ValidationError(
                {"main_vehicle": "Un vehículo de sustitución no puede tener sustituto."}
            )
        end_date = attrs.get("end_date", getattr(self.instance, "end_date", None))
        start_date = attrs.get("start_date", getattr(self.instance, "start_date", None))
        # El cierre no puede ser anterior al inicio (se puede cerrar con fecha
        # pasada, pero no antes de que el vínculo existiera).
        if end_date is not None and start_date is not None and end_date < start_date:
            raise serializers.ValidationError(
                {"end_date": "La fecha de fin no puede ser anterior a la de inicio."}
            )
        # Un cierre PROGRAMADO (fecha futura) sigue cubriendo: hasta que llegue
        # ese día, el vínculo cuenta como activo para todos los efectos.
        today = timezone.localdate()
        still_active = end_date is None or end_date > today
        if main is not None and still_active:
            existing = VehicleLink.objects.filter(active_link_q(today), main_vehicle=main)
            if self.instance is not None:
                existing = existing.exclude(pk=self.instance.pk)
            if existing.exists():
                raise serializers.ValidationError(
                    "El vehículo ya tiene un sustituto activo; cierra ese vínculo primero."
                )
        if substitute is not None and still_active:
            # N9: un sustituto vinculado no puede asignarse a otro coche a la vez.
            busy = VehicleLink.objects.filter(active_link_q(today), substitute_vehicle=substitute)
            if self.instance is not None:
                busy = busy.exclude(pk=self.instance.pk)
            if busy.exists():
                raise serializers.ValidationError(
                    {
                        "substitute_vehicle": (
                            "Ese sustituto ya está cubriendo otro vehículo; cierra ese "
                            "vínculo primero."
                        )
                    }
                )
        # N9: el vínculo solo se crea con el principal en estado NO activo
        # (avería, taller, ITV…): si el coche funciona, no hay sustitución.
        if self.instance is None and main is not None and still_active:
            if main.state in (VehicleState.ACTIVE, VehicleState.BAJA):
                raise serializers.ValidationError(
                    {
                        "main_vehicle": (
                            "El vehículo principal debe estar en un estado no activo "
                            "(avería, taller, ITV…) para recibir un sustituto."
                        )
                    }
                )
        return attrs


# Tipos de evento que se pueden registrar A MANO por la API (Fase A1). El resto
# los emiten los procesos de negocio (alta, cambios de estado/conductor, km…).
MANUAL_EVENT_TYPES = {EventType.ITV, EventType.FEE_CHANGE, EventType.LOCATION_CHANGE}


class EventItvSerializer(serializers.ModelSerializer):
    class Meta:
        model = EventItv
        fields = ["result", "next_due", "cost", "workshop", "km"]

    def validate_workshop(self, workshop):
        # La estación es un `Workshop` de tipo ITV (o taller+ITV), vivo.
        if workshop is None:
            return workshop
        if not workshop.is_active:
            raise serializers.ValidationError("La estación está desactivada.")
        if workshop.kind not in (Workshop.Kind.ITV, Workshop.Kind.BOTH):
            raise serializers.ValidationError("No es una estación de ITV.")
        return workshop


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
            return {
                "kind": "itv",
                "result": itv.result,
                "next_due": itv.next_due,
                # Como cadena, igual que un `DecimalField`: un Decimal crudo se
                # renderiza como float y el recibo idempotente lo guardaba como
                # texto, así que el reenvío no devolvía el mismo JSON.
                "cost": str(itv.cost) if itv.cost is not None else None,
                "workshop": itv.workshop_id,
                "workshop_name": str(itv.workshop) if itv.workshop_id else "",
                "km": itv.km,
            }
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
        # R3-03: `project_change` y `pep_change` existían como subtipo pero la
        # API devolvía `details: null` (el Excel sí los pintaba). Id + etiqueta
        # legible, como hace `reports._event_detail`.
        project = getattr(obj, "project_change", None)
        if project:
            return {
                "kind": "project_change",
                "old_project": project.old_project_id,
                "new_project": project.new_project_id,
                "old_project_name": str(project.old_project) if project.old_project else None,
                "new_project_name": str(project.new_project) if project.new_project else None,
            }
        pep = getattr(obj, "pep_change", None)
        if pep:
            return {
                "kind": "pep_change",
                "old_pep": pep.old_pep_id,
                "new_pep": pep.new_pep_id,
                "old_pep_name": str(pep.old_pep) if pep.old_pep else None,
                "new_pep_name": str(pep.new_pep) if pep.new_pep else None,
            }
        drv = getattr(obj, "driver_change", None)
        if drv:
            return {
                "kind": "driver_change",
                "old_driver": drv.old_driver_id,
                "new_driver": drv.new_driver_id,
            }
        sup = getattr(obj, "supervisor_change", None)
        if sup:
            return {
                "kind": "supervisor_change",
                "old_supervisor": sup.old_supervisor_id,
                "new_supervisor": sup.new_supervisor_id,
                "old_supervisor_name": (
                    sup.old_supervisor.get_full_name() or sup.old_supervisor.get_username()
                    if sup.old_supervisor
                    else None
                ),
                "new_supervisor_name": (
                    sup.new_supervisor.get_full_name() or sup.new_supervisor.get_username()
                    if sup.new_supervisor
                    else None
                ),
            }
        renewal = getattr(obj, "insurance_renewal", None)
        if renewal:
            return {
                "kind": "insurance_renewal",
                "old_expiry": renewal.old_expiry,
                "new_expiry": renewal.new_expiry,
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
            self._validate_itv(attrs)
        return attrs

    @staticmethod
    def _validate_itv(attrs) -> None:
        """C5/A13: reglas de una ITV registrada a mano.

        - Con resultado FAVORABLE, `next_due` es OPCIONAL (2026-08-31: la fecha
          viene del informe y en campo puede no estar a mano; se registra la ITV
          pasada y la fecha llega en un registro posterior). Si se envía, tiene
          que caer dentro de un horizonte razonable: sin cota, un `2099-01-01`
          sacaba el vehículo del radar de ITV para siempre (y el job lo
          reafirmaba en cada pasada). Sin fecha, el vehículo se queda SIN cita
          (`next_itv_date` a nulo): la inspección de hoy cumple la anterior, así
          que arrastrarla solo produce avisos falsos — ver
          `signals.on_itv_registered`.
        - Con resultado NO favorable no se admite fecha: no hay próxima ITV que
          apuntar, y el aviso debe seguir abierto. Esto es lo que hace coherente
          la opción «no pasada» que ofrecen los dos fronts.
        """
        itv = attrs.get("itv") or {}
        result = itv.get("result") or ""
        next_due = itv.get("next_due")
        event_date = attrs.get("event_date") or timezone.localdate()

        # El resultado es obligatorio al registrar: es lo que decide si la ITV
        # exime (y refresca la próxima fecha) o no.
        if result not in (ItvResult.DONE, ItvResult.NOT_DONE):
            raise serializers.ValidationError(
                {"itv": "Indica el resultado de la ITV ('done' o 'not done')."}
            )

        if result != ItvResult.DONE:
            if next_due is not None:
                raise serializers.ValidationError(
                    {"itv": "Una ITV no favorable no fija próxima fecha."}
                )
            return

        if not next_due:
            return  # Favorable sin fecha: válida — el informe puede venir después.
        if next_due <= event_date:
            raise serializers.ValidationError(
                {"itv": "La próxima ITV debe ser posterior a la fecha de la inspección."}
            )
        horizon = event_date + timedelta(days=settings.FLEET_ITV_MAX_HORIZON_DAYS)
        if next_due > horizon:
            raise serializers.ValidationError(
                {
                    "itv": (
                        "La próxima ITV no puede ir más allá de "
                        f"{settings.FLEET_ITV_MAX_HORIZON_DAYS} días desde la inspección "
                        f"(máximo {horizon.isoformat()})."
                    )
                }
            )

    def create(self, validated_data):
        itv = validated_data.pop("itv", None)
        fee_change = validated_data.pop("fee_change", None)
        location_change = validated_data.pop("location_change", None)
        validated_data.setdefault("event_date", timezone.localdate())
        event = Event.objects.create(**validated_data)
        # El subtipo se crea después: la señal post_save de EventItv refresca
        # `next_itv_date`; el cierre de alertas con actor lo hace la vista
        # (`services/itv.register_itv`) tras guardar (HU-5.1).
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
        read_only_fields = [
            "id",
            "is_active",
            "deactivated_at",
            "deactivated_by",
            "deactivation_reason",
            "created_at",
            "updated_at",
        ]

    def validate_drive_url(self, value):
        return _https_only(value)


class InvoiceAllocationSerializer(serializers.ModelSerializer):
    class Meta:
        model = InvoiceAllocation
        fields = "__all__"
        read_only_fields = [
            "id",
            "is_active",
            "deactivated_at",
            "deactivated_by",
            "deactivation_reason",
            "created_at",
            "updated_at",
        ]


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


class AccidentThirdPartySerializer(serializers.ModelSerializer):
    class Meta:
        model = AccidentThirdParty
        fields = [
            "id",
            "name",
            "plate",
            "brand",
            "model",
            "phone",
            "insurance_company",
            "policy_number",
            "damage_description",
        ]


class AccidentInjuredSerializer(serializers.ModelSerializer):
    seat_display = serializers.CharField(source="get_seat_display", read_only=True)

    class Meta:
        model = AccidentInjured
        fields = ["id", "name", "phone", "email", "plate", "seat", "seat_display"]


class AccidentReportSerializer(serializers.ModelSerializer):
    """El parte de accidente materializado (tablas), de solo lectura.

    El dato entra por `Incident.details` (parte guiado, `report_version = 1`) y
    la señal lo vuelca aquí — ver `services/accidents.py`.
    """

    third_parties = AccidentThirdPartySerializer(many=True, read_only=True)
    injured = AccidentInjuredSerializer(many=True, read_only=True)

    class Meta:
        model = AccidentReport
        fields = [
            "street",
            "street_number",
            "postal_code",
            "locality",
            "province",
            "occurred_at",
            "phone",
            "police_report_ref",
            "third_parties",
            "injured",
        ]


#: INP-2: techos del JSON libre que llega de la app (partes, cambios pedidos).
JSON_PAYLOAD_MAX_BYTES = 64 * 1024
JSON_PAYLOAD_MAX_ITEMS = 20
JSON_PAYLOAD_MAX_TEXT = 4000
JSON_PAYLOAD_MAX_DEPTH = 6


def limit_json_payload(
    value,
    *,
    field: str,
    max_bytes: int = JSON_PAYLOAD_MAX_BYTES,
    max_items: int = JSON_PAYLOAD_MAX_ITEMS,
    max_text: int = JSON_PAYLOAD_MAX_TEXT,
    max_depth: int = JSON_PAYLOAD_MAX_DEPTH,
) -> None:
    """Acota un JSON libre (`details`, `changes`): tamaño, listas, textos y anidación.

    Sin techo, un conductor guarda megabytes por incidencia y ese JSON viaja
    entero en cada listado de gestión. Lanza `ValidationError` sobre `field`.
    """
    import json

    def _walk(node, depth: int) -> None:
        if depth > max_depth:
            raise serializers.ValidationError({field: "Estructura demasiado anidada."})
        if isinstance(node, dict):
            if len(node) > max_items * 4:
                raise serializers.ValidationError({field: "Demasiados campos."})
            for key, child in node.items():
                if len(str(key)) > 100:
                    raise serializers.ValidationError({field: "Nombre de campo demasiado largo."})
                _walk(child, depth + 1)
        elif isinstance(node, list):
            if len(node) > max_items:
                raise serializers.ValidationError(
                    {field: f"Una lista no puede tener más de {max_items} elementos."}
                )
            for child in node:
                _walk(child, depth + 1)
        elif isinstance(node, str) and len(node) > max_text:
            raise serializers.ValidationError(
                {field: f"Un texto no puede superar los {max_text} caracteres."}
            )

    _walk(value, 1)
    try:
        size = len(json.dumps(value, ensure_ascii=False, default=str).encode("utf-8"))
    except (TypeError, ValueError) as exc:
        raise serializers.ValidationError({field: "Contenido no serializable."}) from exc
    if size > max_bytes:
        raise serializers.ValidationError(
            {field: f"El contenido supera el máximo de {max_bytes // 1024} KB."}
        )


class IncidentSerializer(serializers.ModelSerializer):
    type_display = serializers.CharField(source="get_type_display", read_only=True)
    priority_display = serializers.CharField(source="get_priority_display", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    # Parte de accidente materializado (null en el resto de incidencias).
    accident_report = AccidentReportSerializer(read_only=True)
    # Contexto del vehículo y de la resolución, de solo lectura: ahorran al front
    # cruzar con el índice de vehículos y resolver ids de usuario/taller.
    vehicle_plate = serializers.CharField(source="vehicle.plate", read_only=True)
    vehicle_state = serializers.CharField(source="vehicle.state", read_only=True)
    workshop_name = serializers.SerializerMethodField()
    resolved_by_name = serializers.SerializerMethodField()

    class Meta:
        model = Incident
        fields = "__all__"
        # La resolución (actor, momento, fecha, km) la fija SOLO `/resolve/`.
        read_only_fields = [
            "id",
            "is_active",
            "deactivated_at",
            "deactivated_by",
            "deactivation_reason",
            "created_at",
            "updated_at",
            "resolved_at",
            "resolved_by",
            "resolution_date",
            "resolution_km",
        ]

    def get_workshop_name(self, obj: Incident) -> str:
        return str(obj.workshop) if obj.workshop_id else ""

    def get_resolved_by_name(self, obj: Incident) -> str:
        person = obj.resolved_by
        return (person.get_full_name() or person.get_username()) if person else ""

    def validate_workshop(self, workshop):
        # Solo talleres vivos del catálogo (N7: los desactivados siguen en BD).
        if workshop is not None and not workshop.is_active:
            raise serializers.ValidationError("El taller está desactivado.")
        return workshop

    @staticmethod
    def _required(details, names):
        return [name for name in names if not str(details.get(name, "")).strip()]

    def validate(self, attrs):
        attrs = super().validate(attrs)
        # Cerrar es una operación de negocio con sus datos (fecha, coste, taller,
        # actor…): va por `/resolve/`. Un PATCH a «cerrada» se saltaba todo eso y
        # dejaba la incidencia cerrada sin rastro de quién ni cómo.
        if (
            self.instance is not None
            and attrs.get("status") == IncidentStatus.CLOSED
            and self.instance.status != IncidentStatus.CLOSED
        ):
            raise serializers.ValidationError(
                {"status": "Para cerrar una incidencia usa la acción de resolver (/resolve/)."}
            )
        # R5-09: nacer ya CERRADA (un servicio anotado a posteriori) es cosa de
        # gestión; el conductor abre partes, y se cierran por /resolve/ con sus
        # validaciones. El `cost` del alta sigue admitido: es el presupuesto del
        # lanzamiento (GAP-6) y la resolución lo pisa con el coste real.
        if self.instance is None and attrs.get("status") == IncidentStatus.CLOSED:
            request = self.context.get("request")
            is_management = getattr(getattr(request, "user", None), "is_management", False)
            if not is_management:
                raise serializers.ValidationError(
                    {"status": "Una petición se abre abierta: cerrarla es resolverla."}
                )
        incident_type = attrs.get("type", getattr(self.instance, "type", ""))
        details = attrs.get("details", getattr(self.instance, "details", {})) or {}
        mileage = attrs.get("mileage", getattr(self.instance, "mileage", None))
        postal_code = attrs.get(
            "workshop_postal_code", getattr(self.instance, "workshop_postal_code", "")
        )

        if not isinstance(details, dict):
            raise serializers.ValidationError({"details": "Debe ser un objeto."})
        # INP-2: el JSON libre del parte tiene techo (tamaño, listas y textos):
        # viaja entero en los listados de gestión y se guarda tal cual.
        limit_json_payload(details, field="details")
        guided_report = details.get("report_version") == 1
        if postal_code and (not postal_code.isdigit() or len(postal_code) != 5):
            raise serializers.ValidationError(
                {"workshop_postal_code": "Indica un código postal de 5 cifras."}
            )

        errors = {}
        # Cómo queda el coche según quien lo comunica (app de campo). Es un dato
        # de la petición, no una orden: no cambia `Vehicle.state` — solo
        # «substitute» tiene efecto, y es abrir su solicitud de coche.
        availability = details.get("availability")
        if availability is not None and availability not in vehicle_requests.AVAILABILITY_VALUES:
            errors["details"] = "Disponibilidad no válida."

        if guided_report and incident_type in ("breakdown", "tires"):
            if mileage is None:
                errors["mileage"] = "Indica el kilometraje actual."
            if not postal_code:
                errors["workshop_postal_code"] = "Indica el código postal del taller."

        if (
            guided_report
            and incident_type == "breakdown"
            and not str(attrs.get("description", getattr(self.instance, "description", ""))).strip()
        ):
            errors["description"] = "Describe la avería."

        if guided_report and incident_type == "tires":
            missing = self._required(details, ("change_reason",))
            reason = details.get("change_reason")
            if reason not in ("wear", "puncture"):
                missing.append("change_reason")
            if reason == "wear":
                scope = details.get("wheel_scope")
                if scope not in ("front", "rear", "all"):
                    missing.append("wheel_scope")
                if scope in ("front", "all") and not str(details.get("front_measure", "")).strip():
                    missing.append("front_measure")
                if scope in ("rear", "all") and not str(details.get("rear_measure", "")).strip():
                    missing.append("rear_measure")
            elif reason == "puncture":
                if details.get("wheel") not in (
                    "front_left",
                    "front_right",
                    "rear_left",
                    "rear_right",
                ):
                    missing.append("wheel")
                if not str(details.get("tire_measure", "")).strip():
                    missing.append("tire_measure")
            if missing:
                faltan = ", ".join(sorted(set(missing)))
                errors["details"] = f"Faltan datos de neumáticos: {faltan}."
            elif details.get("preferred_at"):
                try:
                    serializers.DateTimeField().run_validation(details["preferred_at"])
                except serializers.ValidationError:
                    errors["details"] = "La fecha y hora de preferencia no es válida."

        if guided_report and incident_type == "accident":
            missing = self._required(
                details,
                (
                    "street",
                    "postal_code",
                    "locality",
                    "province",
                    "occurred_at",
                    "phone",
                    "damage_description",
                ),
            )
            accident_postal = str(details.get("postal_code", ""))
            if accident_postal and (not accident_postal.isdigit() or len(accident_postal) != 5):
                errors["details"] = "El código postal del accidente debe tener 5 cifras."
            elif missing:
                errors["details"] = f"Faltan datos del accidente: {', '.join(missing)}."
            elif details.get("occurred_at"):
                try:
                    occurred_at = serializers.DateTimeField().run_validation(details["occurred_at"])
                    if occurred_at > timezone.now():
                        errors["details"] = "La fecha del accidente no puede ser futura."
                except serializers.ValidationError:
                    errors["details"] = "La fecha y hora del accidente no es válida."
            for list_name in ("third_parties", "injured_people"):
                if list_name in details and not isinstance(details[list_name], list):
                    errors["details"] = f"{list_name} debe ser una lista."

        if errors:
            raise serializers.ValidationError(errors)
        return attrs


class _TiresResolutionSerializer(serializers.Serializer):
    """Neumáticos MONTADOS al cerrar un parte de neumáticos (el parte guiado
    registra los desmontados)."""

    size = serializers.CharField(max_length=30, required=False, allow_blank=True)
    brand = serializers.CharField(max_length=60, required=False, allow_blank=True)
    quantity = serializers.IntegerField(min_value=1, max_value=6, required=False)
    positions = serializers.ListField(
        child=serializers.ChoiceField(choices=TIRE_POSITIONS), required=False, allow_empty=True
    )

    def validate(self, attrs):
        positions = attrs.get("positions") or []
        if len(positions) != len(set(positions)):
            raise serializers.ValidationError({"positions": "Hay posiciones repetidas."})
        quantity = attrs.get("quantity")
        if positions and quantity is not None and quantity != len(positions):
            raise serializers.ValidationError(
                {"quantity": "La cantidad no coincide con las posiciones indicadas."}
            )
        return attrs


class _AccidentResolutionSerializer(serializers.Serializer):
    """Datos del siniestro al cerrar un accidente."""

    claim_ref = serializers.CharField(max_length=60, required=False, allow_blank=True)
    liability = serializers.ChoiceField(choices=IncidentLiability.choices, required=False)
    deductible_amount = serializers.DecimalField(
        max_digits=10, decimal_places=2, min_value=Decimal("0"), required=False, allow_null=True
    )
    total_loss = serializers.BooleanField(required=False, default=False)

    def validate(self, attrs):
        deductible = attrs.get("liability") == IncidentLiability.DEDUCTIBLE
        amount = attrs.get("deductible_amount")
        if deductible and amount is None:
            raise serializers.ValidationError(
                {"deductible_amount": "Indica el importe de la franquicia."}
            )
        if not deductible and amount is not None:
            raise serializers.ValidationError(
                {"deductible_amount": "El importe solo aplica cuando asume la franquicia."}
            )
        return attrs


class IncidentResolutionSerializer(serializers.Serializer):
    """Cuerpo de `POST /incidents/{id}/resolve/`: lo común a todo cierre más el
    bloque propio del tipo (`tires` / `accident` / `maintenance_plan`), que se
    rechaza si no corresponde. `overcost` se acepta como alias legado de `cost`
    (R3-41). Requiere `context["incident"]`.
    """

    resolution_date = serializers.DateField()
    observations = serializers.CharField(required=False, allow_blank=True, default="")
    cost = serializers.DecimalField(
        max_digits=10, decimal_places=2, min_value=Decimal("0"), required=False, allow_null=True
    )
    workshop = serializers.PrimaryKeyRelatedField(
        queryset=Workshop.objects.filter(is_active=True), required=False, allow_null=True
    )
    km = serializers.IntegerField(min_value=0, required=False, allow_null=True)
    # La ubicación preferente con la que se gestionó la petición. Llega para
    # COMPLETARLA cuando se abrió sin ella (en campo no siempre se sabe): el
    # cierre es la última oportunidad de dejar escrito a dónde fue el coche.
    workshop_postal_code = serializers.CharField(required=False, allow_blank=True, max_length=12)
    return_to_active = serializers.BooleanField(required=False, default=False)
    maintenance_plan = serializers.PrimaryKeyRelatedField(
        queryset=MaintenancePlan.objects.filter(is_active=True), required=False, allow_null=True
    )
    tires = _TiresResolutionSerializer(required=False)
    accident = _AccidentResolutionSerializer(required=False)

    def to_internal_value(self, data):
        # Alias legado: la gestión mandaba `overcost`; hoy es el coste de la
        # reparación. Solo se copia si `cost` no viene.
        if (
            hasattr(data, "get")
            and data.get("cost") in (None, "")
            and data.get("overcost") not in (None, "")
        ):
            data = {**{key: data.get(key) for key in data}, "cost": data.get("overcost")}
        return super().to_internal_value(data)

    def validate(self, attrs):
        incident: Incident = self.context["incident"]
        errors = {}
        if "tires" in attrs and incident.type != IncidentType.TIRES:
            errors["tires"] = "Solo en incidencias de neumáticos."
        if "accident" in attrs and incident.type != IncidentType.ACCIDENT:
            errors["accident"] = "Solo en accidentes."
        plan = attrs.get("maintenance_plan")
        if plan is not None:
            if incident.type != IncidentType.MAINTENANCE:
                errors["maintenance_plan"] = "Solo en incidencias de mantenimiento."
            elif plan.vehicle_id != incident.vehicle_id:
                errors["maintenance_plan"] = "El plan no es de este vehículo."
        postal = (attrs.get("workshop_postal_code") or "").strip()
        if postal and (not postal.isdigit() or len(postal) != 5):
            errors["workshop_postal_code"] = "Indica un código postal de 5 cifras."
        if errors:
            raise serializers.ValidationError(errors)
        return attrs

    def to_service_kwargs(self) -> dict:
        """Argumentos con nombre para `services.incidents.resolve_incident`."""
        data = dict(self.validated_data)
        extra: dict = {}
        if "tires" in data:
            extra["tires"] = dict(data.pop("tires"))
        if "accident" in data:
            accident = dict(data.pop("accident"))
            amount = accident.get("deductible_amount")
            if amount is not None:
                accident["deductible_amount"] = str(amount.quantize(Decimal("0.01")))
            extra["accident"] = accident
        return {
            "resolution_date": data["resolution_date"],
            "observations": (data.get("observations") or "").strip(),
            "cost": data.get("cost"),
            "workshop": data.get("workshop"),
            "km": data.get("km"),
            "return_to_active": bool(data.get("return_to_active")),
            "workshop_postal_code": (data.get("workshop_postal_code") or "").strip(),
            "extra": extra,
            "maintenance_plan": data.get("maintenance_plan"),
        }


# Extensiones admitidas en la subida de documentos (fotos de cámara + PDF).
DOCUMENT_ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "webp", "heic", "pdf"}

#: INP-3: firmas («magic bytes») que tiene que llevar cada extensión admitida.
#: HEIC/HEIF es un contenedor ISO-BMFF: la marca va en el `ftyp` (bytes 4-12).
_HEIC_BRANDS = (b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis", b"mif1", b"msf1")


def file_signature_matches(uploaded, extension: str) -> bool:
    """Comprueba que los primeros bytes del fichero son de lo que dice ser.

    Solo mira la cabecera, así que no valida el fichero entero (eso lo hará
    quien lo abra); basta para que un HTML o un ejecutable no entren con
    nombre de foto o de PDF. Deja el puntero del fichero donde estaba.
    """
    try:
        pos = uploaded.tell()
    except (AttributeError, OSError):
        pos = None
    try:
        uploaded.seek(0)
        head = uploaded.read(16) or b""
    except (AttributeError, OSError):
        return False
    finally:
        if pos is not None:
            try:
                uploaded.seek(pos)
            except OSError:
                pass
    ext = extension.lower()
    if ext in ("jpg", "jpeg"):
        return head.startswith(b"\xff\xd8\xff")
    if ext == "png":
        return head.startswith(b"\x89PNG\r\n\x1a\n")
    if ext == "webp":
        return head[:4] == b"RIFF" and head[8:12] == b"WEBP"
    if ext == "heic":
        return head[4:8] == b"ftyp" and head[8:12] in _HEIC_BRANDS
    if ext == "pdf":
        return head.startswith(b"%PDF-")
    return False


#: Qué le falta a un documento que exige vínculo, por tipo (campo y texto).
_LINK_REQUIRED_ERRORS = {
    DocumentType.WORKSHOP_INVOICE: {
        "incident": (
            "Una «Factura de taller» va ligada a una incidencia, una ITV o un mantenimiento "
            "del vehículo."
        )
    },
    DocumentType.DAMAGE_PHOTOS: {
        "incident": "Unas «Fotos de daños» van ligadas a una incidencia del vehículo."
    },
    DocumentType.ITV_REPORT: {
        "event": "Un «Informe de ITV» va ligado a una ITV registrada o a una ITV programada."
    },
}


#: Confidencialidad del documento: solo la GESTIÓN decide de quién es, si lo
#: leen todos los conductores del coche y si queda protegido. Para el resto son
#: de solo lectura (ver `DocumentSerializer.get_fields`).
MANAGEMENT_ONLY_DOCUMENT_FIELDS = ("responsible", "shared_read", "protected")

#: AUTH-1: el estado del documento lo mueven el archivador y la gestión; un
#: conductor no lo marca «vigente» ni lo saca de «pendiente de archivar».
#: Mismo trato silencioso que los campos de confidencialidad.
MANAGEMENT_ONLY_DOCUMENT_STATE_FIELDS = ("status",)


class DocumentSerializer(serializers.ModelSerializer):
    type_display = serializers.CharField(source="get_type_display", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    uploaded_by_name = serializers.SerializerMethodField()
    user_name = serializers.SerializerMethodField()
    responsible_name = serializers.SerializerMethodField()
    event_display = serializers.SerializerMethodField()
    alert_display = serializers.SerializerMethodField()
    file_url = serializers.SerializerMethodField()
    deletion_pending = serializers.SerializerMethodField()

    class Meta:
        model = Document
        fields = "__all__"
        # uploaded_by lo fija el servidor (el usuario de la petición).
        read_only_fields = [
            "id",
            "uploaded_by",
            # AUTH-1: el id de Drive lo escribe SOLO el archivador al subir. Si
            # llegara por la API, la vista previa y la descarga (que bajan por
            # id con la cuenta de servicio) servirían cualquier fichero del
            # Drive de la flota a quien conociera su id, y la purga lo borraría.
            "drive_file_id",
            # Lo escribe la comprobación de existencia (`/documents/verify/`).
            "drive_missing_at",
            "is_active",
            "deactivated_at",
            "deactivated_by",
            "deactivation_reason",
            "created_at",
            "updated_at",
        ]

    def get_fields(self):
        """Los tres campos de confidencialidad, de solo lectura salvo gestión.

        Silencioso y no un 400 a propósito: cubre por construcción todos los
        caminos del serializer (alta, PATCH, importación), es el mismo trato
        que ya reciben `uploaded_by` y `drive_missing_at`, y la cola offline de
        la PWA reintenta de forma idempotente — un 400 permanente la dejaría
        atascada. Lo que se corta aquí no es el formulario del conductor, que
        no manda estos campos, sino una petición fabricada.
        """
        fields = super().get_fields()
        # En la generación del esquema OpenAPI no hay petición ni usuario.
        user = getattr(self.context.get("request"), "user", None)
        if not getattr(user, "is_management", False):
            for name in MANAGEMENT_ONLY_DOCUMENT_FIELDS + MANAGEMENT_ONLY_DOCUMENT_STATE_FIELDS:
                fields[name].read_only = True
        return fields

    @staticmethod
    def _person_name(person) -> str:
        """Nombre legible de una persona del documento; '' si no hay."""
        if not person:
            return ""
        return person.get_full_name() or person.get_username()

    def get_responsible_name(self, obj) -> str:
        """Nombre del responsable: de quién es el documento. '' si no tiene."""
        return self._person_name(obj.responsible)

    def get_uploaded_by_name(self, obj) -> str:
        return self._person_name(obj.uploaded_by)

    def get_user_name(self, obj) -> str:
        """Nombre del titular PERSONA (documentos personales); '' si es de coche."""
        return self._person_name(obj.user if obj.user_id else None)

    def get_event_display(self, obj) -> str:
        """El registro al que acompaña, legible («ITV · 2026-03-01»); '' si no hay."""
        if not obj.event_id:
            return ""
        event = obj.event
        when = event.event_date.isoformat() if event.event_date else "—"
        return f"{event.get_event_type_display()} · {when}"

    def get_alert_display(self, obj) -> str:
        """La alerta a la que acompaña («ITV programada · 2026-11-03»); '' si no hay."""
        if not obj.alert_id:
            return ""
        alert = obj.alert
        when = alert.due_date.isoformat() if alert.due_date else "—"
        return f"{alert.get_type_display()} · {when}"

    def get_deletion_pending(self, obj) -> bool:
        """¿Hay pedido su borrado y sin decidir? Lo anota el queryset de la vista.

        Es lo que marca la fila en la app de campo («Pendiente de borrado») y lo
        que apaga su papelera. Un documento recién creado no trae la anotación
        y tampoco puede tener petición: `False` es la respuesta correcta.
        """
        return bool(getattr(obj, "deletion_pending", False))

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
        # INP-3: la extensión la pone quien sube; la firma la pone el fichero.
        # Un HTML o un ejecutable renombrado a `.pdf` no pasa de aquí.
        if not file_signature_matches(value, extension):
            raise serializers.ValidationError(
                "El contenido del fichero no se corresponde con su extensión."
            )
        return value

    def validate(self, attrs):
        # HU-4.1: subir un documento exige el binario o, al menos, su URL.
        if self.instance is None and not attrs.get("file") and not attrs.get("drive_url"):
            raise serializers.ValidationError(
                "Adjunta un fichero (`file`) o indica la URL del documento (`drive_url`)."
            )
        # Titular único: un vehículo O un usuario. El permiso de conducir es de
        # una persona; la ficha técnica, del coche. (En un PATCH parcial se
        # completa con lo que ya tiene el documento.)
        vehicle = attrs.get("vehicle", getattr(self.instance, "vehicle", None))
        user = attrs.get("user", getattr(self.instance, "user", None))
        if (vehicle is None) == (user is None):
            raise serializers.ValidationError(
                "Indica el titular del documento: un vehículo o un usuario (solo uno)."
            )
        incident = attrs.get("incident", getattr(self.instance, "incident", None))
        if incident is not None and vehicle is None:
            raise serializers.ValidationError(
                {"incident": "Solo un documento de vehículo puede ligarse a una incidencia."}
            )
        if incident is not None and incident.vehicle_id != vehicle.pk:
            raise serializers.ValidationError({"incident": "La incidencia es de otro vehículo."})
        doc_type = attrs.get("type", getattr(self.instance, "type", None))
        # El REGISTRO al que acompaña (la ITV del informe, la renovación de la
        # póliza, la ITV o el mantenimiento de la factura): del mismo coche, de
        # un tipo que el documento admita y nunca a la vez que una incidencia —
        # un documento acompaña a UNA cosa.
        event = attrs.get("event", getattr(self.instance, "event", None))
        # …o a una ALERTA abierta (el informe de una ITV programada que aún no
        # se ha registrado). Un documento acompaña a UNA cosa.
        alert = attrs.get("alert", getattr(self.instance, "alert", None))
        vinculos = [v for v in (incident, event, alert) if v is not None]
        if len(vinculos) > 1:
            raise serializers.ValidationError(
                {"event": "Liga el documento a una sola cosa: incidencia, registro o alerta."}
            )
        if event is not None:
            if vehicle is None:
                raise serializers.ValidationError(
                    {"event": "Solo un documento de vehículo puede ligarse a un registro."}
                )
            if event.vehicle_id != vehicle.pk:
                raise serializers.ValidationError({"event": "El registro es de otro vehículo."})
            allowed = EVENT_LINKABLE_DOCUMENT_TYPES.get(doc_type)
            if not allowed:
                raise serializers.ValidationError(
                    {"event": "Este tipo de documento no se liga a un registro del vehículo."}
                )
            if event.event_type not in allowed:
                label = DocumentType(doc_type).label
                kinds = " o ".join(str(EventType(kind).label) for kind in sorted(allowed))
                raise serializers.ValidationError(
                    {"event": f"Un «{label}» solo acompaña a un registro de: {kinds}."}
                )
        if alert is not None:
            if vehicle is None or alert.vehicle_id != vehicle.pk:
                raise serializers.ValidationError({"alert": "La alerta es de otro vehículo."})
            allowed = ALERT_LINKABLE_DOCUMENT_TYPES.get(doc_type)
            if not allowed or alert.type not in allowed:
                raise serializers.ValidationError(
                    {"alert": "Este tipo de documento no se liga a esa alerta."}
                )
            if alert.status != AlertStatus.OPEN:
                raise serializers.ValidationError(
                    {"alert": "Esa alerta ya está resuelta: liga el informe a la ITV registrada."}
                )
        # Lo que exige acompañar a algo (factura de taller, fotos de daños,
        # informe de ITV) no entra suelto. Se exige al crear y al cambiar tipo o
        # vínculo, no en un PATCH de estado.
        if (
            doc_type in LINK_REQUIRED_DOCUMENT_TYPES
            and not vinculos
            and (self.instance is None or {"incident", "event", "alert", "type"} & set(attrs))
        ):
            raise serializers.ValidationError(_LINK_REQUIRED_ERRORS[doc_type])
        # Un parte de accidente es el parte DE un accidente: va ligado a uno y
        # sin cerrar. Se exige al crear y al cambiar tipo o incidencia; un PATCH
        # de estado sobre un parte antiguo (accidente ya cerrado) no lo re-exige.
        bound_to = INCIDENT_BOUND_DOCUMENT_TYPES.get(doc_type)
        if bound_to and (self.instance is None or "incident" in attrs or "type" in attrs):
            label = DocumentType(doc_type).label
            if incident is None:
                raise serializers.ValidationError(
                    {"incident": f"Un «{label}» va ligado a un accidente abierto."}
                )
            if incident.type != bound_to:
                raise serializers.ValidationError(
                    {"incident": f"Un «{label}» solo puede ligarse a un accidente."}
                )
            if incident.status == IncidentStatus.CLOSED:
                raise serializers.ValidationError(
                    {"incident": "Ese accidente ya está cerrado: elige uno abierto."}
                )
        # Solo caduca lo que caduca: a una ficha técnica o un acta no se les
        # pone fecha de vencimiento.
        if attrs.get("expiry_date") and doc_type not in EXPIRING_DOCUMENT_TYPES:
            raise serializers.ValidationError({"expiry_date": "Este tipo de documento no caduca."})
        return attrs


# --- Alertas (Épicas 3/5/10) ---------------------------------------------


class AlertSerializer(serializers.ModelSerializer):
    type_display = serializers.CharField(source="get_type_display", read_only=True)
    level_display = serializers.CharField(source="get_level_display", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    vehicle_plate = serializers.CharField(source="vehicle.plate", read_only=True, default="")
    # Estado del vehículo: el modal de resolver decide con él si ofrece
    # «devolver a Activo» sin tener que cargar la ficha.
    vehicle_state = serializers.CharField(source="vehicle.state", read_only=True, default="")
    # Las dos personas del aviso: quién conduce el coche y quién responde por él.
    # La bandeja las pinta en las abiertas (a quién hay que llamar) y las usa en
    # las resueltas para decidir si quien cerró era de los implicados.
    driver_id = serializers.SerializerMethodField()
    driver_name = serializers.SerializerMethodField()
    supervisor_id = serializers.SerializerMethodField()
    supervisor_name = serializers.SerializerMethodField()
    resolved_by_name = serializers.SerializerMethodField()

    class Meta:
        model = Alert
        fields = "__all__"
        # Las alertas las generan los trabajos programados; por API solo se
        # cambian de estado (resolver) vía la acción dedicada.
        read_only_fields = [
            "id",
            "type",
            "level",
            "vehicle",
            "user",
            "message",
            "message_code",
            "message_args",
            "due_date",
            "dedup_key",
            "status",
            "resolved_at",
            "resolved_by",
            "resolution_note",
            "created_at",
            "updated_at",
        ]

    @staticmethod
    def _person_name(person) -> str:
        return (person.get_full_name() or person.get_username()) if person else ""

    def _current_driver(self, obj: Alert):
        """Conductor vigente del vehículo de la alerta, en bloque.

        Mismo patrón que `VehicleSerializer._current_driver`: el mapa se resuelve
        UNA vez por respuesta y se cachea en el context, así que una bandeja de
        200 alertas no dispara 200 consultas de asignaciones (PR2).
        """
        if not obj.vehicle_id:
            return None
        drivers = self.context.get("_alert_current_drivers")
        if drivers is None:
            instance = self.parent.instance if self.parent is not None else obj
            rows = instance if isinstance(instance, list | models.QuerySet) else [obj]
            drivers = current_driver_map([a.vehicle_id for a in rows if a.vehicle_id])
            self.context["_alert_current_drivers"] = drivers
        return drivers.get(obj.vehicle_id)

    def get_driver_id(self, obj: Alert) -> int | None:
        driver = self._current_driver(obj)
        return driver.id if driver else None

    def get_driver_name(self, obj: Alert) -> str:
        return self._person_name(self._current_driver(obj))

    def get_supervisor_id(self, obj: Alert) -> int | None:
        return obj.vehicle.supervisor_id if obj.vehicle_id else None

    def get_supervisor_name(self, obj: Alert) -> str:
        return self._person_name(obj.vehicle.supervisor) if obj.vehicle_id else ""

    def get_resolved_by_name(self, obj: Alert) -> str:
        return self._person_name(obj.resolved_by)


# --- Solicitudes de vehículo (Épica 8) -----------------------------------


class DocumentDeletionRequestSerializer(serializers.ModelSerializer):
    """Petición sobre un documento (borrarlo o corregirlo), como la lee la bandeja.

    Trae de quién es el documento —matrícula o persona—, de qué tipo es y
    cuándo se subió, porque la fila tiene que decir **sobre qué se está
    pidiendo** sin abrir el documento; y en una corrección, `changes_display`
    dice **qué cambiaría**, con el antes y el después. `status` y el rastro de
    la resolución los fija el servidor: se cambian por `resolve` (gestión) y
    nunca por un PATCH.
    """

    status_display = serializers.CharField(source="get_status_display", read_only=True)
    kind_display = serializers.CharField(source="get_kind_display", read_only=True)
    changes_display = serializers.SerializerMethodField()
    requested_by_name = serializers.SerializerMethodField()
    resolved_by_name = serializers.SerializerMethodField()
    #: El CÓDIGO del tipo, además de su etiqueta: la bandeja lo traduce a su
    #: idioma (`domainLabels`) y `document_type_display` se queda de reserva.
    document_type = serializers.CharField(source="document.type", read_only=True, default="")
    document_type_display = serializers.CharField(
        source="document.get_type_display", read_only=True, default=""
    )
    document_created_at = serializers.DateTimeField(
        source="document.created_at", read_only=True, default=None
    )
    vehicle = serializers.IntegerField(source="document.vehicle_id", read_only=True, default=None)
    vehicle_plate = serializers.CharField(
        source="document.vehicle.plate", read_only=True, default=""
    )
    owner_name = serializers.SerializerMethodField()

    class Meta:
        model = DocumentDeletionRequest
        fields = "__all__"
        read_only_fields = [
            "id",
            "requested_by",
            "status",
            "resolved_by",
            "resolved_at",
            "resolution_note",
            "created_at",
            "updated_at",
        ]

    @staticmethod
    def _name(person) -> str:
        if not person:
            return ""
        return person.get_full_name() or person.get_username()

    def get_requested_by_name(self, obj) -> str:
        return self._name(obj.requested_by)

    def get_resolved_by_name(self, obj) -> str:
        return self._name(obj.resolved_by)

    def get_owner_name(self, obj) -> str:
        """Titular del documento: la matrícula del coche o el nombre de la persona."""
        document = obj.document
        if document.vehicle_id:
            return document.vehicle.plate
        return self._name(document.user)

    def get_changes_display(self, obj) -> list[dict]:
        """Lo que cambiaría, legible: etiqueta, lo que hay hoy y lo propuesto.

        El tipo se pinta con su nombre («Permiso de conducir»), no con su
        valor: quien decide lee la fila, no el catálogo del back.
        """
        document = obj.document
        etiquetas = {
            campo: str(document._meta.get_field(campo).verbose_name)
            for campo in document_requests.EDITABLE_DOCUMENT_FIELDS
        }
        tipos = dict(DocumentType.choices)
        actual = {
            "type": tipos.get(document.type, document.type),
            "expiry_date": document.expiry_date.isoformat() if document.expiry_date else "",
            "notes": document.notes or "",
        }
        salida = []
        for campo, valor in (obj.changes or {}).items():
            if campo not in document_requests.EDITABLE_DOCUMENT_FIELDS:
                continue
            propuesto = tipos.get(valor, valor) if campo == "type" else valor
            salida.append(
                {
                    "field": campo,
                    "label": etiquetas[campo],
                    "current": actual[campo],
                    "proposed": "" if propuesto is None else str(propuesto),
                }
            )
        return salida


class VehicleRequestSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    requester_name = serializers.SerializerMethodField()
    # De dónde viene la solicitud, para la bandeja: si nació de una incidencia
    # de campo, el coche que hay que CUBRIR y por qué (no es el de `vehicle`,
    # que es el que se concede y normalmente aún está vacío).
    incident_plate = serializers.CharField(
        source="incident.vehicle.plate", read_only=True, default=""
    )
    #: El CÓDIGO del tipo además de su etiqueta: la bandeja lo traduce a su
    #: idioma y `incident_type_display` se queda de reserva.
    incident_type = serializers.CharField(source="incident.type", read_only=True, default="")
    incident_type_display = serializers.CharField(
        source="incident.get_type_display", read_only=True, default=""
    )

    class Meta:
        model = VehicleRequest
        fields = "__all__"
        # SEC2: `status` solo cambia por grant/reject (IsAdmin) o la sincronización
        # con Jira — nunca por POST/PATCH directo (un supervisor podía marcar
        # `assigned` saltándose el grant).
        read_only_fields = [
            "id",
            "status",
            "is_active",
            "deactivated_at",
            "deactivated_by",
            "deactivation_reason",
            "created_at",
            "updated_at",
        ]

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


class NotificationScheduleSerializer(serializers.ModelSerializer):
    """Envío programado del propio usuario (Ajustes → Notificaciones).

    `user` es de solo lectura y lo fija la vista con quien hace la petición: el
    contenido se genera con SU ámbito, así que dejar elegir el dueño sería una
    vía para leer datos de otro.
    """

    user_email = serializers.EmailField(source="user.email", read_only=True)
    content_display = serializers.CharField(source="get_content_display", read_only=True)
    frequency_display = serializers.CharField(source="get_frequency_display", read_only=True)
    #: Cuándo saldría la próxima vez, para que la pantalla no repita el cálculo.
    next_run_at = serializers.SerializerMethodField()

    class Meta:
        model = NotificationSchedule
        fields = [
            "id",
            "name",
            "content",
            "content_display",
            "fmt",
            "filters",
            "name_with_date",
            "name_with_time",
            "frequency",
            "frequency_display",
            "weekday",
            "day_of_month",
            "send_at",
            "enabled",
            "send_email",
            "extra_recipients",
            "save_to_drive",
            "drive_folder",
            "user_email",
            "next_run_at",
            "last_run_at",
            "last_status",
            "last_error",
        ]
        read_only_fields = ["last_run_at", "last_status", "last_error"]

    def get_next_run_at(self, obj) -> str | None:
        from fleet.services import notifications

        if not obj.enabled:
            return None
        # `previous_due` mira hacia atrás; el siguiente turno es ese más un periodo.
        siguiente = notifications.next_due(obj)
        return siguiente.isoformat() if siguiente else None

    def validate_filters(self, value):
        """Los filtros son un objeto plano de cadenas; los vacíos se descartan.

        Se limpian aquí para que la fila no guarde `{"vehicle": ""}`, que luego
        obligaría a distinguir «sin filtrar» de «filtrado por vacío».
        """
        if value in (None, ""):
            return {}
        if not isinstance(value, dict):
            raise serializers.ValidationError("Los filtros deben ser un objeto.")
        limpio = {}
        for clave, valor in value.items():
            if valor in (None, ""):
                continue
            if isinstance(valor, dict | list):
                raise serializers.ValidationError(f"El filtro «{clave}» no admite ese valor.")
            limpio[str(clave)] = str(valor)
        return limpio

    def _is_admin_request(self) -> bool:
        user = getattr(self.context.get("request"), "user", None)
        return bool(getattr(user, "is_admin", False))

    def validate_extra_recipients(self, value: str) -> str:
        """Direcciones separadas por comas, validadas una a una.

        AUTH-2: el informe de usuarios lleva correo, teléfono y DNI. Quien no
        es administrador solo puede mandarlo a dominios corporativos
        (`FLEET_EMAIL_ALLOWED_DOMAINS`): un destinatario libre desde el correo
        corporativo es una exfiltración programada.
        """
        from django.core.validators import validate_email

        permitidos = {
            d.strip().lower()
            for d in (
                getattr(settings, "FLEET_EMAIL_ALLOWED_DOMAINS", None)
                or getattr(settings, "SAML_ALLOWED_DOMAINS", [])
            )
            if d.strip()
        }
        es_admin = self._is_admin_request()
        limpias = []
        for addr in value.split(","):
            addr = addr.strip()
            if not addr:
                continue
            try:
                validate_email(addr)
            except DjangoValidationError as exc:
                raise serializers.ValidationError(f"«{addr}» no es un correo válido.") from exc
            dominio = addr.rsplit("@", 1)[-1].lower()
            if not es_admin and permitidos and dominio not in permitidos:
                raise serializers.ValidationError(
                    f"«{addr}» está fuera de los dominios corporativos; solo administración "
                    "puede añadir destinatarios externos."
                )
            limpias.append(addr)
        return ", ".join(limpias)

    def validate_drive_folder(self, value):
        """AUTH-2: la carpeta de Drive donde escribe la cuenta de servicio la
        elige administración; quien no lo es conserva la que tenga, sin más."""
        actual = getattr(self.instance, "drive_folder", "") or ""
        if value and value != actual and not self._is_admin_request():
            raise serializers.ValidationError(
                "Solo administración puede elegir la carpeta de Drive del envío."
            )
        return value

    def validate(self, attrs):
        """Delega en `NotificationSchedule.clean` para no duplicar las reglas."""
        attrs = super().validate(attrs)
        instance = self.instance
        datos = {
            campo: attrs.get(campo, getattr(instance, campo, None))
            for campo in (
                "content",
                "frequency",
                "weekday",
                "day_of_month",
                "send_email",
                "extra_recipients",
                "save_to_drive",
                "drive_folder",
                "filters",
            )
        }
        datos["extra_recipients"] = datos["extra_recipients"] or ""
        candidato = NotificationSchedule(**datos)
        try:
            candidato.clean()
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.message_dict) from exc
        return attrs


class CatalogUniqueMixin:
    """Unicidad de catálogos que no distingue mayúsculas y ve los desactivados.

    Los catálogos alimentan los selects de toda la aplicación, así que «Seat»,
    «SEAT» y «seat» como tres marcas distintas son un defecto, no una opción; y
    cinco de ellos no tenían restricción alguna.

    La comprobación se hace aquí y no solo con la constraint de BD por dos
    razones: da un mensaje de campo en vez de un IntegrityError (que saldría
    como 500), y permite distinguir el caso importante —que quien ocupa el
    nombre esté DESACTIVADO (N7)—. Ese registro no aparece en ningún listado,
    de modo que un «ya existe» a secas era incomprensible: se responde 409 con
    su id para que la gestión lo restaure.

    Subclases: `catalog_key` (campos que forman la clave; los de texto se
    comparan sin distinguir mayúsculas) y `catalog_kind` (clave del espacio de
    erratas, que coincide con el recurso de la API).
    """

    catalog_key: tuple[str, ...] = ()
    catalog_kind: str = ""

    def validate(self, attrs):
        attrs = super().validate(attrs)
        model = self.Meta.model
        instance = getattr(self, "instance", None)

        # En PATCH parcial los campos ausentes se toman de la instancia: si solo
        # se edita el email de un renting, la clave sigue siendo su nombre.
        valores = {}
        for campo in self.catalog_key:
            if campo in attrs:
                valores[campo] = attrs[campo]
            elif instance is not None:
                valores[campo] = getattr(instance, campo)
            else:
                # Falta un campo de la clave y no hay instancia: que lo cante el
                # `required` del propio campo, no esta comprobación.
                return attrs

        criterio = {}
        for campo, valor in valores.items():
            if isinstance(valor, str):
                criterio[f"{campo}__iexact"] = valor.strip()
            else:
                criterio[campo] = valor

        choque = model.objects.filter(**criterio)
        if instance is not None:
            choque = choque.exclude(pk=instance.pk)
        choque = choque.first()
        if choque is None:
            return attrs

        etiqueta = str(choque)
        if not choque.is_active:
            raise InactiveConflict(
                f"«{etiqueta}» ya existe, pero está desactivado. Restáuralo en vez de "
                f"crearlo de nuevo.",
                kind=self.catalog_kind,
                pk=choque.pk,
                label=etiqueta,
            )

        # Activo: error de campo normal, sobre el primero de la clave que sea texto.
        campo_error = next(
            (c for c in self.catalog_key if isinstance(valores.get(c), str)),
            self.catalog_key[0],
        )
        raise serializers.ValidationError({campo_error: f"«{etiqueta}» ya existe."})


class FuelTypeSerializer(CatalogUniqueMixin, serializers.ModelSerializer):
    """GAP-1: tipo de combustible; el factor convierte litros en emisiones."""

    catalog_key = ("name",)
    catalog_kind = "fuel-types"

    class Meta:
        model = FuelType
        fields = ["id", "name", "co2_factor"]


class SiteSerializer(CatalogUniqueMixin, serializers.ModelSerializer):
    """GAP-4: sede/oficina para la ubicación de los vehículos sin obra."""

    catalog_key = ("name",)
    catalog_kind = "sites"

    class Meta:
        model = Site
        fields = ["id", "name"]


class WorkshopSerializer(CatalogUniqueMixin, serializers.ModelSerializer):
    """Talleres y estaciones de ITV: dónde se cita el vehículo."""

    kind_display = serializers.CharField(source="get_kind_display", read_only=True)

    catalog_key = ("name",)
    catalog_kind = "workshops"

    class Meta:
        model = Workshop
        fields = ["id", "name", "kind", "kind_display", "address", "postal_code", "phone"]


class CountrySerializer(CatalogUniqueMixin, serializers.ModelSerializer):
    catalog_key = ("name",)
    catalog_kind = "countries"

    class Meta:
        model = Country
        fields = ["id", "name", "is_active"]
        read_only_fields = ["is_active"]


class BusinessUnitSerializer(CatalogUniqueMixin, serializers.ModelSerializer):
    catalog_key = ("name",)
    catalog_kind = "business-units"

    class Meta:
        model = BusinessUnit
        fields = ["id", "code", "name", "is_active"]
        read_only_fields = ["is_active"]


class ProjectSerializer(CatalogUniqueMixin, serializers.ModelSerializer):
    catalog_key = ("project_name",)
    catalog_kind = "projects"

    # Obligatorio en altas (el modelo es nullable solo por las filas legacy).
    # En PATCH parcial no se exige, así los proyectos antiguos siguen editables.
    cost_center = serializers.PrimaryKeyRelatedField(
        queryset=Pep.objects.all(), required=True, allow_null=False
    )
    cost_center_display = serializers.StringRelatedField(source="cost_center", read_only=True)

    class Meta:
        model = Project
        fields = ["id", "project_name", "cost_center", "cost_center_display", "is_active"]
        read_only_fields = ["is_active"]


class PepSerializer(CatalogUniqueMixin, serializers.ModelSerializer):
    catalog_key = ("name",)
    catalog_kind = "peps"

    class Meta:
        model = Pep
        fields = ["id", "code", "name", "is_active"]
        read_only_fields = ["is_active"]


class RentingSerializer(CatalogUniqueMixin, serializers.ModelSerializer):
    catalog_key = ("name",)
    catalog_kind = "rentings"

    class Meta:
        model = Renting
        # N10a: email/contacto de la empresa — destinatario del aviso de seguro.
        fields = ["id", "name", "email", "contact_name", "is_active"]
        read_only_fields = ["is_active"]


class BrandSerializer(CatalogUniqueMixin, serializers.ModelSerializer):
    catalog_key = ("name",)
    catalog_kind = "brands"

    class Meta:
        model = Brand
        fields = ["id", "name", "is_active"]
        read_only_fields = ["is_active"]


class VehicleModelSerializer(CatalogUniqueMixin, serializers.ModelSerializer):
    # La clave es (marca, nombre): el mismo modelo puede existir en otra marca.
    catalog_key = ("brand", "name")
    catalog_kind = "vehicle-models"

    # N5: el modelo DEPENDE de la marca — obligatoria en el alta.
    brand = serializers.PrimaryKeyRelatedField(
        queryset=Brand.objects.all(), required=True, allow_null=False
    )
    brand_display = serializers.StringRelatedField(source="brand", read_only=True)

    class Meta:
        model = VehicleModel
        fields = ["id", "brand", "brand_display", "name", "is_active"]
        read_only_fields = ["is_active"]


class CompanySerializer(CatalogUniqueMixin, serializers.ModelSerializer):
    catalog_key = ("code",)
    catalog_kind = "companies"

    class Meta:
        model = Company
        fields = ["id", "code", "name", "description", "is_active"]
        read_only_fields = ["is_active"]


# --- N10b/c: plantillas de correo -------------------------------------------

# Etiquetas y atributos permitidos en el cuerpo de los correos (editor 10c).
_EMAIL_HTML_TAGS = {
    "a",
    "b",
    "strong",
    "i",
    "em",
    "u",
    "p",
    "br",
    "ul",
    "ol",
    "li",
    "h1",
    "h2",
    "h3",
    "blockquote",
    "img",
    "span",
    "div",
    "hr",
}
_EMAIL_HTML_ATTRS = {
    "a": {"href", "title", "target"},
    "img": {"src", "alt", "width", "height"},
    "span": {"style"},
    "div": {"style"},
    "p": {"style"},
}


#: FE-5: lo único que se admite dentro de un `style` del editor de plantillas
#: (propiedad: valor simple). Sin `url(`, sin `expression(`, sin `@import`.
_EMAIL_STYLE_PROPS = {
    "color",
    "background-color",
    "font-weight",
    "font-style",
    "font-size",
    "text-align",
    "text-decoration",
}
_EMAIL_STYLE_VALUE = re.compile(r"^[a-zA-Z0-9#%.,() -]{1,60}$")


def _clean_email_style(value: str) -> str | None:
    """Deja solo las declaraciones seguras de un `style`; None si no queda nada."""
    limpias = []
    for decl in value.split(";"):
        if ":" not in decl:
            continue
        prop, _, val = decl.partition(":")
        prop, val = prop.strip().lower(), val.strip()
        if prop in _EMAIL_STYLE_PROPS and _EMAIL_STYLE_VALUE.match(val) and "(" not in val:
            limpias.append(f"{prop}: {val}")
    return "; ".join(limpias) or None


def _email_attribute_filter(tag: str, attr: str, value: str) -> str | None:
    """FE-5: imágenes solo por https (un `http` deja rastro del lector en claro)
    y `style` reducido a la lista blanca. Devolver None quita el atributo."""
    if tag == "img" and attr == "src":
        return value if value.lower().startswith("https://") else None
    if attr == "style":
        return _clean_email_style(value)
    return value


def sanitize_email_html(value: str) -> str:
    """Sanea el HTML del editor (nh3): fuera scripts/handlers/iframes."""
    import nh3

    return nh3.clean(
        value or "",
        tags=_EMAIL_HTML_TAGS,
        attributes=_EMAIL_HTML_ATTRS,
        url_schemes={"http", "https", "mailto"},
        attribute_filter=_email_attribute_filter,
        link_rel="noopener noreferrer",
    )


class EmailSignatureSerializer(serializers.ModelSerializer):
    class Meta:
        model = EmailSignature
        fields = ["id", "name", "body_html", "is_active"]
        read_only_fields = ["is_active"]

    def validate_body_html(self, value):
        return sanitize_email_html(value)


class EmailTemplateSerializer(serializers.ModelSerializer):
    key_display = serializers.CharField(source="get_key_display", read_only=True)
    signature_name = serializers.StringRelatedField(source="signature", read_only=True)
    has_en = serializers.BooleanField(read_only=True)

    class Meta:
        model = EmailTemplate
        fields = [
            "id",
            "key",
            "key_display",
            "subject",
            "body_html",
            "subject_en",
            "body_html_en",
            "has_en",
            "signature",
            "signature_name",
            "is_active",
            "updated_at",
        ]
        read_only_fields = ["is_active", "updated_at"]

    def validate_body_html(self, value):
        return sanitize_email_html(value)

    def validate_body_html_en(self, value):
        # La versión inglesa pasa por el mismo saneado: viene del mismo editor.
        return sanitize_email_html(value)


class EmailLogSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    alert_message = serializers.CharField(source="alert.message", read_only=True, default="")

    class Meta:
        model = EmailLog
        fields = [
            "id",
            "alert",
            "alert_message",
            "template_key",
            "recipient",
            "subject",
            "status",
            "status_display",
            "error",
            "created_at",
        ]
        read_only_fields = fields


class DriverChangeRequestSerializer(serializers.ModelSerializer):
    """Propuesta de cambio de conductor, tal como la lee la bandeja.

    La fila tiene que decir **de qué coche se habla y a quién se propone** sin
    abrir nada: de ahí la matrícula, el nombre del candidato —sea usuario de la
    app o texto suelto— y el mensaje de la alerta de origen, que es el porqué.

    De entrada solo se aceptan el vehículo, la alerta, el candidato y la nota:
    el estado y el rastro de la resolución los fija el servidor (`resolve`).
    """

    status_display = serializers.CharField(source="get_status_display", read_only=True)
    vehicle_plate = serializers.CharField(source="vehicle.plate", read_only=True, default="")
    requested_by_name = serializers.SerializerMethodField()
    resolved_by_name = serializers.SerializerMethodField()
    proposed_display = serializers.SerializerMethodField()
    alert_message = serializers.CharField(source="alert.message", read_only=True, default="")

    class Meta:
        model = DriverChangeRequest
        fields = "__all__"
        read_only_fields = [
            "id",
            "requested_by",
            "status",
            "resolved_by",
            "resolved_at",
            "resolution_note",
            "created_at",
            "updated_at",
        ]

    @staticmethod
    def _name(person) -> str:
        if not person:
            return ""
        return person.get_full_name() or person.get_username()

    def get_requested_by_name(self, obj) -> str:
        return self._name(obj.requested_by)

    def get_resolved_by_name(self, obj) -> str:
        return self._name(obj.resolved_by)

    def get_proposed_display(self, obj) -> str:
        """A quién se propone, venga de la app o escrito a mano."""
        if obj.proposed_driver_id:
            return self._name(obj.proposed_driver)
        if obj.proposed_name:
            if obj.proposed_email:
                return f"{obj.proposed_name} ({obj.proposed_email})"
            return obj.proposed_name
        return ""

    def validate(self, attrs):
        """Sin candidato, la nota ES la petición: entonces es obligatoria.

        Una fila sin nadie propuesto y sin nada escrito no le dice nada a quien
        la tiene que decidir.
        """
        candidato = attrs.get("proposed_driver") or (attrs.get("proposed_name") or "").strip()
        if not candidato and not (attrs.get("note") or "").strip():
            raise serializers.ValidationError(
                {"note": "Propón a alguien o escribe una nota para administración."}
            )
        return attrs


class ProfileChangeRequestSerializer(serializers.ModelSerializer):
    """Petición de corregir la ficha personal, tal como la lee la bandeja.

    La fila tiene que decir **de quién es la ficha y qué se pide** sin abrir
    nada, así que `changes_display` trae lo pedido ya legible —etiqueta, lo que
    hay hoy y lo que se propone—: quien decide lee el antes y el después, que
    es lo único que hace falta para decidir.

    De entrada solo se aceptan los cambios y la nota: la ficha es la de quien
    firma la petición (la vista la fija) y el estado y el rastro de la
    resolución los escribe el servidor (`resolve`).
    """

    status_display = serializers.CharField(source="get_status_display", read_only=True)
    user_name = serializers.SerializerMethodField()
    user_username = serializers.CharField(source="user.username", read_only=True, default="")
    requested_by_name = serializers.SerializerMethodField()
    resolved_by_name = serializers.SerializerMethodField()
    #: Lo pedido, ya legible: [{field, label, current, proposed}] para que la
    #: bandeja pinte el antes y el después sin repetir aquí las etiquetas.
    changes_display = serializers.SerializerMethodField()

    class Meta:
        model = ProfileChangeRequest
        fields = "__all__"
        read_only_fields = [
            "id",
            "user",
            "requested_by",
            "status",
            "resolved_by",
            "resolved_at",
            "resolution_note",
            "created_at",
            "updated_at",
        ]

    @staticmethod
    def _name(person) -> str:
        if not person:
            return ""
        return person.get_full_name() or person.get_username()

    def get_user_name(self, obj) -> str:
        return self._name(obj.user)

    def get_requested_by_name(self, obj) -> str:
        return self._name(obj.requested_by)

    def get_resolved_by_name(self, obj) -> str:
        return self._name(obj.resolved_by)

    @staticmethod
    def _legible(valor) -> str:
        """Lo que se pinta en la bandeja: un sí/no para las casillas, texto para
        el resto. Un `true` crudo en la columna «Qué pide» no dice nada."""
        if isinstance(valor, bool):
            return "Sí" if valor else "No"
        return "" if valor is None else str(valor)

    def get_changes_display(self, obj) -> list[dict]:
        persona = obj.user
        etiquetas = {
            campo: persona._meta.get_field(campo).verbose_name
            for campo in profile_requests.EDITABLE_FIELDS
        }
        salida = []
        for campo, valor in (obj.changes or {}).items():
            if campo not in profile_requests.EDITABLE_FIELDS:
                continue
            salida.append(
                {
                    "field": campo,
                    "label": str(etiquetas[campo]),
                    "current": self._legible(getattr(persona, campo, "")),
                    "proposed": self._legible(valor),
                }
            )
        return salida

    def validate_changes(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("Se esperaba un objeto {campo: valor}.")
        sobra = set(value) - set(profile_requests.EDITABLE_FIELDS)
        if sobra:
            raise serializers.ValidationError(
                "Esos campos no se piden por aquí: " + ", ".join(sorted(sobra))
            )
        # INP-2: valores planos y cortos; es una ficha personal, no un documento.
        for campo, valor in value.items():
            if valor is not None and not isinstance(valor, str | bool | int):
                raise serializers.ValidationError(f"«{campo}» tiene un valor no válido.")
            if isinstance(valor, str) and len(valor) > 200:
                raise serializers.ValidationError(f"«{campo}» es demasiado largo.")
        return value

    def validate(self, attrs):
        """Sin cambios, la nota ES la petición: entonces es obligatoria.

        Una fila sin nada que corregir y sin nada escrito no le dice nada a
        quien la tiene que decidir.
        """
        cambios = attrs.get("changes") or {}
        if not cambios and not (attrs.get("note") or "").strip():
            raise serializers.ValidationError(
                {"note": "Di qué hay que corregir o escribe una nota para administración."}
            )
        return attrs
