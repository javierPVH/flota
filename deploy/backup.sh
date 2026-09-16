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
# Restauración (probada con un dump de dev):
#   docker compose exec -T db pg_restore -U flota -d flota --clean --if-exists < backups/db-<fecha>.dump
#   tar -xzf backups/media-<fecha>.tar.gz -C ./data
set -eu
umask 077

DEST="${BACKUP_DIR:-/backups}"
MEDIA="${BACKUP_MEDIA_DIR:-/data/media}"
KEEP="${BACKUP_KEEP_DAYS:-30}"
MIN_SIZE="${BACKUP_MIN_SIZE:-1024}"
STAMP="$(date +%Y%m%d-%H%M%S)"
DUMP="$DEST/db-$STAMP.dump"
TAR="$DEST/media-$STAMP.tar.gz"

mkdir -p "$DEST"

fail() {
    echo "[backup] ERROR: $1" >&2
    rm -f "$DUMP.part" "$TAR.part"
    exit 1
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
echo "[backup] BD hecha y verificada -> $DUMP (${SIZE}b)"

# --- Media (documentos subidos). Los estaticos se regeneran en el build: fuera.
if [ -d "$MEDIA" ] && [ -n "$(ls -A "$MEDIA" 2>/dev/null)" ]; then
    tar -czf "$TAR.part" -C "$(dirname "$MEDIA")" "$(basename "$MEDIA")" \
        || fail "el tar de la media fallo"
    mv "$TAR.part" "$TAR"
    echo "[backup] media -> $TAR ($(wc -c < "$TAR")b)"
else
    echo "[backup] media: $MEDIA vacio o inexistente, no se empaqueta"
fi

# --- Marca de exito para el healthcheck: solo aqui, con todo verificado.
touch "$DEST/.last-backup-ok"

# --- Retencion: dumps y tars con mas de KEEP dias.
find "$DEST" -maxdepth 1 \( -name 'db-*.dump' -o -name 'media-*.tar.gz' \) \
    -mtime +"$KEEP" -print -delete | sed 's/^/[backup] retencion: borrado /'

echo "[backup] hecho. Ultimos ficheros en $DEST:"
ls -lh "$DEST" | tail -4
