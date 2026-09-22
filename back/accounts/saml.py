"""SSO por SAML (Google Workspace) para la PWA de conductores — patrón de `list`.

Qué hace y qué NO hace, porque es la regla de negocio del acceso:

- `djangosaml2` valida la firma de la aserción de Google. Aquí solo se decide
  **quién entra**: se busca en `User` el **mismo correo** con el que la persona
  se autenticó en Google (Name ID = correo principal, o el atributo `email`).
- **Si existe y está activo, se abre su sesión** de siempre (cookie + CSRF) y
  el resto de la app no se entera de que vino por SAML. Se marca además
  `last_google_login`: un login por SAML demuestra que la persona se autenticó
  en Google, que es lo que el archivador exige para subir a Drive con la
  cuenta de servicio.
- **Si no existe, no se crea nada ni se abre sesión** (misma doctrina SEC10 que
  el login con Google): el ACS devuelve al navegador a `/login?saml=no_user` y
  la PWA enseña el modal que manda a abrir el Jira de solicitud de vehículo.
  Un usuario desactivado tampoco entra (`?saml=inactive`), un correo fuera de
  `SAML_ALLOWED_DOMAINS` tampoco (`?saml=domain`), y un fallo de firma o de
  certificado va a `?saml=error`.

El correo se resuelve UNA vez (`email_from_assertion`) y sobre ese único valor
se hacen las tres comprobaciones —dominio, existencia, activo—, para que no
pueda pasar el dominio con un atributo y buscarse el usuario con otro.

Las tres vistas viven bajo `/api/v1/auth/saml/` (ver `saml_urls.py`); las URLs
públicas son las que se dan de alta en la consola de Google
(`docs/SAML_CONDUCTORES.md`).
"""

import logging

from django.conf import settings
from django.http import HttpResponseRedirect
from django.utils import timezone
from djangosaml2.backends import Saml2Backend
from djangosaml2.middleware import SamlSessionMiddleware
from djangosaml2.views import AssertionConsumerServiceView

logger = logging.getLogger(__name__)
security_logger = logging.getLogger("security")

# Motivos con los que el ACS devuelve al login (la PWA los traduce al modal).
DENIED_NO_USER = "no_user"
DENIED_INACTIVE = "inactive"
DENIED_DOMAIN = "domain"
DENIED_ERROR = "error"

# Atributo del request donde el backend deja el motivo para que lo lea la vista
# (`authenticate()` y `handle_acs_failure()` reciben el mismo request).
_DENIED_ATTR = "saml_denied"

# Posibles nombres del atributo de correo en la aserción. Google los manda con
# el nombre que el administrador escriba en «Asignación de atributos»; por
# defecto usa la etiqueta en español.
EMAIL_ATTRIBUTE_KEYS = ("email", "Correo electrónico principal", "mail", "emailAddress")


def _first(value) -> str:
    """pysaml2 entrega cada atributo como lista; devuelve el primer valor."""
    if isinstance(value, list | tuple):
        value = value[0] if value else ""
    return str(value or "").strip()


def email_from_assertion(session_info: dict, attributes: dict) -> str:
    """Correo de la persona autenticada: el Name ID (formato EMAIL) y, si no
    viene o no parece un correo, el atributo `email`. En minúsculas y sin
    espacios: es la clave con la que se cruza `User.email`."""
    candidate = _first(getattr(session_info.get("name_id"), "text", ""))
    if "@" not in candidate:
        candidate = next(
            (_first(attributes.get(k)) for k in EMAIL_ATTRIBUTE_KEYS if attributes.get(k)), ""
        )
    return candidate.lower()


def _domain_allowed(email: str) -> bool:
    domains = {d.lower().lstrip("@") for d in getattr(settings, "SAML_ALLOWED_DOMAINS", [])}
    return not domains or email.rsplit("@", 1)[-1] in domains


class FleetSaml2Backend(Saml2Backend):
    """Backend de `djangosaml2` que SOLO deja entrar a usuarios ya dados de alta."""

    def _extract_user_identifier_params(self, session_info, attributes, attribute_mapping):
        """La clave de identidad es el correo (A5: único e insensible a
        mayúsculas en `User`), venga en el Name ID o en el atributo."""
        return "email", email_from_assertion(session_info, attributes)

    def get_or_create_user(self, user_lookup_key, user_lookup_value, create_unknown_user, **kwargs):
        """Dominio → existe → activo, sobre el mismo correo. Nunca crea
        (`create_unknown_user` se ignora a propósito) y deja en el request por
        qué no entra, para que el ACS se lo cuente a la PWA."""
        request = kwargs.get("request")
        email = (user_lookup_value or "").lower()
        reason = None
        user = None
        if not email or not _domain_allowed(email):
            reason = DENIED_DOMAIN if email else DENIED_NO_USER
        else:
            user = self._user_model.objects.filter(email__iexact=email).first()
            if user is None:
                reason = DENIED_NO_USER
            elif not user.is_active:
                reason = DENIED_INACTIVE
        if reason:
            # AUTH-8: el correo es dato personal; al log va en resumen, como
            # el identificador del login por contraseña (R5-13).
            from .ratelimit import digest

            security_logger.warning(
                "saml denegado motivo=%s id=%s", reason, digest(email or "")[:12]
            )
            if request is not None:
                setattr(request, _DENIED_ATTR, reason)
            return None, False
        return user, False


class FleetAcsView(AssertionConsumerServiceView):
    """ACS de la PWA: en vez de la página de error de `djangosaml2`, devuelve
    al login de la app con el motivo, para que sea la PWA quien lo explique.
    El motivo sale siempre de nuestras constantes, nunca de la petición."""

    def handle_acs_failure(self, request, exception=None, status=403, **kwargs):
        reason = getattr(request, _DENIED_ATTR, "") or DENIED_ERROR
        if reason == DENIED_ERROR:
            security_logger.warning("saml aserción rechazada (%s): %s", status, exception)
        target = getattr(settings, "SAML_FAILURE_REDIRECT", "/login")
        return HttpResponseRedirect(f"{target}?saml={reason}")

    def post_login_hook(self, request, user, session_info):
        # Misma marca que `GoogleLoginView`: habilita la subida a Drive con la
        # cuenta de servicio para lo que esta persona suba desde el móvil.
        user.last_google_login = timezone.now()
        user.save(update_fields=["last_google_login"])
        security_logger.info("saml login ok user=%s", user.pk)


class SecureSamlSessionMiddleware(SamlSessionMiddleware):
    """La cookie propia de djangosaml2 (`saml_session`: guarda la petición
    pendiente que el ACS coteja contra la respuesta) va con `SameSite=None`
    porque el POST del ACS llega desde accounts.google.com. Los navegadores
    **descartan** una cookie `SameSite=None` sin `Secure`, y en este despliegue
    `SESSION_COOKIE_SECURE` es False porque gestión va por http interno: con
    el middleware de serie la cookie nunca llegaría y TODO login fallaría como
    «respuesta no solicitada». Conductores va siempre por https (túnel), así
    que esta cookie, y solo esta, se fuerza a `Secure`."""

    def process_response(self, request, response):
        response = super().process_response(request, response)
        cookie = response.cookies.get(self.cookie_name)
        if cookie is not None:
            cookie["secure"] = True
        return response
