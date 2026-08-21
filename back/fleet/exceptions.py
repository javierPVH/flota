"""Excepciones de la API de flota que llevan información accionable.

El handler de `core.exceptions` propaga `api_code` y `api_context` al cuerpo de
la respuesta, para que el front pueda ofrecer una acción concreta en vez de un
mensaje sin salida.
"""

from rest_framework import status
from rest_framework.exceptions import APIException

#: Código del conflicto contra un registro DESACTIVADO. El front lo usa para
#: ofrecer la restauración en lugar de repetir un alta que nunca va a pasar.
INACTIVE_CONFLICT_CODE = "inactive_conflict"


class InactiveConflict(APIException):
    """El valor ya lo ocupa un registro desactivado (N7: nada se borra).

    Se responde 409 —no 400— porque el alta no es corregible cambiando el
    formulario: el nombre está libre a la vista del usuario (los listados
    filtran `is_active=True`) y el único camino es restaurar el registro que lo
    ocupa. El `context` lleva lo que hace falta para eso: el tipo de errata y el
    id, que es exactamente lo que pide POST /api/v1/erratas/restore/.
    """

    status_code = status.HTTP_409_CONFLICT
    api_code = INACTIVE_CONFLICT_CODE

    def __init__(self, detail: str, *, kind: str, pk: int, label: str = ""):
        super().__init__(detail)
        self.api_context = {"kind": kind, "id": pk, "label": label}
