"""Formularios del admin de Django."""

from django.contrib.admin.forms import AdminAuthenticationForm
from django.core.exceptions import ValidationError

from .ratelimit import is_blocked, register_failure, reset_failures


class RateLimitedAdminAuthenticationForm(AdminAuthenticationForm):
    """Entrada al `/admin/` con el mismo anti fuerza bruta que la API (R6-04).

    El límite de intentos vivía solo en `LoginView`; el formulario del admin
    aceptaba intentos sin tope contra el mismo superusuario. Aquí se reutilizan
    los contadores de `accounts.ratelimit`: bloqueado → no se llega ni a
    comprobar la contraseña; fallo → suma; acierto → limpia.
    """

    def clean(self):
        identifier = str(self.cleaned_data.get("username") or "").strip()
        limitar = self.request is not None and bool(identifier)
        if limitar:
            blocked, retry_after = is_blocked(self.request, identifier)
            if blocked:
                raise ValidationError(
                    f"Demasiados intentos. Inténtalo de nuevo en {retry_after} segundos.",
                    code="rate_limited",
                )
        try:
            cleaned = super().clean()
        except ValidationError:
            if limitar:
                register_failure(self.request, identifier)
            raise
        if limitar:
            reset_failures(self.request, identifier)
        return cleaned
