"""SSO por SAML de la PWA de conductores (`accounts.saml`).

No se monta un IdP: la firma la valida `djangosaml2` y no es lo que se prueba
aquí. Lo que se prueba es la regla de negocio del acceso, que es nuestra:

- entra SOLO quien ya existe en `User` con ese correo (insensible a
  mayúsculas), del dominio permitido y activo; se le marca `last_google_login`;
- un correo desconocido, de otro dominio o de baja NO entra, no se crea nada y
  el ACS devuelve al login de la PWA con el motivo en `?saml=`;
- la cookie de djangosaml2 sale `Secure` aunque la de sesión no lo sea;
- el endpoint de configuración que la PWA consulta.
"""

from types import SimpleNamespace

from django.contrib.auth import get_user_model
from django.http import HttpResponse
from django.test import RequestFactory, TestCase, override_settings
from django.urls import reverse

from accounts.saml import (
    DENIED_DOMAIN,
    DENIED_ERROR,
    DENIED_INACTIVE,
    DENIED_NO_USER,
    FleetAcsView,
    FleetSaml2Backend,
    SecureSamlSessionMiddleware,
    email_from_assertion,
)

User = get_user_model()


def _session_info(name_id="Alice@Example.com", **attributes):
    return {
        "issuer": "https://accounts.google.com/o/saml2?idpid=x",
        "name_id": SimpleNamespace(text=name_id),
        "ava": attributes,
    }


class EmailFromAssertionTests(TestCase):
    def test_prefiere_el_name_id_y_lo_normaliza(self):
        info = _session_info(" Alice@Example.com ", email=["otra@gransolar.com"])
        self.assertEqual(email_from_assertion(info, info["ava"]), "alice@example.com")

    def test_sin_name_id_valido_cae_al_atributo_de_correo(self):
        info = _session_info("opaco-123", **{"Correo electrónico principal": ["Bob@Gransolar.com"]})
        self.assertEqual(email_from_assertion(info, info["ava"]), "bob@gransolar.com")

    def test_sin_nada_devuelve_vacio(self):
        info = _session_info("")
        self.assertEqual(email_from_assertion(info, info["ava"]), "")


@override_settings(SAML_ALLOWED_DOMAINS=["example.com"])
class FleetSaml2BackendTests(TestCase):
    def setUp(self):
        self.backend = FleetSaml2Backend()
        self.request = RequestFactory().post("/api/v1/auth/saml/acs/")
        self.alice = User.objects.create_user(
            username="alice", email="alice@example.com", password="x"
        )

    def _auth(self, name_id="alice@example.com", **attrs):
        return self.backend.authenticate(
            self.request,
            session_info=_session_info(name_id, **attrs),
            attribute_mapping={},
            create_unknown_user=True,  # se ignora a propósito: nunca se crea
            assertion_info={},
        )

    def test_entra_el_usuario_existente_por_correo_sin_distinguir_mayusculas(self):
        self.assertEqual(self._auth("ALICE@example.com"), self.alice)
        self.assertEqual(User.objects.count(), 1)

    def test_correo_desconocido_no_entra_ni_se_crea_y_deja_el_motivo(self):
        self.assertIsNone(self._auth("nadie@example.com"))
        self.assertEqual(User.objects.count(), 1)
        self.assertEqual(self.request.saml_denied, DENIED_NO_USER)

    def test_usuario_de_baja_no_entra_y_deja_el_motivo(self):
        self.alice.is_active = False
        self.alice.save(update_fields=["is_active"])
        self.assertIsNone(self._auth())
        self.assertEqual(self.request.saml_denied, DENIED_INACTIVE)

    def test_otro_dominio_no_entra_aunque_el_usuario_exista(self):
        User.objects.create_user(username="ext", email="ext@gmail.com", password="x")
        self.assertIsNone(self._auth("ext@gmail.com"))
        self.assertEqual(self.request.saml_denied, DENIED_DOMAIN)

    def test_el_dominio_se_comprueba_sobre_el_mismo_correo_que_se_busca(self):
        # Name ID de fuera con un atributo `email` del dominio bueno: manda el
        # Name ID (es lo que se busca), así que se rechaza por dominio.
        self.assertIsNone(self._auth("ext@gmail.com", email=["alice@example.com"]))
        self.assertEqual(self.request.saml_denied, DENIED_DOMAIN)

    @override_settings(SAML_ALLOWED_DOMAINS=[])
    def test_sin_dominios_configurados_no_filtra(self):
        User.objects.create_user(username="ext", email="ext@gmail.com", password="x")
        self.assertIsNotNone(self._auth("ext@gmail.com"))

    def test_no_toca_los_datos_del_usuario(self):
        self.alice.first_name = "Alicia"
        self.alice.save(update_fields=["first_name"])
        self._auth(first_name=["Otra"], last_name=["Cosa"])
        self.alice.refresh_from_db()
        self.assertEqual(self.alice.first_name, "Alicia")


class FleetAcsViewTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()

    def test_rechazo_redirige_al_login_de_la_pwa_con_el_motivo(self):
        request = self.factory.post("/api/v1/auth/saml/acs/")
        request.saml_denied = DENIED_NO_USER
        resp = FleetAcsView().handle_acs_failure(request, exception=PermissionError("x"))
        self.assertEqual(resp.status_code, 302)
        self.assertEqual(resp["Location"], "/login?saml=no_user")

    def test_fallo_de_asercion_sin_motivo_es_error(self):
        request = self.factory.post("/api/v1/auth/saml/acs/")
        resp = FleetAcsView().handle_acs_failure(request, exception=ValueError("firma"))
        self.assertEqual(resp["Location"], f"/login?saml={DENIED_ERROR}")

    def test_post_login_marca_la_entrada_por_google(self):
        user = User.objects.create_user(username="carol", email="carol@example.com", password="x")
        self.assertIsNone(user.last_google_login)
        FleetAcsView().post_login_hook(self.factory.get("/"), user, _session_info())
        user.refresh_from_db()
        self.assertIsNotNone(user.last_google_login)


@override_settings(SESSION_COOKIE_SECURE=False)
class SecureSamlSessionMiddlewareTests(TestCase):
    def test_la_cookie_saml_sale_secure_aunque_la_de_sesion_no(self):
        request = RequestFactory().get("/api/v1/auth/saml/login/")
        middleware = SecureSamlSessionMiddleware(lambda req: HttpResponse("ok"))
        middleware.process_request(request)
        request.saml_session["outstanding"] = {"id": "/"}  # como hace LoginView
        response = middleware.process_response(request, HttpResponse("ok"))
        cookie = response.cookies[middleware.cookie_name]
        self.assertTrue(cookie["secure"])
        self.assertEqual(cookie["samesite"], "None")


class AuthConfigSamlTests(TestCase):
    @override_settings(SAML_ENABLED=True)
    def test_config_anuncia_el_sso_y_su_url(self):
        data = self.client.get(reverse("auth-config")).json()
        self.assertTrue(data["saml_enabled"])
        self.assertEqual(data["saml_login_url"], "/api/v1/auth/saml/login/")

    @override_settings(SAML_ENABLED=False)
    def test_config_sin_sso(self):
        data = self.client.get(reverse("auth-config")).json()
        self.assertFalse(data["saml_enabled"])
        self.assertEqual(data["saml_login_url"], "")
