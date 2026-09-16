"""Backend de correo de Django que envía por la **API de Gmail** (HTTPS).

Por qué existe: en srvgcptd la red de GCP no deja salir a los puertos SMTP
(25/465/587), pero sí al 443. `list` resolvió lo mismo enviando por Gmail API
con el token OAuth de un solo buzón, y este módulo trae ese camino a flota
**sin tocar el mailer**: la cola `EmailOutbox`, `send_notice_now` y el
`send_mail` de prueba siguen construyendo `EmailMultiAlternatives`; solo cambia
`EMAIL_BACKEND` (lo decide `settings` cuando `GMAIL_OAUTH_ENABLED=True`).

Cómo envía: cada `EmailMessage` se serializa con `message()` (el MIME completo
de Django: texto + alternativa HTML + adjuntos), se codifica en base64 URL-safe
y va a `users().messages().send(userId="me")`. `me` es el buzón dueño del token
(`GMAIL_SENDER`), que es también el `From` visible: Gmail sustituye cualquier
otro remitente que no sea un alias verificado de ese buzón.

La conexión (`open`/`close`) es el cliente de la API, construido una vez por
tanda (R3-13: `send_outbox` reutiliza la misma «conexión» para todos los
correos de la pasada). Respeta `fail_silently` como el resto de backends.
"""

import base64
import logging

from django.core.mail.backends.base import BaseEmailBackend

logger = logging.getLogger(__name__)


class GmailApiEmailBackend(BaseEmailBackend):
    """Envía los mensajes por Gmail API como el buzón del token OAuth."""

    def __init__(self, fail_silently=False, **kwargs):
        super().__init__(fail_silently=fail_silently, **kwargs)
        self.service = None

    # ---- ciclo de vida de la «conexión» -----------------------------------

    def open(self):
        """Construye el cliente Gmail (refresca el access token si hace falta).

        Devuelve True si lo abrió esta llamada, False si ya estaba abierto.
        Sin token configurado lanza (o devuelve False con `fail_silently`),
        igual que un SMTP inalcanzable.
        """
        if self.service is not None:
            return False
        from accounts.google_oauth import gmail_service_oauth_user

        try:
            service = gmail_service_oauth_user()
        except Exception:
            if not self.fail_silently:
                raise
            return False
        if service is None:
            if not self.fail_silently:
                raise RuntimeError(
                    "Gmail API no configurada: falta GMAIL_OAUTH_ENABLED o el fichero "
                    "GMAIL_OAUTH_TOKEN_FILE no existe."
                )
            return False
        self.service = service
        return True

    def close(self):
        self.service = None

    # ---- envío --------------------------------------------------------------

    def send_messages(self, email_messages):
        """Envía la tanda y devuelve cuántos salieron.

        Un fallo en un mensaje lanza (o se traga con `fail_silently`) sin
        cortar la tanda: el mailer contabiliza por correo y reintenta desde la
        cola, así que un destinatario rechazado no debe frenar a los demás.
        """
        if not email_messages:
            return 0
        opened_here = self.open()
        if self.service is None:
            return 0
        sent = 0
        try:
            for message in email_messages:
                if self._send(message):
                    sent += 1
        finally:
            if opened_here:
                self.close()
        return sent

    def _send(self, message) -> bool:
        from accounts.google_oauth import GOOGLE_NUM_RETRIES

        if not message.recipients():
            return False
        raw = base64.urlsafe_b64encode(message.message().as_bytes()).decode("ascii")
        try:
            self.service.users().messages().send(userId="me", body={"raw": raw}).execute(
                num_retries=GOOGLE_NUM_RETRIES
            )
        except Exception:
            if not self.fail_silently:
                raise
            logger.exception("gmail api: fallo enviando a %s", message.recipients())
            return False
        return True
