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

from django.conf import settings

from .models import PushSubscription

logger = logging.getLogger("flota")


def push_enabled() -> bool:
    return bool(settings.WEBPUSH_VAPID_PUBLIC_KEY and settings.WEBPUSH_VAPID_PRIVATE_KEY)


def send_to_user(user, *, title: str, body: str, url: str = "/alertas") -> int:
    """Envía la notificación a TODOS los dispositivos suscritos del usuario.

    Devuelve cuántos envíos fueron aceptados por el push service. Nunca lanza:
    el push es best-effort y jamás debe tumbar al motor de alertas.
    """
    if not push_enabled() or user is None:
        return 0
    try:
        from pywebpush import WebPushException, webpush
    except ImportError:  # pragma: no cover - entorno sin la dependencia
        logger.warning("pywebpush no instalado: push deshabilitado.")
        return 0

    payload = json.dumps({"title": title, "body": body, "url": url})
    sent = 0
    for subscription in PushSubscription.objects.filter(user=user):
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
