"""Endpoints de notificaciones push (M8): configuración + suscripciones."""

from django.conf import settings
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from rest_framework.views import APIView

from core.throttling import PublicWriteThrottle

from .models import PushSubscription
from .push import push_enabled


class PushConfigView(APIView):
    """GET /api/v1/push/config/ — ¿está el push habilitado y con qué clave?

    La clave VAPID pública no es secreta: el navegador la necesita para
    suscribirse. `subscribed` dice si ESTE usuario ya tiene algún dispositivo.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(
            {
                "enabled": push_enabled(),
                "public_key": settings.WEBPUSH_VAPID_PUBLIC_KEY,
                "subscribed": PushSubscription.objects.filter(user=request.user).exists(),
            }
        )


class PushSubscriptionView(APIView):
    """POST/DELETE /api/v1/push/subscriptions/ — alta/baja del dispositivo.

    El cuerpo es la `PushSubscription` del navegador
    (`{endpoint, keys: {p256dh, auth}}`). El alta es idempotente por
    `endpoint` (re-suscribirse actualiza claves y dueño — el endpoint es del
    dispositivo, no de la cuenta).
    """

    permission_classes = [IsAuthenticated]
    # SEC9: alta/baja de suscripciones alcanzable desde internet.
    throttle_classes = [UserRateThrottle, PublicWriteThrottle]
    throttle_scope = "public_write"

    def post(self, request):
        endpoint = str(request.data.get("endpoint", "")).strip()
        keys = request.data.get("keys") or {}
        p256dh = str(keys.get("p256dh", "")).strip()
        auth = str(keys.get("auth", "")).strip()
        if not (endpoint.startswith("https://") and p256dh and auth):
            return Response(
                {"detail": "Suscripción inválida: faltan endpoint o claves."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        PushSubscription.objects.update_or_create(
            endpoint=endpoint,
            defaults={
                "user": request.user,
                "p256dh": p256dh,
                "auth": auth,
                "user_agent": request.headers.get("User-Agent", "")[:255],
            },
        )
        return Response({"subscribed": True}, status=status.HTTP_201_CREATED)

    def delete(self, request):
        endpoint = str(request.data.get("endpoint", "")).strip()
        # Solo las propias: no se puede dar de baja el dispositivo de otro.
        PushSubscription.objects.filter(user=request.user, endpoint=endpoint).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
