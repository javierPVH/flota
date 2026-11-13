"""Envío de notificaciones Web Push (M8).

Patrón de degradación de la casa (como Drive): sin claves VAPID configuradas,
`push_enabled()` es False y `send_to_user` no hace nada. El import de
`pywebpush` es perezoso para que el back arranque sin la dependencia.

Las suscripciones muertas (el push service responde 404/410 cuando el usuario
revocó el permiso o desinstaló la PWA) se PODAN al enviar: así la tabla no
acumula basura ni se reintenta contra endpoints que nunca volverán.
"""

from __future__ import annotations

import json
import logging
from urllib.parse import urlsplit

from django.conf import settings

from .models import PushSubscription

logger = logging.getLogger("flota")


#: Dispositivos por persona. El envío recorre las suscripciones EN SERIE con
#: 10 s de espera cada una: sin tope, quien registrara cientos de endpoints
#: lentos paraba el motor de alertas en cada aviso suyo.
MAX_SUBSCRIPTIONS_PER_USER = 10


def trim_subscriptions(user) -> None:
    """Deja las `MAX_SUBSCRIPTIONS_PER_USER` suscripciones más recientes."""
    sobrantes = list(
        PushSubscription.objects.filter(user=user)
        .order_by("-pk")
        .values_list("pk", flat=True)[MAX_SUBSCRIPTIONS_PER_USER:]
    )
    if sobrantes:
        PushSubscription.objects.filter(pk__in=sobrantes).delete()


def endpoint_allowed(endpoint: str) -> bool:
    """El endpoint es https y de un servicio de push conocido.

    Se compara el HOST (no un prefijo de la URL) contra
    `WEBPUSH_ALLOWED_HOSTS`: el propio host o un subdominio suyo.
    """
    try:
        parsed = urlsplit(str(endpoint or ""))
    except ValueError:
        return False
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or not host:
        return False
    allowed = [h.strip().lower() for h in settings.WEBPUSH_ALLOWED_HOSTS if h.strip()]
    return any(host == item or host.endswith("." + item) for item in allowed)


def push_enabled() -> bool:
    return bool(settings.WEBPUSH_VAPID_PUBLIC_KEY and settings.WEBPUSH_VAPID_PRIVATE_KEY)


def send_to_user(user, *, title: str, body: str, url: str = "/alertas") -> int:
    """Envía la notificación a TODOS los dispositivos suscritos del usuario.

    Devuelve cuántos envíos fueron aceptados por el push service. Nunca lanza:
    el push es best-effort y jamás debe tumbar al motor de alertas.
    """
    # A quien está de baja no se le avisa: sus suscripciones solo se borraban
    # en el logout explícito, así que un supervisor desactivado seguía
    # recibiendo en el móvil las alertas de su antiguo grupo.
    if not push_enabled() or user is None or not user.is_active:
        return 0
    try:
        from pywebpush import WebPushException, webpush
    except ImportError:  # pragma: no cover - entorno sin la dependencia
        logger.warning("pywebpush no instalado: push deshabilitado.")
        return 0

    payload = json.dumps({"title": title, "body": body, "url": url})
    sent = 0
    for subscription in PushSubscription.objects.filter(user=user):
        # Una fila anterior a la lista de hosts (o escrita por otra vía) no
        # se usa: se poda, como una suscripción muerta.
        if not endpoint_allowed(subscription.endpoint):
            subscription.delete()
            continue
        try:
            webpush(
                subscription_info={
                    "endpoint": subscription.endpoint,
                    "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth},
                },
                data=payload,
                vapid_private_key=settings.WEBPUSH_VAPID_PRIVATE_KEY,
                vapid_claims={"sub": settings.WEBPUSH_CONTACT},
                timeout=10,
            )
            sent += 1
        except WebPushException as exc:
            status = getattr(getattr(exc, "response", None), "status_code", None)
            if status in (404, 410):
                # Suscripción revocada/caducada: se poda.
                subscription.delete()
                logger.info("push: suscripción muerta podada user=%s", user.pk)
            else:
                logger.warning("push: fallo de envío user=%s status=%s", user.pk, status)
        except Exception:  # pragma: no cover - red caída, etc.
            logger.warning("push: error inesperado user=%s", user.pk, exc_info=True)
    return sent
