"""Una sesión por persona (`accounts.sessions`): al entrar se cierran las
demás sesiones del mismo usuario, se entre por donde se entre, y el tope
absoluto de sesión es de 2 h por defecto."""

from django.conf import settings
from django.contrib.auth import get_user_model
from django.test import Client, TestCase
from django.urls import reverse

from accounts.models import UserSession

User = get_user_model()

CREDENCIALES = {"username": "alice", "password": "s3cret-pass"}


class SingleSessionTests(TestCase):
    def setUp(self):
        self.alice = User.objects.create_user(email="alice@example.com", **CREDENCIALES)
        self.bob = User.objects.create_user(
            username="bob", email="bob@example.com", password="s3cret-pass"
        )

    def _login(self, client: Client, **creds) -> None:
        resp = client.post(reverse("login"), creds or CREDENCIALES, content_type="application/json")
        self.assertEqual(resp.status_code, 200, resp.content)

    def test_el_segundo_inicio_cierra_el_primero(self):
        pc1, pc2 = Client(), Client()
        self._login(pc1)
        self.assertEqual(pc1.get(reverse("me")).status_code, 200)
        self._login(pc2)
        # El primer puesto ya no tiene sesión; el segundo sigue dentro.
        self.assertIn(pc1.get(reverse("me")).status_code, (401, 403))
        self.assertEqual(pc2.get(reverse("me")).status_code, 200)
        # Y solo queda apuntada la sesión que entró.
        rows = UserSession.objects.filter(user=self.alice)
        self.assertEqual(rows.count(), 1)
        self.assertEqual(rows.get().session_key, pc2.session.session_key)

    def test_vale_para_cualquier_via_de_entrada(self):
        """Google, SAML y el admin pasan por `auth.login` igual que
        `force_login`: la señal es la misma y el primer puesto se cierra."""
        pc1, pc2 = Client(), Client()
        self._login(pc1)
        pc2.force_login(self.alice)
        self.assertIn(pc1.get(reverse("me")).status_code, (401, 403))
        self.assertEqual(pc2.get(reverse("me")).status_code, 200)

    def test_no_toca_las_sesiones_de_otras_personas(self):
        pc_alice, pc_bob = Client(), Client()
        self._login(pc_bob, username="bob", password="s3cret-pass")
        self._login(pc_alice)
        self.assertEqual(pc_bob.get(reverse("me")).status_code, 200)
        self.assertEqual(UserSession.objects.count(), 2)

    def test_salir_olvida_la_sesion(self):
        pc = Client()
        self._login(pc)
        self.assertEqual(UserSession.objects.filter(user=self.alice).count(), 1)
        resp = pc.post(reverse("logout"))
        self.assertIn(resp.status_code, (200, 204))
        self.assertEqual(UserSession.objects.filter(user=self.alice).count(), 0)

    def test_volver_a_entrar_desde_el_mismo_puesto_no_se_expulsa_a_si_mismo(self):
        pc = Client()
        self._login(pc)
        self._login(pc)
        self.assertEqual(pc.get(reverse("me")).status_code, 200)
        self.assertEqual(UserSession.objects.filter(user=self.alice).count(), 1)

    def test_el_tope_absoluto_por_defecto_es_de_dos_horas(self):
        self.assertEqual(settings.SESSION_ABSOLUTE_AGE, 2 * 60 * 60)
        self.assertEqual(settings.SESSION_COOKIE_AGE, 2 * 60 * 60)
