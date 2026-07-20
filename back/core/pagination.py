"""Paginación estándar del proyecto.

`StandardResultsPagination` extiende la paginación numérica de DRF para que el
cliente pueda pedir páginas mayores con `?page_size=N` (con un tope), útil cuando
el front itera hasta agotar páginas (`fetchAllPages`). `PAGE_SIZE` global sigue
definido en `REST_FRAMEWORK`.
"""
from rest_framework.pagination import PageNumberPagination


class StandardResultsPagination(PageNumberPagination):
    page_size_query_param = "page_size"
    max_page_size = 1000
