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
STAMP="$(date +%Y%m%d-%H%M%S)"
DUMP="$DEST/db-$STAMP.dump"
TAR="$DEST/media-$STAMP.tar.gz"

mkdir -p "$DEST"
chmod 700 "$DEST" || true

fail() {
    echo "[backup] ERROR: $1" >&2
    rm -f "$DUMP.part" "$TAR.part" "$DUMP.age.part" "$TAR.age.part"
    exit 1
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

# --- Media (documentos subidos). Los estaticos se regeneran en el build: fuera.
if [ -d "$MEDIA" ] && [ -n "$(ls -A "$MEDIA" 2>/dev/null)" ]; then
    tar -czf "$TAR.part" -C "$(dirname "$MEDIA")" "$(basename "$MEDIA")" \
        || fail "el tar de la media fallo"
    mv "$TAR.part" "$TAR"
    chmod 600 "$TAR"
    echo "[backup] media -> $TAR ($(wc -c < "$TAR")b)"
    encrypt "$TAR"
else
    echo "[backup] media: $MEDIA vacio o inexistente, no se empaqueta"
fi

# --- Marca de exito para el healthcheck: solo aqui, con todo verificado.
touch "$DEST/.last-backup-ok"

# --- Retencion: dumps y tars (en claro o .age) con mas de KEEP dias.
find "$DEST" -maxdepth 1 \( -name 'db-*.dump' -o -name 'db-*.dump.age' \
        -o -name 'media-*.tar.gz' -o -name 'media-*.tar.gz.age' \) \
    -mtime +"$KEEP" -print -delete | sed 's/^/[backup] retencion: borrado /'

echo "[backup] hecho. Ultimos ficheros en $DEST:"
ls -lh "$DEST" | tail -4
