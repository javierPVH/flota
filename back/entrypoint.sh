#!/bin/sh
# Arranque del backend en producción.
#   1) migraciones   2) estáticos   3) admin único (desde el entorno)   4) gunicorn
set -e

echo "[entrypoint] Aplicando migraciones..."
python manage.py migrate --noinput

echo "[entrypoint] Recopilando estáticos..."
python manage.py collectstatic --noinput

# Crea/actualiza el único administrador desde ADMIN_USERNAME/ADMIN_PASSWORD.
# No debe tumbar el arranque: si falla, se avisa y se continúa para poder depurar.
echo "[entrypoint] Aprovisionando administrador..."
python manage.py bootstrap_admin || echo "[entrypoint] AVISO: bootstrap_admin falló (revisa ADMIN_USERNAME/ADMIN_PASSWORD)."

WORKERS="${GUNICORN_WORKERS:-3}"
TIMEOUT="${GUNICORN_TIMEOUT:-60}"
echo "[entrypoint] Arrancando gunicorn (workers=${WORKERS}, timeout=${TIMEOUT})..."
exec gunicorn config.wsgi:application \
    --bind 0.0.0.0:8000 \
    --workers "${WORKERS}" \
    --timeout "${TIMEOUT}" \
    --access-logfile - \
    --error-logfile -
