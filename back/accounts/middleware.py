"""Tope absoluto de sesión en el SERVIDOR (R6-07).

La sesión de Django desliza (`SESSION_COOKIE_AGE` + `SESSION_SAVE_EVERY_REQUEST`):
mientras haya actividad no caduca nunca. El corte de 30 min de inactividad y
6 h de sesión que aplican las SPAs vive en el navegador y se puede saltar. Este
middleware pone el tope real: `SESSION_ABSOLUTE_AGE` segundos desde el inicio
de sesión, se use lo que se use. Al vencer, cierra la sesión y la petición
sigue como anónima: DRF responde su 403 `not_authenticated`, que los fronts ya
tratan como «sesión caducada». Con 0 se desactiva.
"""

import logging
import time

from django.conf import settings
from django.contrib.auth import logout
from django.contrib.auth.signals import user_logged_in
from django.dispatch import receiver

LOGIN_AT_KEY = "login_at"
security_logger = logging.getLogger("accounts.security")


@receiver(user_logged_in)
def stamp_login(sender, request, user, **kwargs):
    """Marca en la sesión cuándo se entró (cualquier vía: API, Google, admin)."""
    if request is not None and hasattr(request, "session"):
        request.session[LOGIN_AT_KEY] = int(time.time())


class SessionAbsoluteAgeMiddleware:
    """Cierra la sesión que lleva más de `SESSION_ABSOLUTE_AGE` abierta."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        max_age = int(getattr(settings, "SESSION_ABSOLUTE_AGE", 0) or 0)
        user = getattr(request, "user", None)
        if max_age > 0 and user is not None and user.is_authenticated:
            now = int(time.time())
            started = request.session.get(LOGIN_AT_KEY)
            if started is None:
                # Sesión anterior a este middleware: el tope empieza a contar hoy.
                request.session[LOGIN_AT_KEY] = now
            elif now - int(started) > max_age:
                security_logger.info("sesión caducada por tope absoluto user=%s", user.pk)
                logout(request)
        return self.get_response(request)


class SecureCookiesOnHttpsMiddleware:
    """AUTH-3: `Secure` en las cookies de sesión y CSRF si la petición vino por https.

    El mismo backend sirve la gestión (http interno, `*_COOKIE_SECURE=False`
    en el `.env.prod`) y la app pública (https por el túnel). Con el ajuste
    global apagado, la cookie de la app pública salía sin `Secure`; aquí se
    decide por petición, con `request.is_secure()` (que ya entiende
    `X-Forwarded-Proto` con `SECURE_BEHIND_PROXY`). Mismo patrón que
    `accounts.saml.SecureSamlSessionMiddleware`.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if request.is_secure():
            for name in (settings.SESSION_COOKIE_NAME, settings.CSRF_COOKIE_NAME):
                morsel = response.cookies.get(name)
                if morsel is not None and not morsel["secure"]:
                    morsel["secure"] = True
        return response
