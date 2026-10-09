"""URLconf de pruebas: las rutas de siempre MÁS el panel de administración.

`config.urls` monta `/admin/` solo con `DJANGO_ADMIN_ENABLED`, que va apagado
(ver `config/settings.py`). Los tests del anti fuerza bruta de ESA puerta
—R6-04 y AUTH-6— necesitan que exista, y la encienden con `con_admin`.

Vive aparte del decorador a propósito: `admin.site.urls` se resuelve al
importar este módulo, y Django solo lo importa al resolver la primera URL, o
sea ya dentro del test y con la app instalada. Importarlo antes dejaría el
registro del admin vacío.
"""

from django.contrib import admin
from django.urls import path

from config.urls import urlpatterns as _base

urlpatterns = [
    path("admin/", admin.site.urls),
    # Si el flag estuviera encendido en el entorno, `config.urls` ya lo trae:
    # se descarta el suyo para no montar la misma puerta dos veces.
    *[ruta for ruta in _base if getattr(ruta, "app_name", None) != "admin"],
]
