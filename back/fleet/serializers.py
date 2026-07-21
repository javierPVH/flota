from auditlog.models import LogEntry
from rest_framework import serializers

from .models import Vehicle
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
