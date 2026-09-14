"""Enumerados de incidencias / mantenimiento (Épica 6)."""

from django.db import models


class IncidentType(models.TextChoices):
    """Catálogo visible de peticiones: avería, avería de neumáticos,
    mantenimiento PUNTUAL (el programado es una alerta), accidente y petición
    general. La ITV programada vive en las ALERTAS; el tipo `inspection` se
    conserva para el ciclo interno «En ITV» y no se ofrece como categoría."""

    BREAKDOWN = "breakdown", "Avería"
    MAINTENANCE = "maintenance", "Mantenimiento puntual"
    # GAP-6: el cambio de neumáticos es un proceso de primera línea del
    # levantamiento HSE y no tenía forma de registrarse.
    TIRES = "tires", "Avería de neumáticos"
    ITV = "inspection", "ITV"
    ACCIDENT = "accident", "Accidente"
    # Solicitud general desde la app de campo: peticiones que quizá no tienen
    # que ver con el vehículo (documentación, tarjetas, dudas…).
    GENERAL = "general", "Petición general"


class IncidentPriority(models.TextChoices):
    """Prioridad de la petición, la decide QUIEN la abre (a diferencia del nivel
    de una alerta, que el motor calcula por cercanía de la fecha).

    Declaradas de más a menos urgente: ese es el orden en que salen en todos los
    selectores y el que ordena las listas.
    """

    CRITICAL = "critical", "Crítica"
    MODERATE = "moderate", "Moderada"
    FUNCTIONAL = "functional", "Funcional"
    INFORMATIVE = "informative", "Informativa"


class IncidentStatus(models.TextChoices):
    OPEN = "open", "Abierta"
    IN_PROGRESS = "on_going", "En curso"
    CLOSED = "closed", "Cerrada"


class IncidentLiability(models.TextChoices):
    """Quién asume el coste de un accidente al cerrarlo (datos del siniestro)."""

    OWN = "own", "Seguro propio"
    THIRD_PARTY = "third_party", "Tercero"
    DEDUCTIBLE = "deductible", "Franquicia"


#: Posiciones de rueda del parte de neumáticos (mismos valores que el parte
#: guiado `details.wheel`) — se reutilizan en el cierre para las montadas.
TIRE_POSITIONS = ("front_left", "front_right", "rear_left", "rear_right")
