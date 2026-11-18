#!/bin/sh
# Backup de Flota (OPS2): la BD es POSTGRES en el volumen `flota_pgdata` —
# copiar ./data NO la incluye. Este script vuelca la BD con pg_dump (formato
# custom, comprimido), empaqueta la media y aplica retención.
#
# Corre DENTRO del servicio `backup` del compose (imagen postgres:16-alpine),
# lanzado por deploy/backup-entrypoint.sh: una vez al arrancar y después por cron
# (BACKUP_CRON). Las credenciales llegan como PG* por el entorno del servicio;
# no lee ningún .env. Para lanzarlo a mano:
#
#   docker compose exec backup sh -c '. /tmp/backup.env; sh /deploy/backup.sh'
#
# Garantías (lo que fallaba en los otros proyectos del servidor):
#  · El dump se escribe a .part y solo se renombra si pg_dump acabó bien, el
#    fichero supera BACKUP_MIN_SIZE y pg_restore --list lo lee entero. Un fallo
#    de pg_dump NO deja un .dump de 0 bytes "con éxito" (gastos tuvo 215 así).
#  · Todo fallo termina con exit 1 y sin marcador; el healthcheck del compose
#    (.last-backup-ok de menos de 26 h) se pone en rojo solo.
#
# CFG-6: cifrado OPCIONAL con `age` a clave pública. Si BACKUP_AGE_RECIPIENT
# (age1...) está definida, el dump y el tar se cifran (`.age`) y el original en
# claro se borra; la clave PRIVADA no está en el servidor (README-DEPLOY). Sin
# la variable el backup va en claro y se avisa en el log en cada pasada. Los
# ficheros nacen 0600 (umask 077 + chmod) y la carpeta destino 0700.
#
# OPS2b: copia FUERA del servidor, OPCIONAL, a un bucket de Cloud Storage. Si
# BACKUP_GCS_BUCKET está definida, el dump y el tar de ESTA pasada se suben al
# bucket después de la copia local. Sin claves en disco: el token se pide al
# servidor de metadatos de la VM (cuenta de servicio de la máquina, que en el
# bucket solo tiene roles/storage.objectCreator: crea, pero no lee, lista ni
# borra). Detalles que importan:
#  · Solo se sube CIFRADO: el bucket tiene retención de 90 días y un dump en
#    claro (datos personales) no se podría borrar. Sin BACKUP_AGE_RECIPIENT la
#    subida falla; la copia local se queda hecha.
#  · Se sube con «si no existe» (x-goog-if-generation-match: 0): con retención
#    no se puede sobrescribir, y un 412 significa que ya estaba subido.
#  · Si la subida falla NO se escribe .last-backup-ok: el healthcheck se pone
#    en rojo aunque la copia local esté bien (README-DEPLOY §6.3).
#
# Restauración (probada con un dump de dev):
#   docker compose exec -T db pg_restore -U flota -d flota --clean --if-exists < backups/db-<fecha>.dump
#   tar -xzf backups/media-<fecha>.tar.gz -C ./data
# Cifrado: primero  age -d -i clave-privada.txt -o db-<fecha>.dump db-<fecha>.dump.age
set -eu
umask 077

DEST="${BACKUP_DIR:-/backups}"
MEDIA="${BACKUP_MEDIA_DIR:-/data/media}"
KEEP="${BACKUP_KEEP_DAYS:-30}"
MIN_SIZE="${BACKUP_MIN_SIZE:-1024}"
RECIPIENT="${BACKUP_AGE_RECIPIENT:-}"
GCS_BUCKET="${BACKUP_GCS_BUCKET:-}"
# Servidor de metadatos de GCE, por IP: no depende del DNS del contenedor.
GCS_TOKEN_URL="${BACKUP_GCS_TOKEN_URL:-http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token}"
STAMP="$(date +%Y%m%d-%H%M%S)"
DUMP="$DEST/db-$STAMP.dump"
TAR="$DEST/media-$STAMP.tar.gz"
# Ficheros definitivos de esta pasada (los que se suben al bucket).
UPLOADS=""
# Cabecera Authorization de la subida: va en un fichero 0600 (umask 077) y no
# en la línea de comandos de curl; se borra siempre al salir.
GCS_AUTH="/tmp/backup-gcs-auth.$$"
trap 'rm -f "$GCS_AUTH"' EXIT

mkdir -p "$DEST"
chmod 700 "$DEST" || true

fail() {
    echo "[backup] ERROR: $1" >&2
    rm -f "$DUMP.part" "$TAR.part" "$DUMP.age.part" "$TAR.age.part"
    exit 1
}

# Nombre definitivo de un fichero de backup: con cifrado acaba en .age.
final_name() {
    if [ -n "$RECIPIENT" ]; then echo "$1.age"; else echo "$1"; fi
}

# gcs_upload FICHERO -> gs://$GCS_BUCKET/<nombre>. El token se pide en cada
# fichero (caduca, y la media puede tardar). curl -T envía el fichero en
# streaming, sin cargarlo en memoria.
gcs_upload() {
    name="$(basename "$1")"
    token="$(curl -sS --connect-timeout 5 --max-time 15 -H 'Metadata-Flavor: Google' "$GCS_TOKEN_URL" \
        | sed -n 's/.*"access_token" *: *"\([^"]*\)".*/\1/p')" || true
    [ -n "$token" ] \
        || fail "subida: sin token del servidor de metadatos (la VM es de GCE? llega el contenedor a 169.254.169.254?). La copia local SI esta hecha"
    printf 'Authorization: Bearer %s\n' "$token" > "$GCS_AUTH"
    code="$(curl -sS -o /dev/null -w '%{http_code}' \
        --connect-timeout 15 --speed-limit 1024 --speed-time 120 \
        --retry 3 --retry-delay 10 \
        -T "$1" -H @"$GCS_AUTH" \
        -H 'x-goog-if-generation-match: 0' \
        -H 'Content-Type: application/octet-stream' \
        "https://storage.googleapis.com/$GCS_BUCKET/$name")" || true
    rm -f "$GCS_AUTH"
    case "$code" in
        200) echo "[backup] subido -> gs://$GCS_BUCKET/$name" ;;
        412) echo "[backup] gs://$GCS_BUCKET/$name ya estaba subido, no se toca" ;;
        401|403) fail "subida de $name rechazada (HTTP $code): la cuenta de servicio de la VM necesita roles/storage.objectCreator en el bucket Y la VM el scope devstorage.read_write o cloud-platform. La copia local SI esta hecha" ;;
        404) fail "subida de $name: el bucket '$GCS_BUCKET' no existe (HTTP 404). La copia local SI esta hecha" ;;
        *) fail "subida de $name fallo (HTTP ${code:-000}; 000 = sin red). La copia local SI esta hecha" ;;
    esac
}

# --- Cifrado (CFG-6): con destinatario, `age` es OBLIGATORIO. Si se pidió
#     cifrar y no se puede, se falla (healthcheck en rojo) antes que dejar un
#     backup en claro sin que nadie lo sepa.
if [ -n "$RECIPIENT" ]; then
    command -v age > /dev/null 2>&1 \
        || fail "BACKUP_AGE_RECIPIENT definido pero 'age' no esta instalado (el entrypoint hace apk add age)"
    echo "[backup] cifrado age activo (clave publica $RECIPIENT)"
else
    echo "[backup] AVISO: BACKUP_AGE_RECIPIENT vacio -> el backup se guarda EN CLARO (dump con datos personales)"
fi

# cifrar FICHERO -> FICHERO.age (y borrar el original). Sin destinatario, no hace nada.
encrypt() {
    [ -n "$RECIPIENT" ] || return 0
    age -r "$RECIPIENT" -o "$1.age.part" "$1" || fail "age no pudo cifrar $1"
    mv "$1.age.part" "$1.age"
    chmod 600 "$1.age"
    rm -f "$1"
    echo "[backup] cifrado -> $1.age"
}

# --- Base de datos -----------------------------------------------------------
echo "[backup] $(date '+%Y-%m-%d %H:%M:%S') BD ${PGDATABASE:-?}@${PGHOST:-?} -> $DUMP"
pg_dump --format=custom --no-password --file="$DUMP.part" \
    || fail "pg_dump fallo (credenciales? version cliente/servidor? red?)"

SIZE=$(wc -c < "$DUMP.part")
[ "$SIZE" -ge "$MIN_SIZE" ] || fail "dump sospechosamente pequeno (${SIZE}b < ${MIN_SIZE}b)"
pg_restore --list "$DUMP.part" > /dev/null \
    || fail "el dump no pasa la verificacion de pg_restore --list"
mv "$DUMP.part" "$DUMP"
chmod 600 "$DUMP"
echo "[backup] BD hecha y verificada -> $DUMP (${SIZE}b)"
encrypt "$DUMP"
UPLOADS="$(final_name "$DUMP")"

# --- Media (documentos subidos). Los estaticos se regeneran en el build: fuera.
if [ -d "$MEDIA" ] && [ -n "$(ls -A "$MEDIA" 2>/dev/null)" ]; then
    tar -czf "$TAR.part" -C "$(dirname "$MEDIA")" "$(basename "$MEDIA")" \
        || fail "el tar de la media fallo"
    mv "$TAR.part" "$TAR"
    chmod 600 "$TAR"
    echo "[backup] media -> $TAR ($(wc -c < "$TAR")b)"
    encrypt "$TAR"
    UPLOADS="$UPLOADS $(final_name "$TAR")"
else
    echo "[backup] media: $MEDIA vacio o inexistente, no se empaqueta"
fi

# --- Retencion LOCAL: dumps y tars (en claro o .age) con mas de KEEP dias. Va
#     antes de la subida para que un bucket caido varios dias no llene el disco.
#     (La del bucket la lleva su regla de ciclo de vida, no este script.)
find "$DEST" -maxdepth 1 \( -name 'db-*.dump' -o -name 'db-*.dump.age' \
        -o -name 'media-*.tar.gz' -o -name 'media-*.tar.gz.age' \) \
    -mtime +"$KEEP" -print -delete | sed 's/^/[backup] retencion: borrado /'

# --- Copia fuera del servidor (OPS2b): solo con bucket definido y solo cifrada.
if [ -n "$GCS_BUCKET" ]; then
    [ -n "$RECIPIENT" ] \
        || fail "BACKUP_GCS_BUCKET definido sin BACKUP_AGE_RECIPIENT: no se sube un backup EN CLARO (datos personales, y el bucket no deja borrarlo en 90 dias). La copia local SI esta hecha"
    command -v curl > /dev/null 2>&1 \
        || fail "BACKUP_GCS_BUCKET definido pero 'curl' no esta instalado (el entrypoint hace apk add curl). La copia local SI esta hecha"
    for f in $UPLOADS; do
        gcs_upload "$f"
    done
else
    echo "[backup] AVISO: BACKUP_GCS_BUCKET vacio -> el backup solo queda en este servidor"
fi

# --- Marca de exito para el healthcheck: solo aqui, con todo verificado (y
#     subido, si hay bucket).
touch "$DEST/.last-backup-ok"

echo "[backup] hecho. Ultimos ficheros en $DEST:"
ls -lh "$DEST" | tail -4
