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


_FOLDER_MIME = "application/vnd.google-apps.folder"


class GoogleDriveArchiver(BaseArchiver):
    """Google Drive real (Fase A3): sube el binario a la carpeta del vehículo.

    Usa la CUENTA DE SERVICIO (`GOOGLE_SA_KEYFILE`); la carpeta raíz
    (`GOOGLE_DRIVE_ROOT_FOLDER_ID`) debe estar compartida con su email como
    editor. Por vehículo se crea (o reutiliza) una subcarpeta con su matrícula
    (`Vehicle.drive_folder_id`); tras subir, guarda `drive_file_id`, borra el
    binario local (staging en `MEDIA_ROOT`) y devuelve el `webViewLink`.
    Sin credenciales se comporta como `NullArchiver` (documento pendiente).
    """

    def __init__(self, service=None):
        self._service = service  # inyectable en tests

    def _get_service(self):
        if self._service is None:
            from accounts.google_oauth import drive_service_service_account

            self._service = drive_service_service_account()
        return self._service

    def _num_retries(self) -> int:
        from accounts.google_oauth import GOOGLE_NUM_RETRIES

        return GOOGLE_NUM_RETRIES

    def ensure_folder(self, vehicle) -> str:
        """Asegura la carpeta del vehículo en Drive; devuelve su URL (o '')."""
        if vehicle.drive_folder_id:
            return vehicle.drive_folder_url
        service = self._get_service()
        root = getattr(settings, "GOOGLE_DRIVE_ROOT_FOLDER_ID", "")
        if not service or not root:
            return ""
        safe_plate = vehicle.plate.replace("'", "")
        found = (
            service.files()
            .list(
                q=(
                    f"name = '{safe_plate}' and '{root}' in parents "
                    f"and mimeType = '{_FOLDER_MIME}' and trashed = false"
                ),
                pageSize=1,
                fields="files(id,webViewLink)",
                supportsAllDrives=True,
                includeItemsFromAllDrives=True,
            )
            .execute(num_retries=self._num_retries())
            .get("files", [])
        )
        if found:
            folder = found[0]
        else:
            folder = (
                service.files()
                .create(
                    body={"name": vehicle.plate, "mimeType": _FOLDER_MIME, "parents": [root]},
                    fields="id,webViewLink",
                    supportsAllDrives=True,
                )
                .execute(num_retries=self._num_retries())
            )
        vehicle.drive_folder_id = folder.get("id") or ""
        vehicle.drive_folder_url = folder.get("webViewLink") or ""
        vehicle.save(update_fields=["drive_folder_id", "drive_folder_url", "updated_at"])
        return vehicle.drive_folder_url

    def archive(self, document: Document) -> str | None:
        if not getattr(settings, "GOOGLE_DRIVE_ENABLED", False):
            logger.info("Drive no configurado: documento %s pendiente de archivar.", document.pk)
            return None
        service = self._get_service()
        if not service:
            logger.info("Sin cuenta de servicio: documento %s pendiente.", document.pk)
            return None
        if not document.file:
            return None  # sin binario no hay nada que subir (drive_url ya se trató)
        self.ensure_folder(document.vehicle)
        folder_id = document.vehicle.drive_folder_id
        if not folder_id:
            return None
        import mimetypes

        from googleapiclient.http import MediaIoBaseUpload

        filename = Path(document.file.name).name
        mime = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        with document.file.open("rb") as handle:
            created = (
                service.files()
                .create(
                    body={"name": f"{document.type}-{filename}", "parents": [folder_id]},
                    media_body=MediaIoBaseUpload(handle, mimetype=mime),
                    fields="id,webViewLink",
                    supportsAllDrives=True,
                )
                .execute(num_retries=self._num_retries())
            )
        document.drive_file_id = created.get("id") or ""
        # El binario local era solo staging: una vez en Drive, se borra.
        document.file.delete(save=False)
        return created.get("webViewLink") or None


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
        # `drive_file_id`/`file` los puede haber tocado el archivador (Drive sube
        # el binario y borra el staging local); persistirlos aquí es inocuo para
        # los backends que no los tocan.
        document.save(update_fields=["drive_url", "drive_file_id", "file", "status", "updated_at"])
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
