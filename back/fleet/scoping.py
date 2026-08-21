"""Acotado (scoping) de la flota visible por rol.

- Administrador: toda la flota.
- Supervisor: solo los vehículos de su grupo (`supervisor=user`).
- Conductor: solo los vehículos con asignación ACEPTADA en curso a su nombre.
"""

from .models import Vehicle
from .models.enums import AssignmentStatus


def vehicles_for(user):
    """Queryset de vehículos que `user` puede ver, según su rol."""
    qs = Vehicle.objects.all()
    if user.is_admin:
        return qs
    if user.is_supervisor:
        return qs.filter(supervisor=user)
    if user.is_driver:
        # C1: solo las asignaciones ACEPTADAS dan ámbito. Sin el filtro de
        # estado, una propuesta (o una propuesta ya RECHAZADA, que conserva
        # `end_date=NULL`) abría al conductor el vehículo y todo lo que cuelga
        # de él —documentos, facturas, incidencias, eventos— de forma
        # permanente. Mismo criterio que `selectors.current_driver_map`.
        return qs.filter(
            assignments__driver=user,
            assignments__status=AssignmentStatus.ACCEPTED,
            assignments__end_date__isnull=True,
            assignments__is_active=True,
        ).distinct()
    return qs.none()
