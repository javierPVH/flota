"""Reintenta archivar los documentos en estado `pendiente_archivar` (HU-4.2).

Pensado para un cron periódico: cuando Drive (o el backend configurado) vuelve a
estar disponible, archiva lo que quedó pendiente. Idempotente. Uso:

    python manage.py archive_pending_documents
"""

from django.core.management.base import BaseCommand

from fleet.services import archiver


class Command(BaseCommand):
    help = "Reintenta el archivado de los documentos pendientes de archivar."

    def handle(self, *args, **options):
        archived = archiver.archive_pending()
        self.stdout.write(self.style.SUCCESS(f"Documentos archivados: {archived}."))
