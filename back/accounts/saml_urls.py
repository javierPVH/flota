"""Rutas del SSO SAML (solo se montan con `SAML_ENABLED=True`, ver config/urls.py).

Montadas bajo `/api/v1/auth/saml/`:
- `login/`    → redirige al IdP (Google). La PWA navega aquí con `?next=/`.
- `acs/`      → donde Google devuelve la aserción (POST). Es la ACS URL de la
                consola de Google.
- `metadata/` → metadatos del SP. Su URL pública es el Entity ID del SP.

Sin `logout/` ni `ls/`: las apps SAML personalizadas de Google no soportan el
cierre de sesión único; salir de la app cierra solo la sesión de la app
(`/api/v1/auth/logout/`).
"""

from django.urls import path
from djangosaml2.views import LoginView, MetadataView

from .saml import FleetAcsView

urlpatterns = [
    path("login/", LoginView.as_view(), name="saml2_login"),
    path("acs/", FleetAcsView.as_view(), name="saml2_acs"),
    path("metadata/", MetadataView.as_view(), name="saml2_metadata"),
]
