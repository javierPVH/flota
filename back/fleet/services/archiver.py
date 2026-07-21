"""Archivado de documentos (HU-4.2, Épica 9) con *fallback* y reintento.

El archivado real en Google Drive necesita credenciales que no siempre están
disponibles, así que se abstrae detrás de una interfaz `BaseArchiver` con varios
backends intercambiables (`FLEET_ARCHIVE_BACKEND`):

- **`none`** (`NullArchiver`): no archiva; el documento queda `pendiente_archivar`
  y espera al reintento (`archive_pending_documents`).
- **`local`** (`LocalArchiver`): *fallback* sin dependencias externas; crea una
  carpeta por vehículo en el disco y registra una URL `file://`. Útil en dev/CI.
- **`gdrive`** (`GoogleDriveArchiver`): stub documentado; se activa cuando haya
  credenciales de Drive. Mientras no las haya, se comporta como `none`.

Flujo (ver `archive_document`): si el documento ya trae `drive_url` (el front
subió a un destino externo), se marca `vigente`; si no, se delega en el backend;
si el backend no puede archivar, queda `pendiente_archivar` para reintentar.
"""

from __future__ import annotations

import logging
from pathlib import Path

from django.conf import settings

from fleet.models import Document
from fleet.models.enums import DocumentStatus

logger = logging.getLogger("fleet.archiver")


class BaseArchiver:
    """Contrato de un archivador de documentos."""

    def ensure_folder(self, vehicle) -> str:
        """Devuelve (creando si hace falta) la URL de la carpeta del vehículo."""
        return vehicle.drive_folder_url

    def archive(self, document: Document) -> str | None:
        """Archiva el documento y devuelve su URL, o None si no pudo archivar."""
        raise NotImplementedError


class NullArchiver(BaseArchiver):
    """No archiva: deja el documento pendiente para un reintento posterior."""

    def archive(self, document: Document) -> str | None:
        return None


class LocalArchiver(BaseArchiver):
    """Fallback local: 'archiva' creando una carpeta por vehículo en disco."""

    def __init__(self, base_dir: str | Path):
        self.base_dir = Path(base_dir)

    def ensure_folder(self, vehicle) -> str:
        folder = self.base_dir / vehicle.plate
        folder.mkdir(parents=True, exist_ok=True)
        url = folder.resolve().as_uri()
        if vehicle.drive_folder_url != url:
            vehicle.drive_folder_url = url
            vehicle.save(update_fields=["drive_folder_url", "updated_at"])
        return url

    def archive(self, document: Document) -> str | None:
        folder = self.ensure_folder(document.vehicle)
        return f"{folder}/doc-{document.pk}-{document.type}"


class GoogleDriveArchiver(BaseArchiver):
    """Stub de Google Drive (Épica 9).

    Cuando existan credenciales (`GOOGLE_DRIVE_*`), aquí se crearía la carpeta del
    vehículo y se subiría el fichero devolviendo su URL. Sin credenciales, se
    comporta como `NullArchiver` (deja el documento pendiente) para no romper el
    alta. Ver la nota de autorización de conectores en el README.
    """

    def archive(self, document: Document) -> str | None:
        if not getattr(settings, "GOOGLE_DRIVE_ENABLED", False):
            logger.info("Drive no configurado: documento %s pendiente de archivar.", document.pk)
            return None
        raise NotImplementedError(
            "Integración real con Google Drive pendiente de credenciales (Épica 9)."
        )


def get_archiver() -> BaseArchiver:
    """Devuelve el archivador según `FLEET_ARCHIVE_BACKEND`."""
    backend = getattr(settings, "FLEET_ARCHIVE_BACKEND", "none")
    if backend == "local":
        return LocalArchiver(settings.FLEET_ARCHIVE_LOCAL_DIR)
    if backend == "gdrive":
        return GoogleDriveArchiver()
    return NullArchiver()


def archive_document(document: Document, *, archiver: BaseArchiver | None = None) -> Document:
    """Archiva un documento y actualiza su `drive_url`/`status`.

    Defensivo: un fallo de archivado nunca tumba la operación de negocio; el
    documento queda `pendiente_archivar` para el reintento.
    """
    archiver = archiver or get_archiver()
    if document.drive_url:
        # El front ya lo subió a un destino externo: solo aseguramos estado.
        if document.status == DocumentStatus.PENDING_ARCHIVE:
            document.status = DocumentStatus.VALID
            document.save(update_fields=["status", "updated_at"])
        return document
    try:
        url = archiver.archive(document)
    except Exception:  # pragma: no cover - robustez ante errores del backend
        logger.exception("Fallo al archivar el documento %s", document.pk)
        url = None
    if url:
        document.drive_url = url
        document.status = DocumentStatus.VALID
        document.save(update_fields=["drive_url", "status", "updated_at"])
    else:
        if document.status != DocumentStatus.PENDING_ARCHIVE:
            document.status = DocumentStatus.PENDING_ARCHIVE
            document.save(update_fields=["status", "updated_at"])
    return document


def archive_pending(archiver: BaseArchiver | None = None) -> int:
    """Reintenta el archivado de los documentos `pendiente_archivar`. Devuelve cuántos archivó."""
    archiver = archiver or get_archiver()
    archived = 0
    pending = Document.objects.filter(status=DocumentStatus.PENDING_ARCHIVE).select_related(
        "vehicle"
    )
    for document in pending:
        archive_document(document, archiver=archiver)
        if document.status == DocumentStatus.VALID:
            archived += 1
    return archived
