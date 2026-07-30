"""SEC3 — servido AUTENTICADO de /media (documentos con datos personales).

El front de conductores es público en internet: servir /media por alias de
nginx dejaba fotos de partes, permisos y pólizas al alcance de cualquiera con
la URL (aviso RGPD del README de deploy). Ahora nginx reenvía /media al back,
esta vista exige sesión y devuelve `X-Accel-Redirect` a una location `internal`
(nginx sigue sirviendo el binario; Django solo autoriza).

En desarrollo (DEBUG, sin nginx) sirve el fichero directamente.
"""

from pathlib import Path
from urllib.parse import quote

from django.conf import settings
from django.http import FileResponse, Http404, HttpResponse
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

# Prefijo de la location `internal` de nginx (ver nginx.conf de los fronts).
INTERNAL_PREFIX = "/_protected_media/"


class ProtectedMediaView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, path: str):
        # Nunca escapar del MEDIA_ROOT (por si nginx dejara pasar '..').
        root = Path(settings.MEDIA_ROOT).resolve()
        target = (root / path).resolve()
        if not str(target).startswith(str(root)):
            raise Http404

        if settings.DEBUG:
            if not target.is_file():
                raise Http404
            return FileResponse(open(target, "rb"))

        response = HttpResponse()
        # nginx decide el Content-Type por extensión; sin esto, Django lo
        # fijaría a text/html para todo.
        del response["Content-Type"]
        response["X-Accel-Redirect"] = INTERNAL_PREFIX + quote(path)
        return response
