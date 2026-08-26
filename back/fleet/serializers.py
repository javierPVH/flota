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
    NotificationSchedule,
    Pep,
    Project,
    Renting,
    Site,
    Vehicle,
    VehicleLink,
    VehicleModel,
    VehicleRequest,
    VehicleUsage,
    Workshop,
)
from .models.enums import (
    AllocationTarget,
    AssignmentStatus,
    EventType,
    ItvResult,
    UseType,
    VehicleState,
)
from .selectors import current_driver_map


class LogEntrySerializer(serializers.ModelSerializer):
    """Entrada de auditoría de campos (django-auditlog) para el histórico."""

    action = serializers.CharField(source="get_action_display", read_only=True)
    actor = serializers.SerializerMethodField()
    changes = serializers.SerializerMethodField()
    # Modelo de origen (vehicle/contract/assignment/…) y su representación, para
    # que el histórico exhaustivo pueda etiquetar de dónde viene cada cambio.
    model = serializers.SerializerMethodField()
    object_repr = serializers.CharField(read_only=True)

    class Meta:
        model = LogEntry
        fields = ["id", "action", "actor", "changes", "model", "object_repr", "timestamp"]
        read_only_fields = fields

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
    driver_id = serializers.SerializerMethodField()
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
            "driver_name",
            "driver_id",
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
            "driver_id",
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

    def _current_driver(self, obj: Vehicle):
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
        return drivers.get(obj.id)

    def get_driver_name(self, obj: Vehicle) -> str:
        driver = self._current_driver(obj)
        return (driver.get_full_name() or driver.get_username()) if driver else ""

    def get_driver_id(self, obj: Vehicle) -> int | None:
        # Id del conductor vigente: permite enlazar a su ficha desde el listado.
        driver = self._current_driver(obj)
        return driver.id if driver else None

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
    """GAP-2: litros de un vehículo en un mes (serie para el informe HSE)."""

    vehicle_plate = serializers.CharField(source="vehicle.plate", read_only=True)
    source_display = serializers.CharField(source="get_source_display", read_only=True)

    class Meta:
        model = FuelConsumption
        fields = [
            "id",
            "vehicle",
            "vehicle_plate",
            "period",
            "liters",
            "amount",
            "source",
            "source_display",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate_period(self, value):
        """La fila es EL MES: siempre día 1, y nunca un mes futuro."""
        value = value.replace(day=1)
        if value > timezone.localdate().replace(day=1):
            raise serializers.ValidationError("El mes no puede ser futuro.")
        return value

    def validate_liters(self, value):
        if value < 0:
            raise serializers.ValidationError("Los litros no pueden ser negativos.")
        return value

    def validate_amount(self, value):
        if value is not None and value < 0:
            raise serializers.ValidationError("El importe no puede ser negativo.")
        return value

    def validate(self, attrs):
        # La constraint de BD daría un IntegrityError (500); aquí es un 400 de
        # campo. Solo cuentan las filas VIVAS: la corrección típica es
        # desactivar la equivocada y crear la buena.
        vehicle = attrs.get("vehicle", getattr(self.instance, "vehicle", None))
        period = attrs.get("period", getattr(self.instance, "period", None))
        if vehicle is not None and period is not None:
            clash = FuelConsumption.objects.filter(vehicle=vehicle, period=period, is_active=True)
            if self.instance is not None:
                clash = clash.exclude(pk=self.instance.pk)
            if clash.exists():
                raise serializers.ValidationError(
                    {"period": f"Ya hay un consumo de {period:%Y-%m} para ese vehículo."}
                )
        return attrs


class MaintenancePlanSerializer(serializers.ModelSerializer):
    """GAP-8: plan de mantenimiento preventivo de un vehículo."""

    vehicle_plate = serializers.CharField(source="vehicle.plate", read_only=True)

    class Meta:
        model = MaintenancePlan
        fields = [
            "id",
            "vehicle",
            "vehicle_plate",
            "name",
            "every_km",
            "every_months",
            "last_done_date",
            "last_done_km",
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
        fields = ["result", "next_due", "cost"]


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
            return {"kind": "itv", "result": itv.result, "next_due": itv.next_due, "cost": itv.cost}
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
            self._validate_itv(attrs)
        return attrs

    @staticmethod
    def _validate_itv(attrs) -> None:
        """C5/A13: reglas de una ITV registrada a mano.

        - Con resultado FAVORABLE, `next_due` es obligatoria (es el dato que
          alimenta la vigilancia) y tiene que caer dentro de un horizonte
          razonable: sin cota, un `2099-01-01` sacaba el vehículo del radar de
          ITV para siempre (y el job lo reafirmaba en cada pasada).
        - Con resultado NO favorable no se pide fecha: no hay próxima ITV que
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
            raise serializers.ValidationError(
                {"itv": "Registrar una ITV favorable requiere `itv.next_due` (próxima fecha)."}
            )
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


class IncidentSerializer(serializers.ModelSerializer):
    type_display = serializers.CharField(source="get_type_display", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    # Parte de accidente materializado (null en el resto de incidencias).
    accident_report = AccidentReportSerializer(read_only=True)

    class Meta:
        model = Incident
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

    @staticmethod
    def _required(details, names):
        return [name for name in names if not str(details.get(name, "")).strip()]

    def validate(self, attrs):
        attrs = super().validate(attrs)
        incident_type = attrs.get("type", getattr(self.instance, "type", ""))
        details = attrs.get("details", getattr(self.instance, "details", {})) or {}
        mileage = attrs.get("mileage", getattr(self.instance, "mileage", None))
        postal_code = attrs.get(
            "workshop_postal_code", getattr(self.instance, "workshop_postal_code", "")
        )

        if not isinstance(details, dict):
            raise serializers.ValidationError({"details": "Debe ser un objeto."})
        guided_report = details.get("report_version") == 1
        if postal_code and (not postal_code.isdigit() or len(postal_code) != 5):
            raise serializers.ValidationError(
                {"workshop_postal_code": "Indica un código postal de 5 cifras."}
            )

        errors = {}
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


# Extensiones admitidas en la subida de documentos (fotos de cámara + PDF).
DOCUMENT_ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "webp", "heic", "pdf"}


class DocumentSerializer(serializers.ModelSerializer):
    type_display = serializers.CharField(source="get_type_display", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    uploaded_by_name = serializers.SerializerMethodField()
    user_name = serializers.SerializerMethodField()
    file_url = serializers.SerializerMethodField()

    class Meta:
        model = Document
        fields = "__all__"
        # uploaded_by lo fija el servidor (el usuario de la petición).
        read_only_fields = [
            "id",
            "uploaded_by",
            "is_active",
            "deactivated_at",
            "deactivated_by",
            "deactivation_reason",
            "created_at",
            "updated_at",
        ]

    def get_uploaded_by_name(self, obj) -> str:
        user = obj.uploaded_by
        if not user:
            return ""
        return user.get_full_name() or user.get_username()

    def get_user_name(self, obj) -> str:
        """Nombre del titular PERSONA (documentos personales); '' si es de coche."""
        if not obj.user_id:
            return ""
        return obj.user.get_full_name() or obj.user.get_username()

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
        return attrs


# --- Alertas (Épicas 3/5/10) ---------------------------------------------


class AlertSerializer(serializers.ModelSerializer):
    type_display = serializers.CharField(source="get_type_display", read_only=True)
    level_display = serializers.CharField(source="get_level_display", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    vehicle_plate = serializers.CharField(source="vehicle.plate", read_only=True, default="")
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


class VehicleRequestSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    requester_name = serializers.SerializerMethodField()

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

    def validate_extra_recipients(self, value: str) -> str:
        """Direcciones separadas por comas, validadas una a una."""
        from django.core.validators import validate_email

        limpias = []
        for addr in value.split(","):
            addr = addr.strip()
            if not addr:
                continue
            try:
                validate_email(addr)
            except DjangoValidationError as exc:
                raise serializers.ValidationError(f"«{addr}» no es un correo válido.") from exc
            limpias.append(addr)
        return ", ".join(limpias)

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


def sanitize_email_html(value: str) -> str:
    """Sanea el HTML del editor (nh3): fuera scripts/handlers/iframes."""
    import nh3

    return nh3.clean(
        value or "",
        tags=_EMAIL_HTML_TAGS,
        attributes=_EMAIL_HTML_ATTRS,
        url_schemes={"http", "https", "mailto"},
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
