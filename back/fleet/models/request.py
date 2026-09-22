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
    DriverChangeStatus,
    ProfileChangeStatus,
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
    (`services.profile_requests.EDITABLE_FIELDS`): nombre, apellidos, teléfono
    y tipo de permiso. **El DNI y el correo no viajan aquí** — el correo es la
    clave de identidad (login, Google y resolución del solicitante de Jira) y
    el DNI es un documento de identidad, que ni se teclea en una web pública ni
    se copia a una tabla nueva por si acaso (dato mínimo, RGPD). Para eso está
    la `note`: se escribe qué hay que corregir y la gestión lo verifica contra
    el documento, que es como se verifica un DNI.

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
