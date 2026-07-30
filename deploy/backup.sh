#!/bin/sh
# Backup de Flota (OPS2): la BD es POSTGRES en el volumen `flota_pgdata` —
# copiar ./data NO la incluye. Este script vuelca la BD con pg_dump (formato
# custom, comprimido) y empaqueta la media, con retención.
#
# Uso (desde la raíz del repo desplegado, con el .env de infra presente):
#   sh deploy/backup.sh [directorio-destino]   # por defecto ./backups
#
# Cron del host (ejemplo, diario a las 03:30):
#   30 3 * * *  cd /srv/flota && sh deploy/backup.sh /srv/backups/flota >> /var/log/flota-backup.log 2>&1
#
# Restauración (probada con un dump de dev):
#   docker compose exec -T db pg_restore -U "$DB_USER" -d "$DB_NAME" --clean --if-exists < backups/db-<fecha>.dump
#   tar -xzf backups/media-<fecha>.tar.gz -C .
set -eu

DEST="${1:-./backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"

# Credenciales desde el .env de infra (mismas que usa el compose).
if [ -f .env ]; then
  DB_NAME="$(grep -E '^DB_NAME=' .env | cut -d= -f2- || true)"
  DB_USER="$(grep -E '^DB_USER=' .env | cut -d= -f2- || true)"
fi
DB_NAME="${DB_NAME:-flota}"
DB_USER="${DB_USER:-flota}"

mkdir -p "$DEST"

echo "[backup] $(date -Iseconds) BD → $DEST/db-$STAMP.dump"
docker compose exec -T db pg_dump -U "$DB_USER" -d "$DB_NAME" --format=custom \
  > "$DEST/db-$STAMP.dump"

# Media (documentos subidos). Los estáticos se regeneran en el build: fuera.
if [ -d ./data/media ]; then
  echo "[backup] media → $DEST/media-$STAMP.tar.gz"
  tar -czf "$DEST/media-$STAMP.tar.gz" ./data/media
fi

# Retención: borra dumps y tars con más de N días.
find "$DEST" -maxdepth 1 \( -name 'db-*.dump' -o -name 'media-*.tar.gz' \) \
  -mtime +"$RETENTION_DAYS" -delete

echo "[backup] hecho. Contenido actual:"
ls -lh "$DEST" | tail -5
