"""Endpoints transversales: sondas de salud (liveness / readiness)."""

from django.core.cache import cache
from django.db import connection
from django.http import Http404, JsonResponse
from django.views.decorators.http import require_GET

# Desde dónde se admite la sonda de readiness: solo el propio contenedor (el
# HEALTHCHECK de la imagen y un `docker exec`). `REMOTE_ADDR` es el par TCP
# real —no lo reescribe ningún middleware; el rate limit lee X-Forwarded-For
# por su cuenta—, así que lo que entra por nginx llega con la IP del
# contenedor de nginx y no pasa.
_LOOPBACK = {"127.0.0.1", "::1", "::ffff:127.0.0.1"}


@require_GET
def health(request):
    """GET /api/health/ — **liveness**: el proceso está vivo.

    Sin autenticación y sin tocar dependencias externas (BD/cache): sirve para
    que el orquestador sepa si el proceso responde y decidir si reiniciarlo.
    """
    return JsonResponse({"status": "ok"})


@require_GET
def ready(request):
    """GET /api/ready/ — **readiness**: listo para recibir tráfico.

    Comprueba las dependencias (BD y cache). Devuelve 200 si todo OK, 503 si algo
    falla, para que el balanceador saque la instancia del pool sin matarla.

    Solo desde loopback: dice si la BD y la caché responden, y eso no es para
    internet ni para la VPN. Fuera del contenedor contesta 404, como si no
    existiera (nginx tampoco la reenvía). `health` sigue pública: solo dice
    «vivo» y la miran las comprobaciones de despliegue.
    """
    if request.META.get("REMOTE_ADDR") not in _LOOPBACK:
        raise Http404
    checks = {"database": False, "cache": False}
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
        checks["database"] = True
    except Exception:  # noqa: BLE001 — cualquier fallo de BD ⇒ degradado
        pass
    try:
        cache.set("readiness_probe", "1", 5)
        checks["cache"] = cache.get("readiness_probe") == "1"
    except Exception:  # noqa: BLE001 — cualquier fallo de cache ⇒ degradado
        pass

    all_ok = all(checks.values())
    return JsonResponse(
        {"status": "ready" if all_ok else "degraded", "checks": checks},
        status=200 if all_ok else 503,
    )
