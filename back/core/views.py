"""Endpoints transversales: sondas de salud (liveness / readiness)."""

from django.core.cache import cache
from django.db import connection
from django.http import JsonResponse
from django.views.decorators.http import require_GET


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
    """
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
