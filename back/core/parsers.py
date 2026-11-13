"""Parsers de la API."""

from rest_framework.exceptions import ParseError
from rest_framework.parsers import JSONParser


class ObjectJSONParser(JSONParser):
    """JSON cuyo cuerpo es un OBJETO.

    Ningún endpoint acepta una lista o un escalar en la raíz, y las vistas leen
    el cuerpo con `request.data.get(...)`: un `[]` o un `7` reventaban con
    `AttributeError` —un 500 con su traza, también sin autenticar (login,
    Google, dev-login)—. Aquí se corta una sola vez, con un 400.
    """

    def parse(self, stream, media_type=None, parser_context=None):
        data = super().parse(stream, media_type=media_type, parser_context=parser_context)
        if not isinstance(data, dict):
            raise ParseError("El cuerpo de la petición debe ser un objeto JSON.")
        return data
