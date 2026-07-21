"""Throttles reutilizables de la API."""

from rest_framework.permissions import SAFE_METHODS
from rest_framework.throttling import ScopedRateThrottle


class PublicWriteThrottle(ScopedRateThrottle):
    """Limita solo las **escrituras** (POST/PUT/PATCH/DELETE) al ritmo del scope.

    Pensada para endpoints que el front público (internet) usa para escribir
    —subida de documentos, lecturas de km—: acota el abuso sin penalizar las
    lecturas. El scope se toma de `view.throttle_scope` (por defecto
    `public_write`); las lecturas pasan sin consumir cuota.
    """

    scope_attr = "throttle_scope"

    def allow_request(self, request, view):
        if request.method in SAFE_METHODS:
            return True
        return super().allow_request(request, view)
