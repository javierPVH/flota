"""N10b: backend de correo por Gmail API (`fleet.mail_backends`).

No toca la red: el cliente de Gmail se sustituye por un doble que guarda lo
que se le manda. Se comprueba lo que importa del contrato de Django:
serialización MIME completa (HTML + adjunto), `userId='me'`, una conexión por
tanda, `fail_silently` y el fallo limpio sin token.
"""

import base64
from email import message_from_bytes
from unittest import mock

from django.core.mail import EmailMultiAlternatives, get_connection
from django.test import SimpleTestCase, override_settings

from fleet.mail_backends import GmailApiEmailBackend

BACKEND = "fleet.mail_backends.GmailApiEmailBackend"


class _FakeSend:
    def __init__(self, sink, fail=False):
        self.sink, self.fail = sink, fail

    def execute(self, num_retries=0):
        if self.fail:
            raise RuntimeError("quota")
        return {"id": str(len(self.sink))}


class _FakeService:
    """Imita `service.users().messages().send(userId=..., body=...)`."""

    def __init__(self, fail=False):
        self.sent = []
        self.fail = fail

    def users(self):
        return self

    def messages(self):
        return self

    def send(self, userId, body):  # noqa: N803 — firma de googleapiclient
        self.sent.append((userId, body))
        return _FakeSend(self.sent, fail=self.fail)


def _mensaje(to="destino@example.com"):
    msg = EmailMultiAlternatives(
        subject="Seguro próximo a vencer",
        body="Texto plano",
        from_email="flota@example.com",
        to=[to],
    )
    msg.attach_alternative("<p>Texto <b>HTML</b></p>", "text/html")
    msg.attach("informe.csv", b"a;b\n1;2\n", "text/csv")
    return msg


@override_settings(EMAIL_BACKEND=BACKEND)
class GmailApiEmailBackendTests(SimpleTestCase):
    def test_envia_mime_completo_como_me(self):
        fake = _FakeService()
        with mock.patch("accounts.google_oauth.gmail_service_oauth_user", return_value=fake):
            enviados = _mensaje().send()
        self.assertEqual(enviados, 1)
        self.assertEqual(len(fake.sent), 1)
        user_id, body = fake.sent[0]
        self.assertEqual(user_id, "me")
        parsed = message_from_bytes(base64.urlsafe_b64decode(body["raw"]))
        self.assertEqual(parsed["To"], "destino@example.com")
        self.assertIn("Seguro", str(parsed["Subject"]))
        tipos = [p.get_content_type() for p in parsed.walk()]
        self.assertIn("text/plain", tipos)
        self.assertIn("text/html", tipos)
        self.assertIn("text/csv", tipos)

    def test_una_conexion_por_tanda_y_cuenta_enviados(self):
        fake = _FakeService()
        with mock.patch(
            "accounts.google_oauth.gmail_service_oauth_user", return_value=fake
        ) as factory:
            conn = get_connection()
            self.assertIsInstance(conn, GmailApiEmailBackend)
            n = conn.send_messages([_mensaje("a@example.com"), _mensaje("b@example.com")])
            conn.close()
        self.assertEqual(n, 2)
        self.assertEqual(factory.call_count, 1)
        self.assertIsNone(conn.service)

    def test_sin_token_lanza_o_calla_segun_fail_silently(self):
        with mock.patch("accounts.google_oauth.gmail_service_oauth_user", return_value=None):
            with self.assertRaises(RuntimeError):
                _mensaje().send()
            self.assertEqual(_mensaje().send(fail_silently=True), 0)

    def test_fallo_de_la_api_lanza_o_calla(self):
        fake = _FakeService(fail=True)
        with mock.patch("accounts.google_oauth.gmail_service_oauth_user", return_value=fake):
            with self.assertRaises(RuntimeError):
                _mensaje().send()
            self.assertEqual(_mensaje().send(fail_silently=True), 0)

    def test_sin_destinatarios_no_llama_a_la_api(self):
        fake = _FakeService()
        with mock.patch("accounts.google_oauth.gmail_service_oauth_user", return_value=fake):
            msg = EmailMultiAlternatives(subject="x", body="y", from_email="f@example.com", to=[])
            self.assertEqual(msg.send(), 0)
        self.assertEqual(fake.sent, [])
