"""Registro de los modelos de cuentas en la auditoría de campos.

Se excluyen datos ruidosos/sensibles (`password`, `last_login`) y se **enmascara**
el PII (`phone`) para que no quede en claro en el histórico de `LogEntry`
(privacidad/GDPR). Importado desde `AccountsConfig.ready()`.

Ojo con lo que el enmascarado da de sí: `auditlog.diff.mask_str` tapa **solo la
primera mitad** del valor, así que de un teléfono quedan guardadas las últimas
cifras. Es aceptable para un dato de contacto, y es justo el motivo por el que
el DNI no se resolvió enmascarándolo sino **quitándolo** (migración
`accounts/0008`): medio DNI sigue identificando a una persona.
"""

from auditlog.registry import auditlog

from .models import User, UserRole

auditlog.register(
    User,
    exclude_fields=["password", "last_login"],
    mask_fields=["phone"],
)
auditlog.register(UserRole)
