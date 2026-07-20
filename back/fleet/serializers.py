from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import Vehicle

User = get_user_model()


class VehicleSerializer(serializers.ModelSerializer):
    """Serializer de vehículo.

    ``assigned_driver`` se escribe por id y se valida que el usuario sea
    conductor. ``assigned_driver_name`` es un extra de solo lectura para pintar
    el nombre sin una segunda petición.
    """

    assigned_driver_name = serializers.SerializerMethodField()
    status_display = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = Vehicle
        fields = [
            "id",
            "plate",
            "brand",
            "model",
            "year",
            "status",
            "status_display",
            "assigned_driver",
            "assigned_driver_name",
            "notes",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def get_assigned_driver_name(self, obj: Vehicle) -> str:
        driver = obj.assigned_driver
        if not driver:
            return ""
        full = driver.get_full_name()
        return full or driver.get_username()

    def validate_assigned_driver(self, value):
        if value is not None and not value.is_driver:
            raise serializers.ValidationError(
                "El usuario asignado debe tener rol de conductor."
            )
        return value
