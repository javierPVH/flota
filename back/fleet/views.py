from rest_framework import viewsets

from accounts.permissions import IsManagementOrDriverReadOnly

from .models import Vehicle
from .serializers import VehicleSerializer


class VehicleViewSet(viewsets.ModelViewSet):
    """CRUD de vehículos.

    - Gestión (admin / admin de flota): CRUD completo sobre toda la flota.
    - Conductor: solo lectura, y solo de los vehículos que tiene asignados.

    El permiso corta la escritura al conductor; el queryset acota además lo que
    ve (defensa en profundidad: ni siquiera lista vehículos ajenos).
    """

    serializer_class = VehicleSerializer
    permission_classes = [IsManagementOrDriverReadOnly]

    def get_queryset(self):
        user = self.request.user
        qs = Vehicle.objects.select_related("assigned_driver")
        if user.is_management:
            return qs
        # Conductor: solo sus vehículos asignados.
        return qs.filter(assigned_driver=user)
