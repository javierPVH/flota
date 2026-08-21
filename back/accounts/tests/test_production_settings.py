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
