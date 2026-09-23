"""Una sesión por persona.

Al iniciar sesión —por contraseña, Google, SAML o el admin: todo pasa por
`django.contrib.auth.login`, que emite `user_logged_in`— se cierran las demás
sesiones de ESE usuario y se deja abierta solo la que está entrando. Con la
misma cuenta en dos puestos, la ficha se guardaba desde los dos (y el segundo
chocaba con el bloqueo optimista) y quedaban sesiones olvidadas abiertas en
equipos compartidos. La otra sesión no recibe ningún aviso: en su siguiente
petición el back contesta el 403 `not_authenticated` de siempre, que los dos
fronts ya tratan como «sesión caducada» y devuelven al login.

Las sesiones se borran con el `SessionStore` del motor configurado, así vale
igual con el backend de base de datos que con el de caché.
"""

from __future__ import annotations

import logging
from importlib import import_module

from django.conf import settings
from django.contrib.auth.signals import user_logged_in, user_logged_out
from django.dispatch import receiver

from .models import UserSession

security_logger = logging.getLogger("accounts.security")


def _store(session_key: str):
    engine = import_module(settings.SESSION_ENGINE)
    return engine.SessionStore(session_key=session_key)


def close_other_sessions(user, keep_key: str | None) -> int:
    """Cierra todas las sesiones apuntadas de `user` salvo `keep_key`.

    Devuelve cuántas cerró. Una fila cuya sesión ya no exista (caducó sola) se
    limpia igual: `SessionStore.delete` de una clave inexistente no falla.
    """
    rows = UserSession.objects.filter(user=user)
    if keep_key:
        rows = rows.exclude(session_key=keep_key)
    closed = 0
    for row in rows:
        _store(row.session_key).delete()
        row.delete()
        closed += 1
    return closed


@receiver(user_logged_in)
def enforce_single_session(sender, request, user, **kwargs):
    """Apunta la sesión que entra y cierra las demás de la misma persona."""
    session = getattr(request, "session", None)
    if session is None:
        return
    if not session.session_key:
        # `login()` ya la ha ciclado; por si alguien emite la señal a mano.
        session.save()
    key = session.session_key
    if not key:
        return
    closed = close_other_sessions(user, key)
    UserSession.objects.update_or_create(
        session_key=key,
        defaults={
            "user": user,
            "user_agent": str(request.META.get("HTTP_USER_AGENT", ""))[:255],
        },
    )
    if closed:
        security_logger.info(
            "inicio de sesión user=%s: cerradas %d sesión(es) anteriores", user.pk, closed
        )


@receiver(user_logged_out)
def forget_session(sender, request, user, **kwargs):
    """Al salir (o al caducar por el tope absoluto) la fila sobra."""
    session = getattr(request, "session", None)
    key = getattr(session, "session_key", None)
    if key:
        UserSession.objects.filter(session_key=key).delete()
