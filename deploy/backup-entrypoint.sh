#!/bin/sh
# Arranque del servicio `backup` del compose (imagen postgres:16-alpine, BusyBox):
# instala el cron, lanza un backup inicial y deja crond en primer plano.
#
# Por qué existe: hasta el 15-sep-2026 flota no tenía NINGUNA copia (auditoría
# srvgcptd). El deploy/backup.sh anterior era un cron del host que nunca llegó a
# instalarse. Ahora el backup es un servicio más del compose, visible en
# `docker ps` con su healthcheck, igual que en sap-budget y list.
#
# Dos detalles que ya nos han mordido en los otros dos proyectos:
#  · cron NO hereda el entorno de docker: las variables PG*/BACKUP_* se vuelcan a
#    un fichero sourceable, bien entrecomillado, que la línea de cron carga antes
#    de ejecutar backup.sh.
#  · el horario se escribe con printf, no con echo entre comillas simples: el
#    crontab de sap-budget empezaba literalmente por "$BACKUP_CRON" y crond lo
#    rechazaba («bad minute»), con lo que nunca se ejecutó nada.
#
# El marcador /backups/.last-backup-ok lo escribe backup.sh SOLO tras verificar
# el dump; es lo que mira el healthcheck del compose.
set -eu
umask 077

CRON="${BACKUP_CRON:-30 3 * * *}"
DEST="${BACKUP_DIR:-/backups}"
KEEP="${BACKUP_KEEP_DAYS:-30}"
ENVFILE=/tmp/backup.env

# --- Volcado sourceable de PG* / BACKUP_* (sin BACKUP_CRON, que solo es el horario).
#     Cada valor entre comillas simples con las internas escapadas ( ' -> '\'' ).
: > "$ENVFILE"
for name in $(printenv | grep -E '^(PG|BACKUP_)' | sed 's/=.*//' | grep -vx 'BACKUP_CRON'); do
    eval "value=\${$name}"
    escaped=$(printf '%s' "$value" | sed "s/'/'\\\\''/g")
    printf "export %s='%s'\n" "$name" "$escaped" >> "$ENVFILE"
done
# pg_dump vive en /usr/local/bin y el PATH de crond es mínimo.
printf "export PATH='%s'\n" "$PATH" >> "$ENVFILE"

# --- Crontab de BusyBox: /etc/crontabs/root, SIN campo de usuario.
mkdir -p /etc/crontabs
printf '%s . %s; sh /deploy/backup.sh >> /proc/1/fd/1 2>>/proc/1/fd/2\n' "$CRON" "$ENVFILE" > /etc/crontabs/root
chmod 0600 /etc/crontabs/root

echo "[backup] cron: $CRON -> $DEST (keep $KEEP dias)"

# --- Backup inicial: el entorno ya está presente (lo inyecta docker). No debe
#     tumbar el arranque si falla: el cron lo reintentará y el healthcheck avisará.
sh /deploy/backup.sh || echo "[backup] AVISO: el backup inicial ha fallado; el cron lo reintentara" >&2

# crond de BusyBox: -f primer plano, -l nivel de log (5 = anuncia cada disparo;
# el 8 por defecto solo errores), -L destino (stdout del contenedor, así cada
# ejecución del cron queda en `docker logs`).
exec crond -f -l 5 -L /dev/stdout
