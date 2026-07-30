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
    default_scope = "public_write"

    def allow_request(self, request, view):
        if request.method in SAFE_METHODS:
            return True
        # SEC9: si la vista no declara scope (p. ej. una @action), aplica el
        # de public_write — antes ScopedRateThrottle pasaba sin limitar.
        if not getattr(view, self.scope_attr, None):
            setattr(view, self.scope_attr, self.default_scope)
        return super().allow_request(request, view)
