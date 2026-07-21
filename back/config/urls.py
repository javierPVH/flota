from django.conf import settings
from django.contrib import admin
from django.urls import include, path

admin.site.site_header = "Administración — Flota"
admin.site.site_title = "Flota Admin"
admin.site.index_title = "Operación y soporte"

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("core.urls")),  # /api/health/
    path("api/auth/", include("accounts.urls")),  # /api/auth/{csrf,login,logout,me}/
    path("api/", include("fleet.urls")),  # /api/vehicles/
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
