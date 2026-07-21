from django.conf import settings
from django.contrib import admin
from django.urls import include, path

admin.site.site_header = "Administración — Flota"
admin.site.site_title = "Flota Admin"
admin.site.index_title = "Operación y soporte"

urlpatterns = [
    path("admin/", admin.site.urls),
    # Infra (sin versión): sondas de salud para orquestador/balanceador.
    path("api/", include("core.urls")),  # /api/health/, /api/ready/
    # API de negocio versionada: evolucionar sin romper clientes (futuro /api/v2/).
    path("api/v1/auth/", include("accounts.urls")),  # /api/v1/auth/{csrf,login,me,…}/
    path("api/v1/", include("fleet.urls")),  # /api/v1/vehicles/, …
]

# Documentación OpenAPI SOLO en dev/staging (nunca superficie extra en prod).
if getattr(settings, "OPENAPI_DOCS_ENABLED", False):
    from drf_spectacular.views import (
        SpectacularAPIView,
        SpectacularRedocView,
        SpectacularSwaggerView,
    )

    urlpatterns += [
        path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
        path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
        path("api/redoc/", SpectacularRedocView.as_view(url_name="schema"), name="redoc"),
    ]
