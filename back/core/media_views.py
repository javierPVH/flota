"""SEC3 + C3 — servido AUTENTICADO **y AUTORIZADO** de /media.

El front de conductores es público en internet: servir /media por alias de
nginx dejaba fotos de partes, permisos y pólizas al alcance de cualquiera con
la URL (aviso RGPD del README de deploy). Ahora nginx reenvía /media al back,
esta vista exige sesión y devuelve `X-Accel-Redirect` a una location `internal`
(nginx sigue sirviendo el binario; Django solo autoriza).

C3: exigir sesión no basta. Los binarios cuelgan siempre de un `Document`
(único `FileField` del proyecto) y las rutas son adivinables
(`documents/AAAA/MM/<nombre de la cámara>`), así que cualquier usuario
autenticado podía descargar el parte de accidente de otro. Se resuelve el
documento por su ruta y se comprueba contra `vehicles_for(user)`: fuera de
ámbito, 404 (no 403: no se confirma que el fichero exista).

En desarrollo (DEBUG, sin nginx) sirve el fichero directamente, con la MISMA
autorización.
"""

from pathlib import Path
from urllib.parse import quote

from django.conf import settings
from django.http import FileResponse, Http404, HttpResponse
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

# Prefijo de la location `internal` de nginx (ver nginx.conf de los fronts).
INTERNAL_PREFIX = "/_protected_media/"


def _authorize(user, path: str) -> None:
    """Deja pasar solo si `user` puede ver el documento de `path`. Si no, 404.

    El admin ve toda la flota. Para el resto decide `readable_documents`, la
    MISMA regla que el listado de la API: el ámbito del titular —vehículo o
    persona (R3-01: los personales se autorizan con `users_for`, o el 404 se lo
    comía hasta su propio dueño)— y encima la confidencialidad (responsable,
    lectura compartida, protegido). Filtrar solo el listado no habría servido
    de nada: con la URL del fichero en la mano, el binario se seguía bajando.
    Un fichero sin `Document` que lo respalde (huérfano de una subida a medias,
    o algo dejado a mano en MEDIA_ROOT) no se sirve a nadie salvo al admin.

    AUTH-10: un documento DESACTIVADO (N7, está en erratas) tampoco: el
    listado ya lo escondía, pero con la URL del fichero en la mano el binario
    se seguía bajando. Solo la gestión, que es quien lo ve en erratas y decide
    si restaurarlo, sigue pudiendo abrirlo.
    """
    # Imports locales: `core` no debe depender de `fleet` en tiempo de carga.
    from fleet.models import Document
    from fleet.scoping import readable_documents

    if user.is_admin:
        return
    documents = Document.objects.filter(file=path, is_active=True)
    if not readable_documents(user, documents).exists():
        raise Http404


class ProtectedMediaView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, path: str):
        # Nunca escapar del MEDIA_ROOT (por si nginx dejara pasar '..').
        # R4-04: `is_relative_to`, no un startswith de prefijo — con
        # MEDIA_ROOT=/srv/media, la ruta /srv/media-evil pasaba el corte.
        root = Path(settings.MEDIA_ROOT).resolve()
        target = (root / path).resolve()
        if not target.is_relative_to(root):
            raise Http404

        # C3: autorización por ámbito, ANTES de resolver el binario.
        _authorize(request.user, path)

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
