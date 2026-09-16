"""Tests del archivador de Google Drive (Fase A3) con un cliente falso.

El `GoogleDriveArchiver` acepta un `service` inyectado (mismo contrato que el
cliente de googleapiclient) — aquí se simula Drive: el árbol carpeta madre →
matrícula → familia, la subida del binario y el efecto completo sobre
`Document`/`Vehicle`, más QUIÉN puede archivar: el administrador siempre (con su
Google o con la cuenta de servicio); el resto, solo si entró con Google.
"""

import tempfile
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone

from fleet.models import Document, Vehicle
from fleet.models.enums import DocumentStatus
from fleet.services.archiver import GoogleDriveArchiver, archive_document, family_of


class _FakeRequest:
    def __init__(self, result):
        self._result = result

    def execute(self, num_retries=0):
        return self._result


class _FakeFiles:
    """Doble del recurso `files()` de Drive v3: registra las llamadas.

    `existing_folders` es {nombre: id} — las carpetas que YA están en Drive—,
    porque el árbol tiene dos niveles y cada búsqueda pregunta por un nombre
    distinto. Lo que se crea recibe un id derivado del nombre, para poder
    comprobar de quién cuelga cada cosa.
    """

    def __init__(self, existing_folders=None):
        self.existing_folders = existing_folders or {}
        self.created = []  # bodies de files().create
        self.queries = []

    def list(self, q="", **kwargs):
        self.queries.append(q)
        for name, folder_id in self.existing_folders.items():
            if f"name = '{name}'" in q:
                return _FakeRequest(
                    {"files": [{"id": folder_id, "webViewLink": f"https://drive/{folder_id}"}]}
                )
        return _FakeRequest({"files": []})

    def create(self, body=None, media_body=None, fields="", **kwargs):
        self.created.append({"body": body, "media": media_body})
        if body.get("mimeType", "").endswith("folder"):
            new_id = f"folder-{body['name']}"
            return _FakeRequest({"id": new_id, "webViewLink": f"https://drive/{new_id}"})
        return _FakeRequest({"id": "file-456", "webViewLink": "https://drive/file-456"})


class _FakeDrive:
    def __init__(self, files):
        self._files = files

    def files(self):
        return self._files


DRIVE_ON = {"GOOGLE_DRIVE_ENABLED": True, "GOOGLE_DRIVE_ROOT_FOLDER_ID": "root-1"}


class GoogleDriveArchiverTests(TestCase):
    def setUp(self):
        self.vehicle = Vehicle.objects.create(plate="DRV111", brand="a", model="b")
        # Quien sube ENTRÓ CON GOOGLE: es lo que autoriza a archivar con la
        # cuenta de servicio (la web de conductores es pública).
        self.uploader = get_user_model().objects.create_user(
            username="sara", email="sara@flota.dev", last_google_login=timezone.now()
        )

    def _doc_with_file(self, doc_type="insurance", uploader=-1):
        return Document.objects.create(
            vehicle=self.vehicle,
            type=doc_type,
            uploaded_by=self.uploader if uploader == -1 else uploader,
            file=SimpleUploadedFile("seguro.pdf", b"%PDF fake", "application/pdf"),
        )

    @override_settings(**DRIVE_ON)
    def test_uploads_creates_folder_and_cleans_local_file(self):
        fake = _FakeFiles()
        with tempfile.TemporaryDirectory() as tmp, override_settings(MEDIA_ROOT=tmp):
            doc = self._doc_with_file()
            archive_document(doc, archiver=GoogleDriveArchiver(service=_FakeDrive(fake)))
        self.assertEqual(doc.status, DocumentStatus.VALID)
        self.assertEqual(doc.drive_url, "https://drive/file-456")
        self.assertEqual(doc.drive_file_id, "file-456")
        self.assertFalse(doc.file)  # el staging local se borra tras subir
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.drive_folder_id, "folder-DRV111")
        # El árbol entero, en orden: «Vehículos» bajo la raíz, la matrícula
        # dentro, la familia bajo la matrícula, el tipo bajo la familia y el
        # fichero dentro del tipo.
        nombres = [c["body"]["name"] for c in fake.created[:4]]
        self.assertEqual(nombres, ["Vehículos", "DRV111", "Documentación", "Seguro"])
        self.assertEqual(fake.created[0]["body"]["parents"], ["root-1"])
        self.assertEqual(fake.created[1]["body"]["parents"], ["folder-Vehículos"])
        self.assertEqual(fake.created[2]["body"]["parents"], ["folder-DRV111"])
        self.assertEqual(fake.created[3]["body"]["parents"], ["folder-Documentación"])
        self.assertEqual(fake.created[4]["body"]["parents"], ["folder-Seguro"])
        self.assertIn("seguro.pdf", fake.created[4]["body"]["name"])

    @override_settings(**DRIVE_ON)
    def test_familia_por_tipo_de_documento(self):
        # Las fotos de un accidente no van con los papeles del coche, y dentro
        # de «Incidencias» cada tipo tiene su carpeta.
        fake = _FakeFiles(existing_folders={"Vehículos": "veh-1", "DRV111": "ya-existia"})
        with tempfile.TemporaryDirectory() as tmp, override_settings(MEDIA_ROOT=tmp):
            doc = self._doc_with_file(doc_type="damage_photos")
            archive_document(doc, archiver=GoogleDriveArchiver(service=_FakeDrive(fake)))
        self.assertEqual(family_of("damage_photos"), "Incidencias")
        self.assertEqual(fake.created[0]["body"]["name"], "Incidencias")
        self.assertEqual(fake.created[0]["body"]["parents"], ["ya-existia"])
        self.assertEqual(fake.created[1]["body"]["name"], "Fotos de daños")
        self.assertEqual(fake.created[1]["body"]["parents"], ["folder-Incidencias"])
        self.assertEqual(fake.created[2]["body"]["parents"], ["folder-Fotos de daños"])

    @override_settings(**DRIVE_ON)
    def test_facturas_y_otros_no_se_subdividen_por_tipo(self):
        # «Facturas» tiene un solo tipo y «Otros» ninguno: el fichero va directo.
        fake = _FakeFiles(existing_folders={"Vehículos": "veh-1", "DRV111": "ya-existia"})
        with tempfile.TemporaryDirectory() as tmp, override_settings(MEDIA_ROOT=tmp):
            factura = self._doc_with_file(doc_type="workshop_invoice")
            otro = self._doc_with_file(doc_type="other")
            uno = GoogleDriveArchiver(service=_FakeDrive(fake))
            archive_document(factura, archiver=uno)
            archive_document(otro, archiver=uno)
        carpetas = [c["body"]["name"] for c in fake.created if c["body"].get("mimeType")]
        self.assertEqual(carpetas, ["Facturas", "Otros"])
        ficheros = [c for c in fake.created if not c["body"].get("mimeType")]
        self.assertEqual(ficheros[0]["body"]["parents"], ["folder-Facturas"])
        self.assertEqual(ficheros[1]["body"]["parents"], ["folder-Otros"])

    @override_settings(**DRIVE_ON)
    def test_documento_personal_va_a_usuarios_por_correo(self):
        # El permiso de conducir no es de ningún coche: cuelga de
        # Usuarios/<correo>, con las mismas familias y tipos que un vehículo.
        fake = _FakeFiles()
        with tempfile.TemporaryDirectory() as tmp, override_settings(MEDIA_ROOT=tmp):
            doc = Document.objects.create(
                user=self.uploader,
                type="driving_license",
                uploaded_by=self.uploader,
                file=SimpleUploadedFile("carnet.pdf", b"%PDF fake", "application/pdf"),
            )
            archive_document(doc, archiver=GoogleDriveArchiver(service=_FakeDrive(fake)))
        self.assertEqual(doc.status, DocumentStatus.VALID)
        nombres = [c["body"]["name"] for c in fake.created[:4]]
        self.assertEqual(
            nombres, ["Usuarios", "sara@flota.dev", "Documentación", "Permiso de conducir"]
        )
        self.assertEqual(fake.created[0]["body"]["parents"], ["root-1"])
        self.assertEqual(fake.created[1]["body"]["parents"], ["folder-Usuarios"])
        self.assertEqual(fake.created[4]["body"]["parents"], ["folder-Permiso de conducir"])
        # Y no se ha inventado ninguna carpeta de vehículo.
        self.assertNotIn("Vehículos", nombres)

    @override_settings(**DRIVE_ON)
    def test_reuses_existing_drive_folder(self):
        fake = _FakeFiles(
            existing_folders={
                "Vehículos": "veh-1",
                "DRV111": "ya-existia",
                "Documentación": "fam-1",
                "Seguro": "tipo-1",
            }
        )
        with tempfile.TemporaryDirectory() as tmp, override_settings(MEDIA_ROOT=tmp):
            doc = self._doc_with_file()
            archive_document(doc, archiver=GoogleDriveArchiver(service=_FakeDrive(fake)))
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.drive_folder_id, "ya-existia")
        # Solo una creación: el fichero (las cuatro carpetas se reutilizaron).
        self.assertEqual(len(fake.created), 1)
        self.assertEqual(fake.created[0]["body"]["parents"], ["tipo-1"])

    @override_settings(**DRIVE_ON)
    def test_known_folder_skips_lookup(self):
        self.vehicle.drive_folder_id = "cacheada"
        self.vehicle.drive_folder_url = "https://drive/cacheada"
        self.vehicle.save(update_fields=["drive_folder_id", "drive_folder_url"])
        fake = _FakeFiles()
        with tempfile.TemporaryDirectory() as tmp, override_settings(MEDIA_ROOT=tmp):
            doc = self._doc_with_file()
            archive_document(doc, archiver=GoogleDriveArchiver(service=_FakeDrive(fake)))
        # La matrícula ya se sabía: ni «Vehículos» ni la matrícula se buscan;
        # solo la familia y el tipo, que cuelgan de ella.
        self.assertEqual(len(fake.queries), 2)
        self.assertEqual(fake.created[0]["body"]["parents"], ["cacheada"])
        self.assertEqual(fake.created[1]["body"]["parents"], ["folder-Documentación"])

    @override_settings(**DRIVE_ON)
    def test_una_pasada_resuelve_cada_carpeta_una_vez(self):
        # Veinte fotos de la misma incidencia son veinte documentos del mismo
        # coche y la misma familia: preguntarle a Drive una vez por cada uno
        # era pagar una llamada de red por foto.
        fake = _FakeFiles()
        uno = GoogleDriveArchiver(service=_FakeDrive(fake))
        with tempfile.TemporaryDirectory() as tmp, override_settings(MEDIA_ROOT=tmp):
            for _ in range(3):
                archive_document(self._doc_with_file(), archiver=uno)
        # Cuatro búsquedas en total (Vehículos, matrícula, familia y tipo), no
        # cuatro por documento.
        self.assertEqual(len(fake.queries), 4)
        carpetas = [c for c in fake.created if c["body"].get("mimeType", "").endswith("folder")]
        self.assertEqual(len(carpetas), 4)
        ficheros = [c for c in fake.created if not c["body"].get("mimeType")]
        self.assertEqual(len(ficheros), 3)  # los tres documentos sí suben

    @override_settings(**DRIVE_ON)
    @patch("accounts.google_oauth.drive_service_service_account")
    @patch("accounts.google_oauth.drive_service")
    def test_cada_documento_con_la_cuenta_de_quien_lo_subio(self, propia, cuenta_servicio):
        """Gestión sube con la cuenta del administrador; la PWA, con la de servicio."""
        admin = get_user_model().objects.create_user(username="jefa", email="jefa@flota.dev")
        suya, servicio = _FakeFiles(), _FakeFiles()
        propia.side_effect = lambda user: _FakeDrive(suya) if user.pk == admin.pk else None
        cuenta_servicio.return_value = _FakeDrive(servicio)

        uno = GoogleDriveArchiver()
        with tempfile.TemporaryDirectory() as tmp, override_settings(MEDIA_ROOT=tmp):
            archive_document(self._doc_with_file(uploader=admin), archiver=uno)
            # El conductor entró con Google pero no tiene Drive conectado.
            archive_document(self._doc_with_file(), archiver=uno)
            archive_document(self._doc_with_file(), archiver=uno)
        self.assertEqual(len([c for c in suya.created if not c["body"].get("mimeType")]), 1)
        self.assertEqual(len([c for c in servicio.created if not c["body"].get("mimeType")]), 2)
        # Los clientes se construyen una vez por pasada, no por documento.
        self.assertEqual(cuenta_servicio.call_count, 1)
        self.assertEqual(propia.call_count, 2)  # una por persona

    @override_settings(**DRIVE_ON)
    def test_sin_entrar_con_google_no_se_sube(self):
        # La web de conductores es pública: sin identidad de Google detrás, el
        # documento espera (el reintento lo recogerá si algún día la hay).
        nadie = get_user_model().objects.create_user(username="local", email="local@flota.dev")
        fake = _FakeFiles()
        with tempfile.TemporaryDirectory() as tmp, override_settings(MEDIA_ROOT=tmp):
            doc = self._doc_with_file(uploader=nadie)
            archive_document(doc, archiver=GoogleDriveArchiver(service=_FakeDrive(fake)))
        self.assertEqual(doc.status, DocumentStatus.PENDING_ARCHIVE)
        self.assertEqual(fake.created, [])
        self.assertTrue(doc.file)  # el binario sigue en staging

    @override_settings(**DRIVE_ON)
    def test_administrador_sin_google_sube_con_la_cuenta_de_servicio(self):
        # Gestión va por dentro y el acceso se gestiona en casa: el administrador
        # no necesita haber entrado con Google (ni tener Drive conectado) para
        # que la cuenta de servicio archive lo que sube.
        from accounts.models import Role, UserRole

        admin = get_user_model().objects.create_user(username="jefa", email="jefa@flota.dev")
        UserRole.objects.create(user=admin, role=Role.ADMIN)
        self.assertIsNone(admin.last_google_login)
        fake = _FakeFiles()
        with tempfile.TemporaryDirectory() as tmp, override_settings(MEDIA_ROOT=tmp):
            doc = self._doc_with_file(uploader=admin)
            archive_document(doc, archiver=GoogleDriveArchiver(service=_FakeDrive(fake)))
        self.assertEqual(doc.status, DocumentStatus.VALID)
        self.assertEqual(doc.drive_url, "https://drive/file-456")
        # Un conductor en la misma situación sigue esperando: la regla es por rol.
        conductor = get_user_model().objects.create_user(username="cond", email="cond@flota.dev")
        UserRole.objects.create(user=conductor, role=Role.DRIVER)
        with tempfile.TemporaryDirectory() as tmp, override_settings(MEDIA_ROOT=tmp):
            pendiente = self._doc_with_file(uploader=conductor)
            archive_document(pendiente, archiver=GoogleDriveArchiver(service=_FakeDrive(fake)))
        self.assertEqual(pendiente.status, DocumentStatus.PENDING_ARCHIVE)

    @override_settings(**DRIVE_ON)
    def test_sin_quien_lo_suba_no_se_sube(self):
        fake = _FakeFiles()
        with tempfile.TemporaryDirectory() as tmp, override_settings(MEDIA_ROOT=tmp):
            doc = self._doc_with_file(uploader=None)
            archive_document(doc, archiver=GoogleDriveArchiver(service=_FakeDrive(fake)))
        self.assertEqual(doc.status, DocumentStatus.PENDING_ARCHIVE)
        self.assertEqual(fake.created, [])

    def test_disabled_leaves_pending(self):
        # Sin GOOGLE_DRIVE_ENABLED el backend gdrive se comporta como `none`.
        with tempfile.TemporaryDirectory() as tmp, override_settings(MEDIA_ROOT=tmp):
            doc = self._doc_with_file()
            archive_document(doc, archiver=GoogleDriveArchiver(service=_FakeDrive(_FakeFiles())))
        self.assertEqual(doc.status, DocumentStatus.PENDING_ARCHIVE)
        self.assertTrue(doc.file)  # el binario NO se toca si no se archivó

    @override_settings(GOOGLE_DRIVE_ENABLED=True, GOOGLE_DRIVE_ROOT_FOLDER_ID="")
    def test_missing_root_folder_leaves_pending(self):
        with tempfile.TemporaryDirectory() as tmp, override_settings(MEDIA_ROOT=tmp):
            doc = self._doc_with_file()
            archive_document(doc, archiver=GoogleDriveArchiver(service=_FakeDrive(_FakeFiles())))
        self.assertEqual(doc.status, DocumentStatus.PENDING_ARCHIVE)

    @override_settings(**DRIVE_ON)
    def test_without_service_account_leaves_pending(self):
        # service=None y sin GOOGLE_SA_KEYFILE → no hay cliente → pendiente.
        with tempfile.TemporaryDirectory() as tmp, override_settings(MEDIA_ROOT=tmp):
            doc = self._doc_with_file()
            archive_document(doc, archiver=GoogleDriveArchiver())
        self.assertEqual(doc.status, DocumentStatus.PENDING_ARCHIVE)
