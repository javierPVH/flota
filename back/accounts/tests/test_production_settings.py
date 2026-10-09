"""Test del hardening de producción (Fase S2).

Carga `config.settings` en un subproceso con `DEBUG=False` y comprueba que los
valores de seguridad por defecto son estrictos, sin contaminar el proceso de
tests (que corre con DEBUG=True).
"""

import json
import os
import subprocess
import sys

from django.conf import settings
from django.test import SimpleTestCase

from accounts.tests.admin_door import con_admin

_SNIPPET = (
    "import json, django; django.setup();"
    "from django.conf import settings as s;"
    "print(json.dumps({"
    "'ssl_redirect': s.SECURE_SSL_REDIRECT,"
    "'hsts': s.SECURE_HSTS_SECONDS,"
    "'session_secure': s.SESSION_COOKIE_SECURE,"
    "'csrf_secure': s.CSRF_COOKIE_SECURE,"
    "'nosniff': s.SECURE_CONTENT_TYPE_NOSNIFF,"
    "'referrer': s.SECURE_REFERRER_POLICY,"
    "'xframe': s.X_FRAME_OPTIONS,"
    "'proxy_header': s.SECURE_PROXY_SSL_HEADER,"
    "'xff_host': s.USE_X_FORWARDED_HOST,"
    "}))"
)


def _load_settings(**overrides) -> dict:
    env = {
        **os.environ,
        "DEBUG": "False",
        "SECRET_KEY": "x" * 60,
        "ALLOWED_HOSTS": "flota.example.com",
        "DJANGO_SETTINGS_MODULE": "config.settings",
        **overrides,
    }
    out = subprocess.check_output(
        [sys.executable, "-c", _SNIPPET], env=env, cwd=settings.BASE_DIR, text=True
    )
    return json.loads(out)


class ProductionHardeningTests(SimpleTestCase):
    def test_production_defaults_are_strict(self):
        data = _load_settings()
        self.assertTrue(data["ssl_redirect"])
        self.assertGreaterEqual(data["hsts"], 31_536_000)
        self.assertTrue(data["session_secure"])
        self.assertTrue(data["csrf_secure"])
        self.assertTrue(data["nosniff"])
        self.assertEqual(data["referrer"], "same-origin")
        self.assertEqual(data["xframe"], "DENY")

    def test_proxy_headers_off_by_default(self):
        data = _load_settings()
        # Sin SECURE_BEHIND_PROXY no se confía en cabeceras de proxy (falsificables).
        self.assertIsNone(data["proxy_header"])
        self.assertFalse(data["xff_host"])

    def test_proxy_headers_on_when_behind_proxy(self):
        data = _load_settings(SECURE_BEHIND_PROXY="True")
        self.assertIsNotNone(data["proxy_header"])
        self.assertTrue(data["xff_host"])


class GoogleAutoCreateGuardTests(SimpleTestCase):
    """C4: en producción, auto-alta por Google exige lista de dominios.

    Con `GOOGLE_AUTO_CREATE_USERS=True` y `GOOGLE_ALLOWED_DOMAINS` vacío,
    cualquier cuenta de Google se autoprovisiona un usuario y pasa a estar
    autenticada (y lo autenticado alcanza /media). El arranque debe fallar.
    """

    ENV = {
        "AUTH_GOOGLE_ENABLED": "True",
        "GOOGLE_OAUTH_CLIENT_ID": "client-id.apps.googleusercontent.com",
        "GOOGLE_AUTO_CREATE_USERS": "True",
    }

    def test_autocreate_without_domains_aborts(self):
        with self.assertRaises(subprocess.CalledProcessError):
            _load_settings(**self.ENV, GOOGLE_ALLOWED_DOMAINS="")

    def test_autocreate_with_domains_is_allowed(self):
        data = _load_settings(**self.ENV, GOOGLE_ALLOWED_DOMAINS="gransolar.com")
        self.assertTrue(data["session_secure"])


class AdminPanelDisabledTests(SimpleTestCase):
    """El panel de administracion de Django va APAGADO salvo que se pida.

    Es una puerta de login mas, y la operacion del dia a dia se hace desde
    gestion. Apagado no basta con que no se vea: la app no se instala, asi que
    no hay plantillas, ni estaticos que recoger, ni autodescubrimiento de los
    `admin.py` — y la URL devuelve 404, no un formulario donde probar claves.
    """

    def test_la_app_no_esta_instalada_por_defecto(self):
        self.assertFalse(settings.DJANGO_ADMIN_ENABLED)
        self.assertNotIn("django.contrib.admin", settings.INSTALLED_APPS)

    def test_la_ruta_no_existe_por_defecto(self):
        # 404 y no 302 a un login: la puerta no esta ahi.
        self.assertEqual(self.client.get("/admin/").status_code, 404)
        self.assertEqual(self.client.get("/admin/login/").status_code, 404)


@con_admin
class AdminPanelEnabledTests(SimpleTestCase):
    """Y encendido vuelve entero: es lo que hace falta para dar superusuario."""

    def test_con_el_flag_la_puerta_existe_y_pide_credenciales(self):
        self.assertIn("django.contrib.admin", settings.INSTALLED_APPS)
        resp = self.client.get("/admin/login/")
        self.assertEqual(resp.status_code, 200)
