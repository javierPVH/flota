"""Enumerados de alertas (Épicas 3/5/10).

Tipos de alerta, nivel de severidad y ciclo de vida. Las alertas las generan los
trabajos programados (`fleet/management/commands`) sobre datos derivados
(próxima ITV, lecturas de km, proyección, vehículo sin conductor).
"""

from django.db import models


class AlertType(models.TextChoices):
    ITV_DUE = "itv_due", "ITV próxima / vencida"
    INSURANCE_DUE = "insurance_due", "Seguro próximo / vencido"
    KM_READING_PENDING = "km_reading_pending", "Lectura de km pendiente"
    KM_OVERAGE = "km_overage", "Exceso de km proyectado"
    NO_DRIVER = "no_driver", "Vehículo sin conductor"
    # GAP-8: mantenimiento preventivo (por km o por meses) próximo o vencido.
    MAINTENANCE_DUE = "maintenance_due", "Mantenimiento programado"


class AlertLevel(models.TextChoices):
    INFO = "info", "Informativa"
    WARNING = "warning", "Aviso"
    CRITICAL = "critical", "Crítica"


class AlertStatus(models.TextChoices):
    """Ciclo de vida de una alerta: o está abierta o está resuelta.

    No hay "descartada": descartar era decir "esto no me interesa" sin que el
    problema dejara de existir, y dejaba la bandeja con dos formas distintas de
    silenciar lo mismo. Cerrar una alerta es siempre RESOLVED, con su
    `resolved_at`/`resolved_by`; si el aviso no aplicaba, se resuelve igual y el
    histórico dice quién lo decidió.
    """

    OPEN = "open", "Abierta"
    RESOLVED = "resolved", "Resuelta"
