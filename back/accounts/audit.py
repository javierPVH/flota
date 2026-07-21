"""Registro de los modelos de cuentas en la auditoría de campos.

Se excluyen datos sensibles/ruidosos (`password`, `last_login`). Importado desde
`AccountsConfig.ready()`.
"""
from auditlog.registry import auditlog

from .models import User, UserRole

auditlog.register(User, exclude_fields=["password", "last_login"])
auditlog.register(UserRole)
