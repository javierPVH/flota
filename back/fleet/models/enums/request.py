"""Enumerados de solicitudes: de vehículo (Épica 8), de cambio de conductor, de
corrección de la ficha personal y de **documento pedido**."""

from django.db import models


class VehicleRequestStatus(models.TextChoices):
    """Ciclo de la solicitud.

    Dos orígenes: la importación desde Jira entra ya **aprobada**; la solicitud
    self-service del usuario sin vehículo (Fase A2) entra **pendiente** con su
    clave de ticket, y se aprueba/rechaza al sincronizar con Jira — o a mano por
    la administración si Jira no está disponible. Conceder = asignar vehículo
    (`assigned`).
    """

    PENDING = "pending", "Pendiente de aprobación"
    APPROVED = "approved", "Aprobada"
    ASSIGNED = "assigned", "Vehículo asignado"
    REJECTED = "rejected", "Rechazada"
    CLOSED = "closed", "Cerrada"


class DriverChangeStatus(models.TextChoices):
    """En qué queda la propuesta de cambio de conductor que manda el campo.

    Dos salidas y ninguna más: la administración **la atiende** —el cambio se
    hace donde se hace, en «Cambiar conductor», que es un gesto atómico con su
    bloqueo optimista; esta fila no mueve asignaciones— o **la rechaza**,
    diciendo por qué. Las dos la sacan de pendiente, que es lo que la quita de
    la bandeja y de la cuenta del aviso.
    """

    PENDING = "pending", "Pendiente"
    DONE = "done", "Atendida"
    REJECTED = "rejected", "Rechazada"


class DocumentSupplyStatus(models.TextChoices):
    """En qué queda la petición de que le FACILITEN un documento al campo.

    Las otras tres peticiones sobre documentos hablan de uno que ya existe y
    que quien pide ya ve (borrarlo, corregirlo, abrir su archivo); esta es la
    de antes de todo eso: «necesito la ficha técnica de mi coche y no está» —o
    está, pero su tipo está cerrado al conductor, así que ni se lista y no hay
    nada sobre lo que pedir acceso—.

    Dos salidas, como las otras dos peticiones de campo: la administración **la
    atiende** —subiendo el documento desde la propia bandeja, y entonces la
    fila se queda con cuál fue (`document`), o diciendo que ya se entregó por
    otra vía— o **la rechaza**. Las dos la sacan de pendiente, que es lo que la
    quita de la bandeja y de la cuenta del aviso.
    """

    PENDING = "pending", "Pendiente"
    DONE = "done", "Atendida"
    REJECTED = "rejected", "Rechazada"


class ProfileChangeStatus(models.TextChoices):
    """En qué queda la petición de corregir la ficha personal.

    Dos salidas, como la propuesta de cambio de conductor: la administración
    **la aplica** —son datos escalares, y reescribirlos a mano en la ficha
    invita a que los dos lados no digan lo mismo— o **la rechaza**, diciendo
    por qué. Las dos la sacan de pendiente, que es lo que la quita de la
    bandeja y de la cuenta del aviso.
    """

    PENDING = "pending", "Pendiente"
    DONE = "done", "Aplicada"
    REJECTED = "rejected", "Rechazada"
