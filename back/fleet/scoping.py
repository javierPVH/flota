"""Acotado (scoping) de la flota visible por rol.

- Administrador: toda la flota.
- Supervisor: los vehículos de su grupo (`supervisor=user`).
- Conductor: los vehículos con asignación ACEPTADA en curso a su nombre.
- Cualquiera con un REPARTO DE USO vigente: ese coche (ver abajo).
- HSE: toda la flota, pero SOLO PARA LEER.

Los roles son multi-valor y los ámbitos se SUMAN: una supervisora que además
conduce ve su grupo Y su propio coche, aunque ese coche lo supervise otra
persona (o nadie) — sin la unión no podía ni registrar los km de su coche.

El **reparto de uso** es la tercera puerta, y da lo mismo que una asignación:
quien tiene un coche repartido lo usa de verdad —unos días, unas horas—, así
que lee su ficha y registra sobre él sus km, su combustible, sus incidencias y
sus documentos. Lo que NO le da es ser su conductor: `current_driver_map` sigue
mirando solo las asignaciones, el coche tiene su titular y es a él a quien se
le reclama la lectura del mes.

Lo que HSE aporta es distinto de lo demás: es un ámbito de LECTURA, y solo
sobre VEHÍCULOS (sus documentos no: su vista no los enseña). Por eso
`vehicles_for` y `readable_documents` llevan `write`: con `write=True` devuelven
el ámbito sobre el que el usuario ACTÚA —escrituras, acciones POST y bandejas
de decisión—, que es el de siempre y deja fuera lo que añade HSE. Sin esa
distinción, un conductor con HSE podría registrar km en cualquier coche y un
supervisor con HSE resolver las alertas de toda la flota: el ámbito de lectura
se colaría en la escritura por el mismo `get_object`.
"""

from django.contrib.auth import get_user_model
from django.db.models import Exists, F, OuterRef, Q

from .models import Assignment, Document, DocumentDeletionRequest, DocumentTypeAccess, Vehicle
from .models.enums import DocumentDeletionStatus, DriverActionMode, DriverDocumentRead
from .selectors import current_assignment_q, current_driver_map, current_usage_q


def vehicles_for(user, *, write: bool = False):
    """Queryset de vehículos que `user` puede ver, según sus roles (unidos) y
    sus repartos de uso vigentes.

    `write=True` pide el ámbito sobre el que ACTÚA: el mismo sin lo que añade
    HSE, que es solo lectura (ver la cabecera del módulo). El reparto sí entra
    en los dos, lectura y escritura: es un coche que esa persona conduce parte
    del tiempo.
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
    # El reparto va SIN condición de rol, al revés que la asignación: lo tiene
    # quien lo tiene. `/vehicle-usages/mine/` ya se sirve a conductor y a
    # gestión, y un supervisor con un reparto en un coche que NO supervisa
    # también lo usa — atarlo a `is_driver` le habría dejado la tarjeta de
    # «Reparto» enlazando a un 404.
    scope |= Q(usages__driver=user) & current_usage_q(prefix="usages__")
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


def _solo_tipos(regla: Q, vetados: set[str], *, ajuste: str, abre, cierra) -> Q:
    """La regla, menos los tipos vetados, y encima el ajuste POR DOCUMENTO
    (`Document.<ajuste>`): uno ajustado a `abre` entra aunque su tipo esté
    vetado y uno ajustado a `cierra` (un valor o varios) sale aunque no lo
    esté; sin ajuste (nulo) manda el tipo. Django niega el nulo como «no es
    `cierra`», que es lo que se quiere."""
    por_tipo = ~Q(type__in=vetados) if vetados else Q()
    cerrado = Q(**{f"{ajuste}__in": cierra}) if isinstance(cierra, tuple) else Q(**{ajuste: cierra})
    return regla & ((por_tipo & ~cerrado) | Q(**{ajuste: abre}))


def _tapado_al_conductor(ocultos: set[str]) -> Q:
    """Los documentos que el conductor no lista EN ABSOLUTO (`none`): los de
    un tipo oculto sin ajuste propio, y los ajustados a `none` sean del tipo
    que sean. Ni lo que subió él."""
    propio = Q(driver_read_override=DriverDocumentRead.NONE)
    if not ocultos:
        return propio
    return propio | (Q(type__in=ocultos) & Q(driver_read_override__isnull=True))


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

    Encima va la capa POR TIPO (`DocumentTypeAccess`, Documentos → Ajustes):
    cada rol de campo lee con SU regla y los roles se suman. Al **conductor**
    un tipo marcado «solo los que subió» le deja únicamente lo que subió él
    (lo compartido y lo suyo como responsable dejan de contar en ese tipo) y
    uno marcado «ninguno» se lo quita entero, también lo que subió él; a la
    **supervisión** un tipo cerrado le quita todo lo que lee como supervisor,
    también lo compartido. Lo que subió uno mismo se lee siempre salvo en ese
    «ninguno» del conductor, y un documento personal propio siempre (RGPD):
    la política por tipo nunca tapa a nadie sus propios papeles. La
    administración no se configura. Y cada documento puede **pisar** lo de su
    tipo (`*_override`, el modal «Acceso» del listado de gestión): abrir al
    conductor una póliza concreta o cerrar a la supervisión unas fotos
    concretas, sin tocar el tipo entero.

    **HSE no añade nada aquí**: su vista es cómo se usa la flota —vehículos,
    lecturas y consumo— y los documentos no están en ella, así que un HSE puro
    no los lista ni se baja su archivo. Leía todos los del coche; se le
    cerraron con el resto (ver `HseReadOnly`). Lo que siga viendo lo verá por
    sus OTROS roles, con las reglas de siempre: un driver+hse, los de su coche;
    y cualquiera, los suyos propios (RGPD).

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
    autor = Q(uploaded_by=user)
    general = Q(shared_read=True) | Q(responsible=user)
    if user.is_driver or user.is_supervisor:
        # Cada rol de campo lee con su regla, recortada por la política de su
        # tipo; lo que subió uno mismo no se recorta, salvo lo que al
        # conductor se le cierra del todo («ninguno»). Los roles se suman.
        visible = Q()
        if user.is_driver:
            visible |= autor & ~_tapado_al_conductor(DocumentTypeAccess.hidden_from_drivers())
            visible |= _solo_tipos(
                general,
                DocumentTypeAccess.restricted_for_drivers(),
                ajuste="driver_read_override",
                abre=DriverDocumentRead.ALL,
                cierra=(DriverDocumentRead.OWN, DriverDocumentRead.NONE),
            )
        if user.is_supervisor:
            visible |= autor
            # El par (vehículo, responsable) tiene que ser una asignación
            # vigente: no vale «el responsable es alguno de mis conductores»,
            # que dejaría ver el documento del coche A al supervisor por ser
            # conductor del B.
            como_supervisor = general | Q(
                Exists(
                    Assignment.objects.filter(
                        current_assignment_q(),
                        vehicle=OuterRef("vehicle"),
                        driver=OuterRef("responsible"),
                    )
                )
            )
            # Y su equivalente en un documento personal, donde el responsable
            # es el propio titular: `users_for` ya lo acotó a sus conductores
            # en curso.
            como_supervisor |= Q(user__isnull=False, responsible=F("user"))
            visible |= _solo_tipos(
                como_supervisor,
                DocumentTypeAccess.closed_to_supervisors(),
                ajuste="supervisor_read_override",
                abre=True,
                cierra=False,
            )
    else:
        visible = autor | general
    # Lo propio manda sobre las dos reglas: un documento personal lo ve su
    # titular aunque no esté compartido y aunque esté protegido (RGPD).
    legible = Q(user=user) | (visible & Q(protected=False))
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


def view_needs_grant(user, access: dict) -> bool:
    """Si a `user` le hace falta una petición de LECTURA concedida para ver el
    archivo (`preview`) de un documento con ese acceso efectivo
    (`Document.effective_access`).

    Solo a quien llega como conductor sin ser gestión: la administración y la
    supervisión lo ven siempre. Listarlo es otra cosa (`readable_documents`).
    """
    if user.is_admin or user.is_supervisor:
        return False
    return access["driver_view"] == DriverActionMode.REQUEST


def download_needs_grant(user, access: dict) -> bool:
    """Si a `user` le hace falta una petición de DESCARGA concedida.

    La administración nunca. Quien conduce, según el tipo o el documento
    (`driver_download`); y a quien NO conduce —la supervisión, o quien llega
    por haberlo subido sin rol de campo— se le pide siempre: la descarga de la
    supervisión va previa solicitud. Un supervisor+conductor lee con las dos
    reglas y aquí vale la suya como conductor, que es la que se configura.
    """
    if user.is_admin:
        return False
    if user.is_driver:
        return access["driver_download"] == DriverActionMode.REQUEST
    return True


def view_denied(user, access: dict) -> bool:
    """Si a `user` NO se le deja ver el archivo, ni pidiéndolo
    (`DriverActionMode.DENY`). Solo a quien llega como conductor sin ser
    gestión, como `view_needs_grant`: la administración y la supervisión lo
    ven siempre."""
    if user.is_admin or user.is_supervisor:
        return False
    return access["driver_view"] == DriverActionMode.DENY


def download_denied(user, access: dict) -> bool:
    """Si a `user` NO se le deja bajarse el archivo, ni pidiéndolo. Solo al
    conductor, que es a quien se le configura; a quien no conduce (la
    supervisión) se le pide siempre y nunca se le cierra del todo."""
    if user.is_admin or not user.is_driver:
        return False
    return access["driver_download"] == DriverActionMode.DENY


def delete_denied(user, access: dict) -> bool:
    """Si a `user` NO se le deja ni PEDIR el borrado (`driver_delete=DENY`).
    Solo al conductor, como la descarga: la supervisión lo pide siempre."""
    if user.is_admin or not user.is_driver:
        return False
    return access["driver_delete"] == DriverActionMode.DENY


def has_access_grant(user, document_id: int, kind: str) -> bool:
    """Si `user` tiene CONCEDIDA una petición de esa clase (lectura o descarga)
    sobre ese documento: la fila concedida es el permiso."""
    return DocumentDeletionRequest.objects.filter(
        document_id=document_id,
        requested_by=user,
        kind=kind,
        status=DocumentDeletionStatus.GRANTED,
    ).exists()
