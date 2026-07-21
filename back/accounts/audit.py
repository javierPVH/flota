"""Registro de los modelos de cuentas en la auditoría de campos.

Se excluyen datos ruidosos/sensibles (`password`, `last_login`) y se **enmascara**
el PII (`dni`, `phone`) para que no quede en claro en el histórico de `LogEntry`
(privacidad/GDPR). Importado desde `AccountsConfig.ready()`.
"""

from auditlog.registry import auditlog

from .models import User, UserRole

auditlog.register(
    User,
    exclude_fields=["password", "last_login"],
    mask_fields=["dni", "phone"],
)
auditlog.register(UserRole)
