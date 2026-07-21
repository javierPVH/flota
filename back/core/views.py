"""Endpoints transversales: health check."""

from django.db import connection
from django.http import JsonResponse
from django.views.decorators.http import require_GET


@require_GET
def health(request):
    """GET /api/health/ — liveness/readiness para balanceadores y probes.

    Sin autenticación. Comprueba servidor + acceso a la base de datos.
    Devuelve 200 si todo OK, 503 si la BD no responde.
    """
    checks = {"server": True, "database": False}
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
        checks["database"] = True
    except Exception:  # noqa: BLE001 — cualquier fallo de BD ⇒ degradado
        pass

    all_ok = all(checks.values())
    return JsonResponse(
        {"status": "ok" if all_ok else "degraded", "checks": checks},
        status=200 if all_ok else 503,
    )
