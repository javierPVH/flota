"""Archivado de documentos (HU-4.2, Épica 9) con *fallback* y reintento.

El archivado real en Google Drive necesita credenciales que no siempre están
disponibles, así que se abstrae detrás de una interfaz `BaseArchiver` con varios
backends intercambiables (`FLEET_ARCHIVE_BACKEND`):

- **`none`** (`NullArchiver`): no archiva; el documento queda `pendiente_archivar`
  y espera al reintento (`archive_pending_documents`).
- **`local`** (`LocalArchiver`): *fallback* sin dependencias externas; crea una
  carpeta por vehículo en el disco y registra una URL `file://`. Útil en dev/CI.
- **`gdrive`** (`GoogleDriveArchiver`): Drive real; sin credenciales se comporta
  como `none`.

El árbol es el mismo en los dos backends que archivan de verdad, colgando de la
**carpeta madre** (`GOOGLE_DRIVE_ROOT_FOLDER_ID`):

    Vehículos/<matrícula>/<familia>[/<tipo>]/fichero   documentos del coche
    Usuarios/<correo>/<familia>[/<tipo>]/fichero        documentos personales

La **familia** sale de `DOCUMENT_FAMILIES` y, dentro de «Documentación» e
«Incidencias» (`SUBDIVIDED_FAMILIES`), hay una carpeta más por **tipo** de
documento (su etiqueta: «Seguro», «Fotos de daños»…); «Facturas» y «Otros» no
se subdividen. Cada nivel se busca antes de crearse, así que dos subidas a la
vez no dejan carpetas duplicadas ni pisan lo que ya hubiera.

Flujo (ver `archive_document`): si el documento ya trae `drive_url` (el front
subió a un destino externo), se marca `vigente`; si no, se delega en el backend;
si el backend no puede archivar, queda `pendiente_archivar` para reintentar.
"""

from __future__ import annotations

import logging
from pathlib import Path

from django.conf import settings

from fleet.models import Document
from fleet.models.enums import DocumentStatus, DocumentType

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
        folder = self.base_dir.joinpath(*vehicle_path_of(vehicle))
        folder.mkdir(parents=True, exist_ok=True)
        url = folder.resolve().as_uri()
        if vehicle.drive_folder_url != url:
            vehicle.drive_folder_url = url
            vehicle.save(update_fields=["drive_folder_url", "updated_at"])
        return url

    def archive(self, document: Document) -> str | None:
        # Mismo árbol que Drive (Vehículos/matrícula o Usuarios/correo, y debajo
        # familia y tipo): lo que se prueba en dev con el backend local es lo
        # que se verá luego en Drive.
        if document.vehicle_id is not None:
            self.ensure_folder(document.vehicle)
        folder = self.base_dir.joinpath(*holder_path_of(document), *folder_path_of(document.type))
        folder.mkdir(parents=True, exist_ok=True)
        return f"{folder.resolve().as_uri()}/doc-{document.pk}-{document.type}"


_FOLDER_MIME = "application/vnd.google-apps.folder"

#: Los dos niveles superiores, bajo la carpeta madre: lo de los coches y lo de
#: las personas van separados desde la raíz.
FOLDER_VEHICLES = "Vehículos"
FOLDER_USERS = "Usuarios"

#: Subcarpeta (familia) en la que se archiva cada tipo de documento, DENTRO de
#: la carpeta de la matrícula (o del usuario). Quien abre el Drive busca «los
#: papeles», «lo que le ha pasado» o «lo que se ha pagado». En Drive la carpeta
#: se localiza por NOMBRE: cambiar una etiqueta no mueve lo ya archivado, crea
#: otra carpeta al lado.
DOCUMENT_FAMILIES: dict[str, str] = {
    DocumentType.REGISTRATION: "Documentación",
    DocumentType.TECHNICAL_SHEET: "Documentación",
    DocumentType.INSURANCE: "Documentación",
    DocumentType.CONTRACT: "Documentación",
    DocumentType.HANDOVER_ACT: "Documentación",
    DocumentType.RETURN_ACT: "Documentación",
    DocumentType.DRIVING_LICENSE: "Documentación",
    DocumentType.ACCIDENT_REPORT: "Incidencias",
    DocumentType.DAMAGE_PHOTOS: "Incidencias",
    DocumentType.ITV_REPORT: "Incidencias",
    DocumentType.WORKSHOP_INVOICE: "Facturas",
}
#: Lo que no encaja en ninguna (incluido un tipo nuevo que nadie haya mapeado).
FAMILY_OTHER = "Otros"
#: Familias con una carpeta más por TIPO de documento («Seguro», «Fotos de
#: daños»…). Facturas y Otros no se parten: tienen un tipo o ninguno.
SUBDIVIDED_FAMILIES = frozenset({"Documentación", "Incidencias"})


def family_of(document_type: str) -> str:
    """Carpeta (familia) en la que se archiva un tipo de documento."""
    return DOCUMENT_FAMILIES.get(document_type, FAMILY_OTHER)


def type_folder_of(document_type: str) -> str:
    """Nombre de la carpeta de un tipo: su etiqueta («Seguro»), o el valor si es
    un tipo que el catálogo no conoce."""
    try:
        return str(DocumentType(document_type).label)
    except ValueError:
        return document_type


def folder_path_of(document_type: str) -> list[str]:
    """Carpetas bajo la matrícula (o el usuario) para un tipo: familia y, en las
    familias subdivididas, el tipo."""
    family = family_of(document_type)
    if family in SUBDIVIDED_FAMILIES:
        return [family, type_folder_of(document_type)]
    return [family]


def vehicle_path_of(vehicle) -> list[str]:
    """Carpeta de un coche bajo la raíz: `Vehículos/<matrícula>`."""
    return [FOLDER_VEHICLES, vehicle.plate]


def user_path_of(user) -> list[str]:
    """Carpeta de una persona bajo la raíz: `Usuarios/<correo>` (o el usuario,
    si no tiene correo)."""
    return [FOLDER_USERS, (user.email or "").strip().lower() or user.get_username()]


def holder_path_of(document: Document) -> list[str]:
    """Carpeta del titular del documento: la del coche o la de la persona."""
    if document.vehicle_id is not None:
        return vehicle_path_of(document.vehicle)
    return user_path_of(document.user)


class GoogleDriveArchiver(BaseArchiver):
    """Google Drive real (Fase A3): sube el binario donde le toca.

    El árbol se asegura nivel a nivel, buscando antes de crear: carpeta madre
    (`GOOGLE_DRIVE_ROOT_FOLDER_ID`) → **Vehículos** → **matrícula** (se
    recuerda en `Vehicle.drive_folder_id`) → **familia** → **tipo** (solo en las
    familias subdivididas), o **Usuarios** → **correo** → familia → tipo para
    los documentos personales. Tras subir, guarda `drive_file_id`, borra el
    binario local (staging en `MEDIA_ROOT`) y devuelve el `webViewLink`.

    **Con qué cuenta** lo decide quien subió el documento (`_service_for`), y
    sin una identidad de Google detrás no se sube nada: el documento queda
    pendiente y el reintento lo volverá a intentar cuando la haya.
    """

    def __init__(self, service=None):
        self._service = service  # inyectado (tests): manda sobre todo lo demás
        # Memoria de UNA pasada. El reintento (`archive_pending`) archiva en
        # bloque con el mismo archivador, y sin esto cada documento volvía a
        # leer el keyfile, a refrescar tokens y a preguntarle a Drive por la
        # misma carpeta. `False` = ya se intentó y no hay (no reintentar).
        self._sa = None  # cliente de la cuenta de servicio
        self._de_usuario: dict[int, object] = {}  # id de usuario -> su cliente
        self._carpetas: dict[tuple[str, str], str] = {}  # (padre, nombre) -> id
        self._avisados: set[int] = set()  # de quién ya se dijo que no puede

    def _get_service(self):
        """Cliente de la CUENTA DE SERVICIO, construido una vez por archivador.

        No se guarda en `self._service`: ese hueco significa «me lo han
        inyectado», y pisarlo haría que el siguiente documento subiera con la
        cuenta de servicio aunque su dueño tuviera la suya.
        """
        if self._service is not None:
            return self._service
        if self._sa is None:
            from accounts.google_oauth import drive_service_service_account

            self._sa = drive_service_service_account() or False
        return self._sa or None

    def _num_retries(self) -> int:
        from accounts.google_oauth import GOOGLE_NUM_RETRIES

        return GOOGLE_NUM_RETRIES

    def _child_folder(self, service, parent_id: str, name: str) -> dict:
        """Carpeta `name` colgando de `parent_id`: la busca y, si no está, la crea.

        Un solo sitio para los dos niveles (matrícula y familia): buscar antes
        de crear es lo que evita duplicar carpetas cuando llegan dos subidas
        seguidas del mismo coche.
        """
        # R5-18: en el lenguaje de consulta de Drive `\` escapa y `'` cierra la
        # cadena: se escapan los dos (antes solo se quitaba la comilla).
        safe_name = name.replace("\\", "\\\\").replace("'", "\\'")
        found = (
            service.files()
            .list(
                q=(
                    f"name = '{safe_name}' and '{parent_id}' in parents "
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
            return found[0]
        return (
            service.files()
            .create(
                body={"name": name, "mimeType": _FOLDER_MIME, "parents": [parent_id]},
                fields="id,webViewLink",
                supportsAllDrives=True,
            )
            .execute(num_retries=self._num_retries())
        )

    def _service_for(self, document: Document):
        """Cliente de Drive con el que subir ESTE documento, o None.

        Quien sube manda, porque son dos webs distintas:

        - **Gestión**: si el administrador ha conectado su Google, se sube con
          SU cuenta (es su Drive y su rastro). Si no, con la **cuenta de
          servicio**: el administrador es el rol de confianza de la casa, entra
          por la red interna y el acceso se gestiona dentro, así que no hace
          falta una identidad de Google detrás para escribir en la carpeta de
          la flota (gestión, además, no puede completar el OAuth de Google sin
          un origen https público).
        - **Conductores** (web pública): a un conductor no se le pide Drive, así
          que sube la **cuenta de servicio** — pero solo si esa persona **entró
          con Google** (`last_google_login`), que es lo único que acredita que
          hay una identidad de Google detrás del documento. Es a propósito: un
          usuario de la web pública no consigue, con una contraseña, que la
          cuenta privilegiada escriba en Drive en su nombre.

        Sin ninguna de esas cosas no se sube: el documento queda pendiente y
        el reintento (`archive_pending_documents`) lo recogerá si algún día la
        hay. Nunca lanza: lo peor que pasa es que no se archive todavía.
        """
        uploader = document.uploaded_by
        if uploader is None:
            logger.info("Documento %s sin quien lo subiera: pendiente.", document.pk)
            return None
        propia = self._cuenta_propia(uploader)
        if propia is not None:
            return propia
        if getattr(uploader, "is_admin", False):
            return self._get_service()
        if not getattr(uploader, "last_google_login", None):
            # Una vez por persona y pasada: el reintento repasa lo pendiente
            # entero cada vez, y una línea por documento tapaba el log.
            if uploader.pk not in self._avisados:
                self._avisados.add(uploader.pk)
                logger.info(
                    "%s no ha entrado con Google: sus documentos quedan pendientes.", uploader
                )
            return None
        return self._get_service()

    def _cuenta_propia(self, user):
        """Cliente de Drive del usuario (gestión), UNO por usuario y pasada.

        Construirlo puede refrescar su token contra Google, así que no se hace
        una vez por documento. Si el refresco falla —consentimiento revocado,
        sin red— se anota y se sigue: el documento aún puede subir por la
        cuenta de servicio si esa persona entró con Google.
        """
        if self._service is not None:
            return None  # con cliente inyectado no se resuelve nada más
        if user.pk not in self._de_usuario:
            from accounts.google_oauth import drive_service

            try:
                self._de_usuario[user.pk] = drive_service(user)
            except Exception:
                logger.exception("No se pudo usar el Google de %s; se sigue sin él.", user)
                self._de_usuario[user.pk] = None
        return self._de_usuario[user.pk]

    def _folder_id(self, service, parent_id: str, name: str) -> str:
        """Id de una carpeta hija, recordado durante la pasada.

        Veinte fotos de la misma incidencia son veinte documentos del mismo
        coche y la misma familia: la carpeta se resuelve una vez.
        """
        clave = (parent_id, name)
        if clave not in self._carpetas:
            self._carpetas[clave] = self._child_folder(service, parent_id, name).get("id") or ""
        return self._carpetas[clave]

    def _chain(self, service, parent_id: str, names: list[str]) -> str:
        """Id de la última carpeta de `names` colgando de `parent_id`, asegurando
        cada nivel por el camino (y recordándolo durante la pasada)."""
        for name in names:
            parent_id = self._folder_id(service, parent_id, name)
            if not parent_id:
                return ""
        return parent_id

    def ensure_folder(self, vehicle, service=None) -> str:
        """Asegura `Vehículos/<matrícula>` en Drive; devuelve su URL (o '')."""
        if vehicle.drive_folder_id:
            return vehicle.drive_folder_url
        service = service or self._get_service()
        root = getattr(settings, "GOOGLE_DRIVE_ROOT_FOLDER_ID", "")
        if not service or not root:
            return ""
        vehicles_id = self._folder_id(service, root, FOLDER_VEHICLES)
        if not vehicles_id:
            return ""
        folder = self._child_folder(service, vehicles_id, vehicle.plate)
        vehicle.drive_folder_id = folder.get("id") or ""
        vehicle.drive_folder_url = folder.get("webViewLink") or ""
        vehicle.save(update_fields=["drive_folder_id", "drive_folder_url", "updated_at"])
        return vehicle.drive_folder_url

    def archive(self, document: Document) -> str | None:
        if not getattr(settings, "GOOGLE_DRIVE_ENABLED", False):
            logger.info("Drive no configurado: documento %s pendiente de archivar.", document.pk)
            return None
        if not document.file:
            return None  # sin binario no hay nada que subir (drive_url ya se trató)
        service = self._service_for(document)
        if not service:
            return None
        if document.vehicle_id is not None:
            self.ensure_folder(document.vehicle, service)
            holder_id = document.vehicle.drive_folder_id
        else:
            # Documento personal (permiso de conducir…): `Usuarios/<correo>`.
            root = getattr(settings, "GOOGLE_DRIVE_ROOT_FOLDER_ID", "")
            holder_id = self._chain(service, root, user_path_of(document.user)) if root else ""
        if not holder_id:
            return None
        # Dentro del titular, la familia del documento y, si se subdivide, el tipo.
        family_id = self._chain(service, holder_id, folder_path_of(document.type))
        if not family_id:
            return None
        import mimetypes

        from googleapiclient.http import MediaIoBaseUpload

        filename = Path(document.file.name).name
        mime = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        with document.file.open("rb") as handle:
            created = (
                service.files()
                .create(
                    body={"name": f"{document.type}-{filename}", "parents": [family_id]},
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


#: Formas en que un usuario puede pegar una carpeta de Drive en el formulario.
_FOLDER_URL_PATTERNS = (
    r"/folders/([A-Za-z0-9_-]+)",  # .../drive/folders/<id>
    r"[?&]id=([A-Za-z0-9_-]+)",  # ...open?id=<id>
)


def folder_id_from(reference: str) -> str:
    """Id de carpeta a partir de lo que haya escrito el usuario.

    Acepta el id pelado o una URL de Drive: en el formulario de Ajustes la gente
    pega el enlace de la barra del navegador, no el id.
    """
    import re

    reference = (reference or "").strip()
    for pattern in _FOLDER_URL_PATTERNS:
        found = re.search(pattern, reference)
        if found:
            return found.group(1)
    # Un id no lleva barras ni espacios; si los lleva, no es utilizable.
    return reference if reference and not re.search(r"[/\s]", reference) else ""


def upload_bytes(
    name: str, content: bytes, folder_reference: str, *, archiver: BaseArchiver | None = None
) -> str | None:
    """Sube un fichero en memoria a una carpeta de Drive. Devuelve su enlace.

    Existe aparte de `GoogleDriveArchiver.archive`, que está atado a `Document`
    y a la carpeta del vehículo: los informes programados no son documentos de
    un vehículo y su carpeta la elige el usuario en cada envío.

    Devuelve `None` —sin lanzar— si Drive no está configurado o la carpeta no es
    utilizable: el envío por correo del mismo aviso no debe caerse por eso.
    """
    if not getattr(settings, "GOOGLE_DRIVE_ENABLED", False):
        logger.info("Drive no configurado: no se guarda %s.", name)
        return None
    folder_id = folder_id_from(folder_reference)
    if not folder_id:
        logger.warning(
            "Carpeta de Drive no utilizable (%r): no se guarda %s.", folder_reference, name
        )
        return None

    drive = archiver if isinstance(archiver, GoogleDriveArchiver) else GoogleDriveArchiver()
    service = drive._get_service()
    if not service:
        logger.info("Sin cuenta de servicio: no se guarda %s.", name)
        return None

    import io
    import mimetypes

    from googleapiclient.http import MediaIoBaseUpload

    mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
    created = (
        service.files()
        .create(
            body={"name": name, "parents": [folder_id]},
            media_body=MediaIoBaseUpload(io.BytesIO(content), mimetype=mime),
            fields="id,webViewLink",
            supportsAllDrives=True,
        )
        .execute(num_retries=drive._num_retries())
    )
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
    # `uploaded_by` entra en el select_related porque el archivador de Drive
    # mira quién subió cada documento para decidir con qué cuenta lo sube.
    pending = Document.objects.filter(status=DocumentStatus.PENDING_ARCHIVE).select_related(
        "vehicle", "user", "uploaded_by"
    )
    # En streaming: lo pendiente puede acumularse (un documento sin identidad de
    # Google detrás se queda ahí hasta que la haya), y no hay por qué traerlo
    # todo a memoria para recorrerlo una vez.
    for document in pending.iterator(chunk_size=200):
        archive_document(document, archiver=archiver)
        if document.status == DocumentStatus.VALID:
            archived += 1
    return archived
