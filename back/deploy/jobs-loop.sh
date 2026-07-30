#!/bin/sh
# Planificador del servicio `jobs` del compose (OPS1).
#
# Todos los comandos son idempotentes (dedup_key en alertas, estados en Drive y
# Jira), así que la estrategia es simple y robusta: ejecutarlo TODO cada
# FLEET_JOBS_INTERVAL segundos (15 min por defecto) en vez de replicar un cron
# multi-cadencia. Un fallo de un comando no tumba el bucle ni al resto.
set -u

INTERVAL="${FLEET_JOBS_INTERVAL:-900}"

run() {
  echo "[jobs] $(date -Iseconds) manage.py $*"
  python manage.py "$@" || echo "[jobs] AVISO: 'manage.py $*' falló (se reintenta en ${INTERVAL}s)"
}

echo "[jobs] arrancado (intervalo ${INTERVAL}s)"
while :; do
  # Motor de alertas: ITV + seguro + km + sin conductor + proyección (N2 incluida).
  run run_fleet_jobs
  # Archivado en Drive de documentos pendientes (HU-4.2). Sin credenciales: no-op.
  run archive_pending_documents
  # Jira (Épica 8 / Fase A2). Sin FLEET_JIRA_ENABLED: no-op.
  run import_vehicle_requests
  run sync_jira_requests
  sleep "$INTERVAL"
done
