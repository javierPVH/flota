"""Acotado (scoping) de la flota visible por rol.

- Administrador: toda la flota.
- Supervisor: los vehículos de su grupo (`supervisor=user`).
- Conductor: los vehículos con asignación ACEPTADA en curso a su nombre.

Los roles son multi-valor y los ámbitos se SUMAN: una supervisora que además
conduce ve su grupo Y su propio coche, aunque ese coche lo supervise otra
persona (o nadie) — sin la unión no podía ni registrar los km de su coche.
"""

from django.contrib.auth import get_user_model
from django.db.models import Q

from .models import Assignment, Vehicle
from .models.enums import AssignmentStatus


def vehicles_for(user):
    """Queryset de vehículos que `user` puede ver, según sus roles (unidos)."""
    qs = Vehicle.objects.all()
    if user.is_admin:
        return qs
    scope = Q()
    if user.is_supervisor:
        scope |= Q(supervisor=user)
    if user.is_driver:
        # C1: solo las asignaciones ACEPTADAS dan ámbito. Sin el filtro de
        # estado, una propuesta (o una propuesta ya RECHAZADA, que conserva
        # `end_date=NULL`) abría al conductor el vehículo y todo lo que cuelga
        # de él —documentos, facturas, incidencias, eventos— de forma
        # permanente. Mismo criterio que `selectors.current_driver_map`.
        scope |= Q(
            assignments__driver=user,
            assignments__status=AssignmentStatus.ACCEPTED,
            assignments__end_date__isnull=True,
            assignments__is_active=True,
        )
    if scope:
        return qs.filter(scope).distinct()
    return qs.none()


def users_for(user):
    """Queryset de usuarios cuyos documentos PERSONALES puede ver `user`.

    Mismo espíritu que `vehicles_for`: el admin ve a todos; el supervisor, a sí
    mismo y a los conductores con asignación ACEPTADA en curso sobre sus
    vehículos; cualquier otro, solo a sí mismo (su permiso de conducir…).
    """
    User = get_user_model()
    qs = User.objects.all()
    if user.is_admin:
        return qs
    if user.is_supervisor:
        drivers = (
            Assignment.objects.filter(
                vehicle__supervisor=user,
                status=AssignmentStatus.ACCEPTED,
                end_date__isnull=True,
                is_active=True,
            )
            .exclude(driver__isnull=True)
            .values("driver_id")
        )
        return qs.filter(Q(pk=user.pk) | Q(pk__in=drivers))
    return qs.filter(pk=user.pk)
