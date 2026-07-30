from django.conf import settings
from django.contrib import admin
from django.urls import include, path, re_path

from core.media_views import ProtectedMediaView

admin.site.site_header = "Administración — Flota"
admin.site.site_title = "Flota Admin"
admin.site.index_title = "Operación y soporte"

urlpatterns = [
    path("admin/", admin.site.urls),
    # Infra (sin versión): sondas de salud para orquestador/balanceador.
    path("api/", include("core.urls")),  # /api/health/, /api/ready/
    # API de negocio versionada: evolucionar sin romper clientes (futuro /api/v2/).
    path("api/v1/auth/", include("accounts.urls")),  # /api/v1/auth/{csrf,login,me,…}/
    # Google Drive/Picker (Fase A3): OAuth de usuario + config del Picker.
    path("api/v1/google/", include("accounts.google_urls")),
    # Notificaciones push del móvil (M8, Web Push/VAPID).
    path("api/v1/push/", include("accounts.push_urls")),
    path("api/v1/", include("fleet.urls")),  # /api/v1/vehicles/, …
    # SEC3: /media exige sesión — nginx lo reenvía aquí y sirve el binario por
    # X-Accel-Redirect (location internal). En dev lo sirve la propia vista.
    re_path(r"^media/(?P<path>.+)$", ProtectedMediaView.as_view(), name="protected-media"),
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

# Media (documentos subidos) SOLO en dev; en producción los sirve el proxy.
if settings.DEBUG:
    from django.conf.urls.static import static

    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
