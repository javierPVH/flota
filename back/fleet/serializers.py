from rest_framework import serializers

from .models import Vehicle


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
            "version",
            "state",
            "state_display",
            "is_substitute",
            "supervisor",
            "supervisor_name",
            "business_unit",
            "country",
            "project",
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
