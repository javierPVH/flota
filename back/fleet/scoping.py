"""Acotado (scoping) de la flota visible por rol.

- Administrador: toda la flota.
- Supervisor: los vehículos de su grupo (`supervisor=user`).
- Conductor: los vehículos con asignación ACEPTADA en curso a su nombre.
- HSE: toda la flota, pero SOLO PARA LEER.

Los roles son multi-valor y los ámbitos se SUMAN: una supervisora que además
conduce ve su grupo Y su propio coche, aunque ese coche lo supervise otra
persona (o nadie) — sin la unión no podía ni registrar los km de su coche.

Lo que HSE aporta es distinto de lo demás: es un ámbito de LECTURA. Por eso
`vehicles_for` y `readable_documents` llevan `write`: con `write=True` devuelven
el ámbito sobre el que el usuario ACTÚA —escrituras, acciones POST y bandejas
de decisión—, que es el de siempre y deja fuera lo que añade HSE. Sin esa
distinción, un conductor con HSE podría registrar km en cualquier coche y un
supervisor con HSE resolver las alertas de toda la flota: el ámbito de lectura
se colaría en la escritura por el mismo `get_object`.
"""

from django.contrib.auth import get_user_model
from django.db.models import Exists, F, OuterRef, Q

from .models import Assignment, Document, Vehicle
from .selectors import current_assignment_q, current_driver_map


def vehicles_for(user, *, write: bool = False):
    """Queryset de vehículos que `user` puede ver, según sus roles (unidos).

    `write=True` pide el ámbito sobre el que ACTÚA: el mismo sin lo que añade
    HSE, que es solo lectura (ver la cabecera del módulo).
    """
    qs = Vehicle.objects.all()
    if user.is_admin:
        return qs
    if user.is_hse and not write:
        return qs
    scope = Q()
    if user.is_supervisor:
        scope |= Q(supervisor=user)
    if user.is_driver:
        # C1: solo las asignaciones ACEPTADAS dan ámbito. Sin el filtro de
        # estado, una propuesta (o una propuesta ya RECHAZADA, que conserva
        # `end_date=NULL`) abría al conductor el vehículo y todo lo que cuelga
        # de él —documentos, facturas, incidencias, eventos— de forma
        # permanente. R3-02: «en curso» incluye el fin PROGRAMADO aún no
        # alcanzado (grant/accept con fechas) — criterio único de
        # `selectors.current_assignment_q`, el mismo que `current_driver_map`.
        scope |= Q(assignments__driver=user) & current_assignment_q(prefix="assignments__")
    if scope:
        return qs.filter(scope).distinct()
    return qs.none()


def users_for(user):
    """Queryset de usuarios cuyos documentos PERSONALES puede ver `user`.

    Mismo espíritu que `vehicles_for`: el admin ve a todos; el supervisor, a sí
    mismo y a los conductores con asignación ACEPTADA en curso sobre sus
    vehículos; cualquier otro, solo a sí mismo (su permiso de conducir…).
    HSE no añade a nadie: lee la flota, no a las personas (ni sus documentos
    personales, ni `/auth/drivers/`, ni el informe de usuarios).
    """
    User = get_user_model()
    qs = User.objects.all()
    if user.is_admin:
        return qs
    if user.is_supervisor:
        drivers = (
            Assignment.objects.filter(current_assignment_q(), vehicle__supervisor=user)
            .exclude(driver__isnull=True)
            .values("driver_id")
        )
        return qs.filter(Q(pk=user.pk) | Q(pk__in=drivers))
    return qs.filter(pk=user.pk)


def readable_documents(user, qs=None, *, write: bool = False):
    """Los documentos que `user` puede LEER, de entre los de su ámbito.

    Son DOS capas que van juntas y hacen cosas distintas: `vehicles_for` /
    `users_for` dicen de qué documentos se puede llegar a hablar (el titular
    está en mi ámbito), y esta dice cuáles de esos se leen. Antes solo existía
    la primera, así que cualquier conductor del coche veía todos sus
    documentos y el supervisor los de todo su grupo.

    Se lee un documento si está compartido (`shared_read`, el interruptor de
    gestión), si se es su responsable, si se es quien lo subió —o el autor
    perdería de vista lo que acaba de subir a un coche sin conductor— o, siendo
    SUPERVISOR, si su responsable es el conductor VIGENTE del vehículo de ese
    documento (mismo criterio de «en curso» que todo lo demás:
    `current_assignment_q`). Lo `protected` no lo ve nadie salvo la gestión,
    con una excepción: el titular de un documento personal sigue viendo el
    suyo, porque taparle a alguien su propia documentación choca con su derecho
    de acceso (RGPD).

    HSE lee TODOS los documentos DE VEHÍCULO (`user` nulo), compartidos o no,
    protegidos o no: son documentación de la flota y ese rol existe para
    leerla entera. Los PERSONALES (permiso de conducir…) quedan fuera, ni en
    listado: son datos personales de otro. Solo los suyos propios, por lo
    mismo de siempre (RGPD). Con `write=True` (lo que se puede tocar o pedir)
    HSE no añade nada.

    Es la única fuente de verdad, y la usan las TRES puertas por las que sale
    un documento: el listado de la API, la descarga del binario
    (`core.media_views`) y el informe de documentos (`services.reports`).
    """
    qs = Document.objects.all() if qs is None else qs
    if user.is_admin:
        return qs
    ambito = Q(vehicle_id__in=vehicles_for(user, write=write).values("id")) | Q(
        user_id__in=users_for(user).values("id")
    )
    # Las disyuntivas BARATAS primero: así el planificador solo evalúa el
    # EXISTS correlado en las filas que no ha resuelto ya con una comparación.
    visible = Q(shared_read=True) | Q(responsible=user) | Q(uploaded_by=user)
    if user.is_supervisor:
        # El par (vehículo, responsable) tiene que ser una asignación vigente:
        # no vale «el responsable es alguno de mis conductores», que dejaría
        # ver el documento del coche A al supervisor por ser conductor del B.
        visible |= Q(
            Exists(
                Assignment.objects.filter(
                    current_assignment_q(),
                    vehicle=OuterRef("vehicle"),
                    driver=OuterRef("responsible"),
                )
            )
        )
        # Y su equivalente en un documento personal, donde el responsable es el
        # propio titular: `users_for` ya lo acotó a sus conductores en curso.
        visible |= Q(user__isnull=False, responsible=F("user"))
    # Lo propio manda sobre las dos reglas: un documento personal lo ve su
    # titular aunque no esté compartido y aunque esté protegido (RGPD).
    legible = Q(user=user) | (visible & Q(protected=False))
    if user.is_hse and not write:
        # Todo lo del coche y nada de las personas. `user` nulo basta: un
        # documento tiene exactamente un titular (lo valida el serializer).
        legible |= Q(user__isnull=True)
    return qs.filter(ambito & legible)


def default_responsible(user=None, vehicle=None):
    """Quién responde de un documento recién subido.

    El titular si es personal; el conductor VIGENTE si es de un vehículo, que
    puede no haberlo (entonces el documento nace sin responsable y solo lo ven
    la gestión y quien lo subió).
    """
    if user is not None:
        return user
    if vehicle is None:
        return None
    return current_driver_map([vehicle.pk]).get(vehicle.pk)
