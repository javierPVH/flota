"""Campo de texto cifrado en reposo (Fernet / AES-128-CBC + HMAC-SHA256).

Se usa para las credenciales OAuth de Google (`refresh_token`/`access_token`,
Fase A3): en la BD queda el ciphertext con un prefijo de versión, y el resto del
código lee/escribe texto plano de forma transparente. Patrón traído de `list`.

ROTACIÓN DE CLAVE: se usa `MultiFernet`. `FIELD_ENCRYPTION_KEYS` puede listar
varias claves: la PRIMERA cifra los datos nuevos y TODAS pueden descifrar. Para
rotar, pon la clave nueva primero y deja la antigua detrás; los datos viejos se
re-cifran al volver a guardarse. Sin claves configuradas se deriva una del
`SECRET_KEY` (suficiente mientras el secreto no cambie).
"""

import base64
import hashlib

from django.conf import settings
from django.db import models


def _encryption_keys() -> list[str]:
    """Claves Fernet: `FIELD_ENCRYPTION_KEYS` (rotación) > derivada del SECRET_KEY."""
    keys = list(getattr(settings, "FIELD_ENCRYPTION_KEYS", None) or [])
    if keys:
        return keys
    digest = hashlib.sha256(settings.SECRET_KEY.encode()).digest()
    return [base64.urlsafe_b64encode(digest).decode()]


# Prefijo que marca un valor ya cifrado (distingue de texto plano legado y
# permite versionar el esquema de cifrado a futuro).
_PREFIX = "enc:v1:"


def _fernet():
    """`MultiFernet`: cifra con la primera clave, descifra con cualquiera."""
    from cryptography.fernet import Fernet, MultiFernet

    return MultiFernet(
        [Fernet(k.encode() if isinstance(k, str) else k) for k in _encryption_keys()]
    )


class EncryptedTextField(models.TextField):
    """`TextField` cifrado en reposo, transparente al ORM."""

    def get_prep_value(self, value):
        value = super().get_prep_value(value)
        if not value:
            return value
        if isinstance(value, str) and value.startswith(_PREFIX):
            return value  # ya cifrado (no re-cifrar)
        token = _fernet().encrypt(str(value).encode()).decode()
        return _PREFIX + token

    def from_db_value(self, value, expression, connection):
        if not value or not value.startswith(_PREFIX):
            return value  # vacío o legado en texto plano
        from cryptography.fernet import InvalidToken

        try:
            return _fernet().decrypt(value[len(_PREFIX) :].encode()).decode()
        except InvalidToken:
            # Clave rotada o dato corrupto: no exponer basura ni romper la lectura.
            return ""
