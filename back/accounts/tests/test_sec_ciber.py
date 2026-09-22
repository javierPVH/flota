"""Auditoría de ciberseguridad (2026-09): INP-5 y AUTH-6 (accounts)."""

from unittest.mock import MagicMock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import RequestFactory, TestCase, override_settings
from django.urls import resolve, reverse

from accounts import ratelimit
from accounts.google_oauth import list_folder_files, validate_drive_id

User = get_user_model()


class Inp5DriveFolderIdTests(TestCase):
    """INP-5: el `folder_id` se valida antes de interpolarlo en la query de Drive."""

    def _service(self):
        service = MagicMock()
        service.files.return_value.list.return_value.execute.return_value = {"files": []}
        return service

    def test_inp5_id_valido_llega_a_la_query(self):
        service = self._service()
        list_folder_files(None, "1AbC_d-9", service=service)
        query = service.files.return_value.list.call_args.kwargs["q"]
        self.assertTrue(query.startswith("'1AbC_d-9' in parents"))

    def test_inp5_id_con_operadores_lanza_y_no_consulta(self):
        service = self._service()
        for malo in (
            "x' or name contains 'a",
            "abc\\'def",
            "abc def",
            "a/b",
            "'",
            "id and trashed = true",
        ):
            with self.assertRaises(ValueError, msg=malo):
                list_folder_files(None, malo, service=service)
        service.files.return_value.list.assert_not_called()

    def test_inp5_validate_drive_id(self):
        self.assertEqual(validate_drive_id("abc-123_XYZ"), "abc-123_XYZ")
        for malo in ("", None, "a b", "a'b", "a;b", "ü"):
            with self.assertRaises(ValueError, msg=repr(malo)):
                validate_drive_id(malo)

    def test_inp5_sin_id_devuelve_vacio_sin_lanzar(self):
        self.assertEqual(list_folder_files(None, "", service=self._service()), [])
        self.assertEqual(list_folder_files(None, None, service=self._service()), [])


class Auth6LoginScopeTests(TestCase):
    """AUTH-6: la puerta se decide por la URL resuelta, no por el cliente."""

    def test_auth6_peticion_sin_resolver_es_api(self):
        req = RequestFactory().post("/api/v1/auth/login/")
        self.assertEqual(ratelimit.login_scope(req), ratelimit.SCOPE_API)

    def test_auth6_admin_login_es_admin(self):
        path = reverse("admin:login")
        req = RequestFactory().post(path)
        req.resolver_match = resolve(path)
        self.assertEqual(ratelimit.login_scope(req), ratelimit.SCOPE_ADMIN)

    def test_auth6_login_api_resuelto_es_api(self):
        path = reverse("login")
        req = RequestFactory().post(path)
        req.resolver_match = resolve(path)
        self.assertEqual(ratelimit.login_scope(req), ratelimit.SCOPE_API)

    def test_auth6_claves_de_cuenta_distintas_por_puerta(self):
        api = RequestFactory().post(reverse("login"))
        api.resolver_match = resolve(reverse("login"))
        admin = RequestFactory().post(reverse("admin:login"))
        admin.resolver_match = resolve(reverse("admin:login"))
        self.assertNotEqual(
            ratelimit._account_key("block", api, "root"),
            ratelimit._account_key("block", admin, "root"),
        )
        # La de IP + cuenta sigue siendo la misma.
        self.assertEqual(
            ratelimit._ip_key("block", api, "root"), ratelimit._ip_key("block", admin, "root")
        )


@override_settings(
    LOGIN_RATE_LIMIT_ATTEMPTS=3,
    LOGIN_RATE_LIMIT_ACCOUNT_ATTEMPTS=5,
    LOGIN_RATE_LIMIT_WINDOW_SECONDS=900,
    LOGIN_RATE_LIMIT_BLOCK_SECONDS=300,
    TRUSTED_PROXY_COUNT=1,
)
class Auth6AccountBlockPerDoorTests(TestCase):
    """AUTH-6: fallar contra una cuenta desde la web pública no cierra el admin."""

    PASSWORD = "right-pass-123"

    def setUp(self):
        cache.clear()
        User.objects.create_superuser(
            username="root", email="root@example.com", password=self.PASSWORD
        )
        self.api_url = reverse("login")
        self.admin_url = reverse("admin:login")

    def _api(self, password, ip):
        return self.client.post(
            self.api_url,
            {"username": "root", "password": password},
            content_type="application/json",
            HTTP_X_FORWARDED_FOR=ip,
        )

    def _admin(self, password, ip):
        return self.client.post(
            self.admin_url,
            {"username": "root", "password": password, "next": "/admin/"},
            HTTP_X_FORWARDED_FOR=ip,
        )

    def test_auth6_bloqueo_de_cuenta_en_la_api_no_cierra_el_admin(self):
        # Cinco fallos repartidos en IPs distintas (cada una bajo el umbral de
        # 3): la cuenta queda bloqueada en la API…
        for i in range(5):
            self.assertEqual(self._api("wrong", f"8.8.8.{i}").status_code, 401)
        self.assertEqual(self._api(self.PASSWORD, "8.8.9.1").status_code, 429)
        # …pero el administrador entra en el /admin/ desde otra IP.
        resp = self._admin(self.PASSWORD, "10.0.0.7")
        self.assertEqual(resp.status_code, 302)
        self.assertIn("_auth_user_id", self.client.session)

    def test_auth6_bloqueo_de_cuenta_en_el_admin_no_cierra_la_api(self):
        for i in range(5):
            resp = self._admin("wrong", f"10.0.1.{i}")
            self.assertEqual(resp.status_code, 200)
        bloqueado = self._admin(self.PASSWORD, "10.0.2.1")
        self.assertContains(bloqueado, "Demasiados intentos")
        self.assertNotIn("_auth_user_id", self.client.session)
        self.assertEqual(self._api(self.PASSWORD, "8.8.9.2").status_code, 200)

    def test_auth6_misma_ip_sigue_bloqueando_en_las_dos_puertas(self):
        # El contador por IP + cuenta es común: tres fallos desde la misma IP
        # en el admin bloquean esa IP también en la API (comportamiento R6-04).
        for _ in range(3):
            self._admin("wrong", "9.9.9.9")
        self.assertEqual(self._api(self.PASSWORD, "9.9.9.9").status_code, 429)
        self.assertEqual(self._api(self.PASSWORD, "9.9.9.10").status_code, 200)

    def test_auth6_acertar_en_una_puerta_limpia_solo_esa_puerta(self):
        for i in range(5):
            self._api("wrong", f"8.8.8.{i}")
        # Entrar bien en el admin no desbloquea la API.
        self.assertEqual(self._admin(self.PASSWORD, "10.0.0.7").status_code, 302)
        self.client.logout()
        self.assertEqual(self._api(self.PASSWORD, "8.8.9.1").status_code, 429)
