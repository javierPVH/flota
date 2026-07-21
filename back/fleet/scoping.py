"""Acotado (scoping) de la flota visible por rol.

- Administrador: toda la flota.
- Supervisor: solo los vehículos de su grupo (`supervisor=user`).
- Conductor: solo los vehículos con asignación en curso a su nombre.
"""
from .models import Vehicle


def vehicles_for(user):
    """Queryset de vehículos que `user` puede ver, según su rol."""
    qs = Vehicle.objects.all()
    if user.is_admin:
        return qs
    if user.is_supervisor:
        return qs.filter(supervisor=user)
    if user.is_driver:
        return qs.filter(
            assignments__driver=user, assignments__end_date__isnull=True
        ).distinct()
    return qs.none()
