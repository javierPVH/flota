"""Solicitud de vehículo (Épica 8).

Tres orígenes, una sola bandeja: la importación desde Jira (que entra ya
**aprobada**; `jira_key` le da idempotencia, una solicitud por issue), la
solicitud self-service de quien no tiene coche (Fase A2) y la **petición de
coche de sustitución** que abre el conductor desde la app de campo cuando el
suyo se queda parado (`incident`). La gestión le asigna un vehículo
(`status` → `assigned`) o la rechaza: incluir el coche o no es decisión suya.
"""

from django.conf import settings
from django.db import models

from .base import DeactivatableModel, TimeStampedModel
from .enums import (
    DocumentSupplyStatus,
    DocumentType,
    DriverChangeStatus,
    IncidentChangeStatus,
    ProfileChangeStatus,
    ReadingChangeKind,
    ReadingChangeStatus,
    VehicleRequestStatus,
    VehicleType,
)


class VehicleRequest(DeactivatableModel, TimeStampedModel):
    requester = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="vehicle_requests",
        verbose_name="Solicitante",
    )
    vehicle = models.ForeignKey(
        "fleet.Vehicle",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="requests",
        verbose_name="Vehículo asignado",
    )
    #: Petición nacida de una incidencia de campo: el coche que hay que cubrir
    #: es el de la incidencia (`incident.vehicle`), no el de `vehicle`, que es
    #: el que se CONCEDE. Vacío en las otras dos vías (Jira y self-service).
    incident = models.ForeignKey(
        "fleet.Incident",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="vehicle_requests",
        verbose_name="Incidencia de origen",
    )
    requested_type = models.CharField(
        "Tipo solicitado", max_length=20, choices=VehicleType.choices, blank=True
    )
    start_date = models.DateField("Inicio", null=True, blank=True)
    end_date = models.DateField("Fin", null=True, blank=True)
    jira_key = models.CharField(
        "Clave de Jira",
        max_length=40,
        blank=True,
        help_text="Issue de Jira de la solicitud (aprobación externa).",
    )
    status = models.CharField(
        "Estado",
        max_length=15,
        choices=VehicleRequestStatus.choices,
        default=VehicleRequestStatus.APPROVED,
    )
    notes = models.TextField("Notas", blank=True)

    class Meta:
        verbose_name = "solicitud de vehículo"
        verbose_name_plural = "solicitudes de vehículo"
        ordering = ["-created_at", "-pk"]  # R3-23/R5-19: desempate estable
        constraints = [
            # Una solicitud por issue de Jira (idempotencia de la importación).
            # N7: una solicitud desactivada libera su clave de Jira (si no,
            # el issue no se podría reimportar nunca).
            models.UniqueConstraint(
                fields=["jira_key"],
                condition=~models.Q(jira_key="") & models.Q(is_active=True),
                name="unique_jira_key",
            )
        ]

    def __str__(self) -> str:
        who = self.requester or "—"
        return f"Solicitud {self.jira_key or self.pk} · {who} ({self.get_status_display()})"


class DriverChangeRequest(TimeStampedModel):
    """Propuesta de cambio de conductor: el campo propone, la gestión decide.

    Nace al resolver la alerta de **km contratados** en la app de campo: el
    coche va camino de pasarse de los km del contrato, y lo que lo arregla no
    es una observación sino que lo lleve otra persona. Quien supervisa NO
    cambia conductores —eso es un gesto atómico de gestión, con su bloqueo
    optimista y su histórico (`set-driver`)—, así que lo que manda es esto: una
    fila en la bandeja de `/solicitudes`, con **a quién propone**
    (`proposed_*`) o, si no hay a quien proponer, solo la **nota**.

    Por eso hay dos maneras de nombrar al candidato y las dos son opcionales:
    `proposed_driver` cuando es alguien de la aplicación (lo normal) y
    `proposed_name`/`proposed_email` cuando llegue del directorio de Google,
    que todavía no está conectado (`FLEET_GOOGLE_DIRECTORY_ENABLED`). Sin
    ninguno de los dos, la nota ES la petición.

    La decisión **no mueve la asignación**: la marca como atendida o la
    rechaza, y el cambio se hace donde se hace. Un segundo camino para asignar
    conductores acabaría contando otra cosa que el de siempre.

    Como la de borrado de documento, no es `DeactivatableModel`: es el rastro
    de una petición y su decisión, no un dato que se corrija.
    """

    vehicle = models.ForeignKey(
        "fleet.Vehicle",
        on_delete=models.CASCADE,
        related_name="driver_change_requests",
        verbose_name="Vehículo",
    )
    #: La alerta desde la que se propuso, para que la gestión lea el porqué sin
    #: preguntar. Opcional: la fila se sostiene sola si la alerta se cierra.
    alert = models.ForeignKey(
        "fleet.Alert",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="driver_change_requests",
        verbose_name="Alerta de origen",
    )
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="driver_change_requests",
        verbose_name="Solicitante",
    )
    proposed_driver = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        verbose_name="Conductor propuesto",
    )
    proposed_name = models.CharField(
        "Nombre propuesto",
        max_length=150,
        blank=True,
        help_text="A quién se propone cuando no es un usuario de la aplicación.",
    )
    proposed_email = models.EmailField("Correo propuesto", blank=True)
    note = models.TextField(
        "Nota",
        blank=True,
        help_text="Lo que quien propone le cuenta a administración.",
    )
    status = models.CharField(
        "Estado",
        max_length=15,
        choices=DriverChangeStatus.choices,
        default=DriverChangeStatus.PENDING,
    )
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        verbose_name="Resuelta por",
    )
    resolved_at = models.DateTimeField("Resuelta el", null=True, blank=True)
    resolution_note = models.TextField("Observaciones de la resolución", blank=True)

    class Meta:
        verbose_name = "propuesta de cambio de conductor"
        verbose_name_plural = "propuestas de cambio de conductor"
        ordering = ["-created_at", "-pk"]  # R3-23/R5-19: desempate estable
        constraints = [
            # Una sola propuesta viva por coche: dos envíos seguidos (o el
            # reenvío de la cola offline) no llenan la bandeja de filas
            # iguales, igual que en la petición de borrado.
            models.UniqueConstraint(
                fields=["vehicle"],
                condition=models.Q(status=DriverChangeStatus.PENDING),
                name="unique_pending_driver_change",
            )
        ]

    def __str__(self) -> str:
        quien = self.proposed_driver or self.proposed_name or "sin candidato"
        return f"{self.vehicle} - {quien} ({self.get_status_display()})"


class DocumentSupplyRequest(TimeStampedModel):
    """Petición de que le FACILITEN un documento al campo: pide, gestión decide.

    Es la que faltaba. `DocumentDeletionRequest` tiene ya cuatro clases, pero
    las cuatro hablan de un documento que **existe y que quien pide ya ve**:
    borrarlo, corregirlo, abrir su archivo. Lo más frecuente no tenía camino —
    «necesito la ficha técnica de mi coche y no está», o está pero su tipo está
    cerrado al conductor (`DriverDocumentRead.NONE`), así que ni se lista y no
    hay nada sobre lo que pedir acceso—. Ese aviso salía de la herramienta (una
    llamada, un correo) y no dejaba rastro de quién pidió qué.

    Por eso es un modelo propio y no un `kind` más de aquella: la suya cuelga de
    un `Document` que aquí **todavía no existe**, su FK no es nulable y sus dos
    restricciones de unicidad lo dan por hecho.

    El titular es el mismo que el de un documento —**exactamente uno**, el coche
    o la persona—, el `type` sale de `REQUESTABLE_DOCUMENT_TYPES` (lo que la
    gestión puede subir desde la bandeja: pedir algo que no se puede atender es
    una vía muerta) y la **nota es obligatoria**, porque el tipo solo dice qué
    papel es y no para qué hace falta.

    La decide la administración en la misma bandeja de `/solicitudes` que las
    otras cuatro, con dos salidas (`DocumentSupplyStatus`): **atendida** —ahí
    mismo se sube el documento, y entonces la fila se queda con cuál fue
    (`document`), o se dice que ya se entregó por otra vía— o **rechazada**.

    Atenderla **no da acceso por sí sola**: lo subido se lee con la regla de su
    tipo (`DocumentTypeAccess`) y la de cada documento (`readable_documents`).
    Hacer que atender implique compartir sería saltarse esa capa por la puerta
    de atrás.

    Como las otras tres peticiones de campo, no es `DeactivatableModel`: es el
    rastro de una petición y su decisión, no un dato que se corrija.
    """

    vehicle = models.ForeignKey(
        "fleet.Vehicle",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="document_supply_requests",
        verbose_name="Vehículo",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="document_supply_requests",
        verbose_name="Usuario",
        help_text="Titular cuando lo que se pide es un documento personal.",
    )
    type = models.CharField("Tipo pedido", max_length=30, choices=DocumentType.choices)
    note = models.TextField(
        "Nota",
        help_text="Para qué hace falta. Obligatoria: el tipo solo dice qué papel es.",
    )
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        verbose_name="Solicitante",
    )
    status = models.CharField(
        "Estado",
        max_length=15,
        choices=DocumentSupplyStatus.choices,
        default=DocumentSupplyStatus.PENDING,
    )
    #: Con qué se atendió, cuando se subió desde la bandeja. Nulo si se
    #: entregó por otra vía o si se rechazó.
    document = models.ForeignKey(
        "fleet.Document",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="supply_requests",
        verbose_name="Documento facilitado",
    )
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        verbose_name="Resuelta por",
    )
    resolved_at = models.DateTimeField("Resuelta el", null=True, blank=True)
    resolution_note = models.TextField("Observaciones de la resolución", blank=True)

    class Meta:
        verbose_name = "petición de documento"
        verbose_name_plural = "peticiones de documento"
        ordering = ["-created_at", "-pk"]  # R3-23/R5-19: desempate estable
        constraints = [
            # Exactamente un titular, calcada de la del propio `Document`.
            models.CheckConstraint(
                condition=(
                    models.Q(vehicle__isnull=False, user__isnull=True)
                    | models.Q(vehicle__isnull=True, user__isnull=False)
                ),
                name="supply_request_owner_vehicle_xor_user",
            ),
            # Una viva por (titular, tipo, solicitante): pedir dos veces la
            # ficha técnica del mismo coche es la misma petición, pero dos
            # conductores pueden pedir lo mismo —el reparto de las de acceso—.
            # Son DOS y no una porque en Postgres un NULL no colisiona, así que
            # una sola sobre las cuatro columnas no mordería nunca.
            models.UniqueConstraint(
                fields=["vehicle", "type", "requested_by"],
                condition=models.Q(status=DocumentSupplyStatus.PENDING, user__isnull=True),
                name="uniq_pending_vehicle_document_supply",
            ),
            models.UniqueConstraint(
                fields=["user", "type", "requested_by"],
                condition=models.Q(status=DocumentSupplyStatus.PENDING, vehicle__isnull=True),
                name="uniq_pending_personal_document_supply",
            ),
        ]

    def __str__(self) -> str:
        if self.vehicle_id:
            titular = self.vehicle.plate
        else:
            titular = self.user.get_username() if self.user_id else "?"
        return f"{titular} · {self.get_type_display()} ({self.get_status_display()})"


class ProfileChangeRequest(TimeStampedModel):
    """Petición de corregir la ficha personal: la persona pide, la gestión decide.

    En la app de campo «Mi perfil» es de LECTURA —el back no deja a nadie
    editarse su ficha, que es lo que sostiene que el teléfono o el permiso de
    conducir de una flota sean un dato fiable—, pero hasta ahora la pantalla
    solo decía «avisa a gestión»: el aviso salía de la aplicación (un correo,
    un mensaje) y no quedaba rastro de quién pidió qué. Esto es ese aviso
    dentro de la herramienta, en la MISMA bandeja de `/solicitudes` que el
    coche de sustitución, el borrado de un documento y el cambio de conductor.

    `changes` es un diccionario `{campo: valor propuesto}` con **solo lo que
    cambia** y solo de los campos que se dejan pedir
    (`services.profile_requests.EDITABLE_FIELDS`): nombre, apellidos, correo,
    teléfono, tipo de permiso y tarjeta de combustible. El **correo** es la
    clave de identidad (login, Google y resolución del solicitante de Jira), y
    por eso es el único que se comprueba contra el resto de cuentas al pedirlo
    y otra vez al aplicarlo.

    Lo que **no** aparece aquí es el DNI, porque ya no existe en la ficha
    (migración `accounts/0008`): se quitó del sistema por minimización, y de
    paso dejó de copiarse a este JSON, donde se guardaba en claro y no se
    limpiaba al resolver la petición.

    Al aplicarla, el servicio **escribe esos campos en el usuario** y el
    `auditlog` de `accounts` guarda el diff campo a campo, así que el rastro de
    quién cambió qué sigue siendo el de siempre.

    Como las otras dos peticiones de campo, no es `DeactivatableModel`: es el
    rastro de una petición y su decisión, no un dato que se corrija.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="profile_change_requests",
        verbose_name="Ficha",
    )
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        verbose_name="Solicitante",
    )
    changes = models.JSONField(
        "Cambios propuestos",
        default=dict,
        blank=True,
        help_text="Solo lo que cambia: {campo: valor propuesto}.",
    )
    note = models.TextField(
        "Nota",
        blank=True,
        help_text="Lo que quien la abre le cuenta a administración.",
    )
    status = models.CharField(
        "Estado",
        max_length=15,
        choices=ProfileChangeStatus.choices,
        default=ProfileChangeStatus.PENDING,
    )
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        verbose_name="Resuelta por",
    )
    resolved_at = models.DateTimeField("Resuelta el", null=True, blank=True)
    resolution_note = models.TextField("Observaciones de la resolución", blank=True)

    class Meta:
        verbose_name = "petición de corrección de ficha"
        verbose_name_plural = "peticiones de corrección de ficha"
        ordering = ["-created_at", "-pk"]  # R3-23/R5-19: desempate estable
        constraints = [
            # Una petición viva por persona: dos envíos seguidos no llenan la
            # bandeja de filas iguales, igual que las otras dos de campo.
            models.UniqueConstraint(
                fields=["user"],
                condition=models.Q(status=ProfileChangeStatus.PENDING),
                name="unique_pending_profile_change",
            )
        ]

    def __str__(self) -> str:
        return f"{self.user} - {self.get_status_display()}"


class IncidentChangeRequest(TimeStampedModel):
    """Petición de MODIFICAR el parte de una incidencia: el campo propone, gestión decide.

    Quien comunicó una incidencia desde la app de campo no tiene lápiz: el
    parte se corrige desde gestión, y hasta ahora una fecha mal o un
    kilometraje equivocado se arreglaban por teléfono y sin rastro. Esto es
    la propuesta dentro de la herramienta, en la MISMA bandeja de
    `/solicitudes` que la ficha personal, los documentos, el coche de
    sustitución y el cambio de conductor. Mientras está viva, la incidencia
    se pinta en campo de otro color (`Incident.change_pending`).

    `changes` es `{campo: valor propuesto}` con **solo lo que cambia** y solo
    de los campos que se dejan pedir (`services.incident_requests.EDITABLE_FIELDS`):
    fecha, descripción, kilometraje, CP preferente y prioridad. Al aplicarla,
    el servicio **escribe esos campos en la incidencia**, con el diff en el
    `auditlog`.

    Una petición viva por incidencia. No es `DeactivatableModel`: es el rastro
    de una petición y su decisión.
    """

    incident = models.ForeignKey(
        "fleet.Incident",
        on_delete=models.CASCADE,
        related_name="change_requests",
        verbose_name="Incidencia",
    )
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        verbose_name="Solicitante",
    )
    changes = models.JSONField(
        "Cambios propuestos",
        default=dict,
        blank=True,
        help_text="Solo lo que cambia: {campo: valor propuesto}.",
    )
    note = models.TextField(
        "Nota",
        blank=True,
        help_text="Lo que quien la abre le cuenta a gestión.",
    )
    status = models.CharField(
        "Estado",
        max_length=15,
        choices=IncidentChangeStatus.choices,
        default=IncidentChangeStatus.PENDING,
    )
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        verbose_name="Resuelta por",
    )
    resolved_at = models.DateTimeField("Resuelta el", null=True, blank=True)
    resolution_note = models.TextField("Observaciones de la resolución", blank=True)

    class Meta:
        verbose_name = "petición de modificar un parte"
        verbose_name_plural = "peticiones de modificar un parte"
        ordering = ["-created_at", "-pk"]
        constraints = [
            # Una petición viva por incidencia: dos envíos seguidos no llenan
            # la bandeja, igual que las otras de campo.
            models.UniqueConstraint(
                fields=["incident"],
                condition=models.Q(status=IncidentChangeStatus.PENDING),
                name="unique_pending_incident_change",
            )
        ]

    def __str__(self) -> str:
        return f"{self.incident} - {self.get_status_display()}"


class ReadingChangeRequest(TimeStampedModel):
    """Petición de CORREGIR una lectura de km o un consumo: el campo pide, admin decide.

    Para quien conduce, las lecturas de km y las anotaciónes de consumo son
    append-only (SEC4): una cifra mal tecleada no la puede editar ni borrar, y
    hasta ahora se arreglaba por teléfono. Esto es la corrección dentro de la
    herramienta: se pide sobre la ÚLTIMA anotación del coche, espera en
    `/solicitudes` y la administración la aprueba (se escribe en la anotación)
    o la deniega. Mientras está viva, la app de campo enseña las dos cifras:
    la original y la pendiente de cambio.

    Cuelga de UNA anotación: `km_reading` o `fuel_consumption`, según `kind`.
    `vehicle` va repetido para acotar por ámbito sin pasar por dos FKs.
    `changes` es `{campo: valor propuesto}` con solo lo que cambia y
    `original` la foto de lo que la anotación decía al pedirlo, que es lo que
    permite leer la petición después de aplicada.

    Una petición viva por anotación. No es `DeactivatableModel`: es el rastro
    de una petición y su decisión.
    """

    kind = models.CharField("Clase", max_length=10, choices=ReadingChangeKind.choices)
    vehicle = models.ForeignKey(
        "fleet.Vehicle",
        on_delete=models.CASCADE,
        related_name="reading_change_requests",
        verbose_name="Vehículo",
    )
    km_reading = models.ForeignKey(
        "fleet.KmReading",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="change_requests",
        verbose_name="Lectura de km",
    )
    fuel_consumption = models.ForeignKey(
        "fleet.FuelConsumption",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="change_requests",
        verbose_name="Consumo",
    )
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        verbose_name="Solicitante",
    )
    changes = models.JSONField(
        "Cambios propuestos",
        default=dict,
        blank=True,
        help_text="Solo lo que cambia: {campo: valor propuesto}.",
    )
    original = models.JSONField(
        "Valores originales",
        default=dict,
        blank=True,
        help_text="Lo que la anotación decía al pedirse la corrección.",
    )
    note = models.TextField("Nota", blank=True)
    status = models.CharField(
        "Estado",
        max_length=15,
        choices=ReadingChangeStatus.choices,
        default=ReadingChangeStatus.PENDING,
    )
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        verbose_name="Resuelta por",
    )
    resolved_at = models.DateTimeField("Resuelta el", null=True, blank=True)
    resolution_note = models.TextField("Observaciones de la resolución", blank=True)

    class Meta:
        verbose_name = "petición de corregir una lectura"
        verbose_name_plural = "peticiónes de corregir una lectura"
        ordering = ["-created_at", "-pk"]
        constraints = [
            models.UniqueConstraint(
                fields=["km_reading"],
                condition=models.Q(status=ReadingChangeStatus.PENDING),
                name="unique_pending_km_reading_change",
            ),
            models.UniqueConstraint(
                fields=["fuel_consumption"],
                condition=models.Q(status=ReadingChangeStatus.PENDING),
                name="unique_pending_fuel_reading_change",
            ),
            # Exactamente una anotación, y la de su clase.
            models.CheckConstraint(
                condition=(
                    models.Q(
                        kind=ReadingChangeKind.KM,
                        km_reading__isnull=False,
                        fuel_consumption__isnull=True,
                    )
                    | models.Q(
                        kind=ReadingChangeKind.FUEL,
                        km_reading__isnull=True,
                        fuel_consumption__isnull=False,
                    )
                ),
                name="reading_change_one_target",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.get_kind_display()} {self.vehicle_id} - {self.get_status_display()}"

    @property
    def target(self):
        """La anotación sobre la que se pide (lectura de km o consumo)."""
        return self.km_reading if self.kind == ReadingChangeKind.KM else self.fuel_consumption
