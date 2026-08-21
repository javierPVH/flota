"""M6 — entrega la cola de correo saliente (`EmailOutbox`).

El motor de alertas solo ENCOLA (ver `services/mailer`), así que este comando es
el que habla con el SMTP. `run_fleet_jobs` ya lo hace al final de cada pasada;
existe suelto para el despliegue bare-metal por crontab y para reintentar a mano
una tanda que se quedó atrás.

    python manage.py send_email_outbox [--limit 50]
"""

from django.core.management.base import BaseCommand

from fleet.services import mailer


class Command(BaseCommand):
    help = "Envía los correos pendientes de la cola (con reintento acotado)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--limit",
            type=int,
            default=None,
            help="Tamaño de la tanda (por defecto, FLEET_EMAIL_OUTBOX_BATCH).",
        )

    def handle(self, *args, **options):
        result = mailer.send_outbox(limit=options["limit"])
        self.stdout.write(
            self.style.SUCCESS(
                f"send_email_outbox: {result['sent']} enviados, "
                f"{result['retry']} a reintentar, {result['failed']} fallidos."
            )
        )
