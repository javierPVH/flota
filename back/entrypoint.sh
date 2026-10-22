#!/bin/sh
# Arranque del backend en producción.
#   1) migraciones   2) estáticos   3) admin único (desde el entorno)   4) gunicorn
set -e

# Modo DEMO (FLEET_DEMO=True en el .env de infra, ver deploy/README-DEPLOY.md):
# settings apunta a OTRA base de datos del mismo Postgres (FLEET_DEMO_DB_NAME),
# que aquí se crea si no existe y, tras migrarla, se siembra con los datos de
# prueba. La de producción (DB_NAME) no se toca: con el flag a False, este
# mismo arranque vuelve a ella tal y como estaba.
DEMO=0
case "$(printf '%s' "${FLEET_DEMO:-}" | tr '[:upper:]' '[:lower:]')" in
  1|true|yes|on) DEMO=1 ;;
esac
if [ "$DEMO" = 1 ]; then
  echo "[entrypoint] MODO DEMO: base de datos '${FLEET_DEMO_DB_NAME:-${DB_NAME}_demo}' (la de producción NO se toca)."
  python manage.py ensure_demo_db
fi

echo "[entrypoint] Aplicando migraciones..."
python manage.py migrate --noinput

# --clear vacía STATIC_ROOT antes de recopilar: lo que ya no está instalado
# (los estáticos del admin de Django, que solo existe con DJANGO_ADMIN_ENABLED)
# no se queda en el volumen que nginx sirve en /static/. Sin eso, un
# collectstatic de cuando el admin estuvo encendido seguía publicando
# /static/admin/ para siempre. Solo `back` recopila (`jobs` no), así que no hay
# dos procesos vaciando la misma carpeta.
echo "[entrypoint] Recopilando estáticos..."
python manage.py collectstatic --noinput --clear

if [ "$DEMO" = 1 ]; then
  # Resiembra en cada arranque solo si se pide (FLEET_DEMO_RESEED); si no, solo
  # cuando la BD demo está vacía (recién creada). Si falla, el arranque FALLA.
  case "$(printf '%s' "${FLEET_DEMO_RESEED:-}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on)
      echo "[entrypoint] MODO DEMO: resembrando (FLEET_DEMO_RESEED=True, borra y recrea)..."
      python manage.py seed_dev_data --force ;;
    *)
      echo "[entrypoint] MODO DEMO: sembrando si la BD demo está vacía..."
      python manage.py seed_dev_data --if-empty ;;
  esac
fi

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
