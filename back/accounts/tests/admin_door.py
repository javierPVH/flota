"""Encender el panel de administración para un test.

El panel va apagado por defecto (`DJANGO_ADMIN_ENABLED`, ver
`config/settings.py`): ni la app está instalada ni `/admin/` existe. Pero el
anti fuerza bruta de esa puerta (R6-04) y el reparto de contadores por puerta
(AUTH-6) siguen siendo contrato: se prueban encendiéndolo aquí, que es lo que
pasa de verdad cuando alguien pone la variable para conceder un superusuario.

Hacen falta las dos capas y en este orden:

- la **app**, o `admin.site` no tiene plantillas que renderizar ni se
  autodescubre `accounts/admin.py` —que es quien pone el formulario de entrada
  con límite de intentos—;
- la **URL**, que es lo que `reverse("admin:login")` busca y lo que le da a la
  petición el `app_name` con el que `ratelimit.login_scope` decide la puerta.
"""

from django.test import modify_settings, override_settings


def con_admin(cls):
    """Decorador de clase: monta el panel de administración durante el test."""
    cls = override_settings(
        DJANGO_ADMIN_ENABLED=True,
        ROOT_URLCONF="accounts.tests.admin_urls",
    )(cls)
    # Va por fuera para que la app esté instalada ANTES de que se resuelva la
    # primera URL, que es cuando se importa el URLconf de arriba.
    return modify_settings(INSTALLED_APPS={"append": "django.contrib.admin"})(cls)
