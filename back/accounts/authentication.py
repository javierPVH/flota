"""Autenticadores DRF propios."""

from rest_framework.authentication import SessionAuthentication


class CsrfOnlyAuthentication(SessionAuthentication):
    """Exige CSRF sin autenticar a nadie: para las vistas que CREAN la sesión.

    `SessionAuthentication` solo comprueba el token cuando ya hay un usuario en
    la sesión, y las vistas de login iban con `authentication_classes = []`, así
    que un `POST /auth/login/` desde otro origen pasaba sin token: un «login
    CSRF» (R6-05) —una web ajena inicia sesión en el navegador de otra persona
    con las credenciales del atacante—. La SPA ya pide `/auth/csrf/` y manda
    `X-CSRFToken` antes de entrar, así que esto no le cambia nada; al que no
    trae token le responde el 403 JSON de DRF («CSRF Failed»), no el HTML de
    Django.
    """

    def authenticate(self, request):
        self.enforce_csrf(request)
        return None
