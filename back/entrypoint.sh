#!/bin/sh
# Arranque del backend en producción.
#   1) migraciones   2) estáticos   3) admin único (desde el entorno)   4) gunicorn
set -e

echo "[entrypoint] Aplicando migraciones..."
python manage.py migrate --noinput

echo "[entrypoint] Recopilando estáticos..."
python manage.py collectstatic --noinput

# Crea/actualiza el único administrador desde ADMIN_USERNAME/ADMIN_PASSWORD.
# OPS3: si falla, el arranque FALLA — un `|| echo` escondía placeholders y
# dejaba el sistema sin administrador (y sin superusuario del purge N7).
echo "[entrypoint] Aprovisionando administrador..."
python manage.py bootstrap_admin

WORKERS="${GUNICORN_WORKERS:-3}"
TIMEOUT="${GUNICORN_TIMEOUT:-60}"
# CFG-12: formato de access-log SIN la query string. El de serie de gunicorn
# lleva %(r)s (la línea de petición entera) y dejaba en `docker logs` el
# `?code=...&state=...` del callback OAuth de Google y el `?SAMLResponse=` del
# SSO. %(U)s es solo la ruta. Se conserva lo útil: IP directa (%(h)s, el nginx),
# X-Forwarded-For (la cadena con el cliente real), método, ruta, estado, bytes,
# segundos y user-agent.
ACCESS_LOG_FORMAT='%(h)s xff="%({x-forwarded-for}i)s" "%(m)s %(U)s" %(s)s %(b)s %(L)ss "%(a)s"'
echo "[entrypoint] Arrancando gunicorn (workers=${WORKERS}, timeout=${TIMEOUT})..."
exec gunicorn config.wsgi:application \
    --bind 0.0.0.0:8000 \
    --workers "${WORKERS}" \
    --timeout "${TIMEOUT}" \
    --access-logfile - \
    --access-logformat "${ACCESS_LOG_FORMAT}" \
    --error-logfile -
