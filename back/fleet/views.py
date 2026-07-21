from auditlog.models import LogEntry
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from accounts.permissions import IsManagement, IsManagementOrDriverReadOnly

from .models import Vehicle
from .serializers import LogEntrySerializer, VehicleSerializer


def _json_safe(value):
    """Valor serializable para el diff de preview (FKs → pk)."""
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if hasattr(value, "pk"):
        return value.pk
    return str(value)


class VehicleViewSet(viewsets.ModelViewSet):
    """CRUD de vehículos.

    - Gestión (admin / supervisor): CRUD completo sobre toda la flota.
    - Conductor: solo lectura, y solo de los vehículos que tiene asignados en
      curso (asignación sin fecha de fin).

    El permiso corta la escritura al conductor; el queryset acota además lo que
    ve (defensa en profundidad).
    """

    serializer_class = VehicleSerializer
    permission_classes = [IsManagementOrDriverReadOnly]

    def get_queryset(self):
        user = self.request.user
        qs = Vehicle.objects.select_related("supervisor", "business_unit", "project")
        if user.is_management:
            return qs
        # Conductor: vehículos con asignación en curso a su nombre.
        return qs.filter(assignments__driver=user, assignments__end_date__isnull=True).distinct()

    @action(detail=True, methods=["get"], permission_classes=[IsManagement])
    def history(self, request, pk=None):
        """GET /api/vehicles/{id}/history/ — auditoría de campos del vehículo.

        Solo gestión. Devuelve las entradas de `LogEntry` (quién cambió qué campo
        y cuándo), más recientes primero.
        """
        vehicle = self.get_object()
        entries = LogEntry.objects.get_for_object(vehicle).select_related("actor")
        page = self.paginate_queryset(entries)
        if page is not None:
            return self.get_paginated_response(LogEntrySerializer(page, many=True).data)
        return Response(LogEntrySerializer(entries, many=True).data)

    @action(detail=True, methods=["post"], permission_classes=[IsManagement])
    def preview(self, request, pk=None):
        """POST /api/vehicles/{id}/preview/ — diff de los cambios propuestos.

        Devuelve `{campo: [viejo, nuevo]}` sin persistir: el front muestra qué
        quedará registrado en el histórico antes de confirmar (HU-1.4).
        """
        vehicle = self.get_object()
        serializer = self.get_serializer(vehicle, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        changes = {}
        for field, new_value in serializer.validated_data.items():
            old_value = getattr(vehicle, field, None)
            if old_value != new_value:
                changes[field] = [_json_safe(old_value), _json_safe(new_value)]
        return Response({"changes": changes})
