from auditlog.models import LogEntry
from rest_framework import serializers

from .models import (
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
from .models.enums import UseType


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


class VehicleSerializer(serializers.ModelSerializer):
    """Serializer de vehículo (nuevo esquema).

    El conductor se relaciona vía `Assignment`, no con un campo directo. Se
    exponen etiquetas legibles y el nombre del supervisor para pintar sin joins
    extra en el front.
    """

    state_display = serializers.CharField(source="get_state_display", read_only=True)
    supervisor_name = serializers.SerializerMethodField()

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
        ]
        read_only_fields = ["id"]

    def get_supervisor_name(self, obj: Vehicle) -> str:
        sup = obj.supervisor
        if not sup:
            return ""
        return sup.get_full_name() or sup.get_username()

    def validate(self, attrs):
        # HU-1.3: proyecto obligatorio cuando el uso empresarial es "proyecto".
        business_use = attrs.get("business_use", getattr(self.instance, "business_use", ""))
        project = attrs.get("project", getattr(self.instance, "project", None))
        if business_use == UseType.ON_PROJECT and project is None:
            raise serializers.ValidationError(
                {"project": "El proyecto es obligatorio cuando el uso es 'Proyecto'."}
            )
        return attrs


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
                    {"km_reading": f"El odómetro no puede retroceder (última: {previous.km_reading} km)."}
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
        if vehicle is not None and vehicle.state == "baja":
            raise serializers.ValidationError(
                "No se puede asignar un conductor a un vehículo en baja."
            )
        return attrs


class VehicleUsageSerializer(serializers.ModelSerializer):
    class Meta:
        model = VehicleUsage
        fields = "__all__"
        read_only_fields = ["id", "created_at", "updated_at"]


class VehicleLinkSerializer(serializers.ModelSerializer):
    class Meta:
        model = VehicleLink
        fields = "__all__"
        read_only_fields = ["id", "created_at", "updated_at"]


class EventSerializer(serializers.ModelSerializer):
    event_type_display = serializers.CharField(source="get_event_type_display", read_only=True)

    class Meta:
        model = Event
        fields = "__all__"
        read_only_fields = ["id", "created_at", "updated_at"]


class InvoiceSerializer(serializers.ModelSerializer):
    class Meta:
        model = Invoice
        fields = "__all__"
        read_only_fields = ["id", "created_at", "updated_at"]


class InvoiceAllocationSerializer(serializers.ModelSerializer):
    class Meta:
        model = InvoiceAllocation
        fields = "__all__"
        read_only_fields = ["id", "created_at", "updated_at"]


# --- Documentación e incidencias (Épica 4 / 6) ---------------------------

class IncidentSerializer(serializers.ModelSerializer):
    type_display = serializers.CharField(source="get_type_display", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = Incident
        fields = "__all__"
        read_only_fields = ["id", "created_at", "updated_at"]


class DocumentSerializer(serializers.ModelSerializer):
    type_display = serializers.CharField(source="get_type_display", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    uploaded_by_name = serializers.SerializerMethodField()

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
    class Meta:
        model = Project
        fields = ["id", "project_name"]


class PepSerializer(serializers.ModelSerializer):
    class Meta:
        model = Pep
        fields = ["id", "code", "name"]


class RentingSerializer(serializers.ModelSerializer):
    class Meta:
        model = Renting
        fields = ["id", "name"]
