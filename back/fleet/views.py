from rest_framework import viewsets

from accounts.permissions import IsManagementOrDriverReadOnly

from .models import Vehicle
from .serializers import VehicleSerializer


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
