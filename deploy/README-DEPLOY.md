# Despliegue de Flota en srvgcptd (Docker + Cloudflare Tunnel)

El servidor **no tiene nginx de host**: la entrada pública es un **Cloudflare
Tunnel** (`cloudflared`, en red host) y cada proyecto se publica en un puerto de
loopback. Flota sigue ese patrón y es **autocontenida**: no toca el nginx
compartido de otros proyectos ni `web_proxy_net`.

```
                 ┌─────────────────────────── Docker (compose "flota") ───────────────────────────┐
Internet ──► Cloudflare Tunnel ──► 127.0.0.1:8092 ─► front-conductores (nginx) ─┐
             (cloudflared, host)                                                 ├─► back (gunicorn, interno :8000)
VPN / LAN ─────────────────────► 127.0.0.1:8093 ─► front-gestion (nginx) ───────┘        │
                                  (GESTION_BIND)                                          └─ volumen ./data (BD, media, estáticos)
```

- Cada front sirve su **SPA** y hace de **proxy de `/api`** hacia el back por la
  red interna. `/static` y `/media` salen del volumen `./data` (solo lectura).
- **conductores** → público por el túnel. **gestión** → solo interna/VPN, **no**
  entra en el túnel. El **back** no publica ningún puerto al host.

---

## 1. Puertos (ya comprobados en srvgcptd)

Ocupados: `80, 1433, 4001, 5000-5150, 5432, 8080, 8083, 8084, 8090, 8091, 9000, 9443`.
Flota usa **8092** (conductores) y **8093** (gestión), que están libres. Verifica:

```bash
for p in 8092 8093; do ss -tln | grep -q ":$p " && echo "$p OCUPADO" || echo "$p libre"; done
```

## 2. Configurar el entorno

```bash
cd flota

cp .env.example .env
#   GESTION_BIND=127.0.0.1  -> cámbialo a 10.3.4.6 (IP interna) para llegar por VPN
#   (no hay perfiles: el `up` levanta el back y LOS DOS fronts)

cp back/.env.prod.example back/.env.prod
#   - SECRET_KEY:  python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"
#   - ALLOWED_HOSTS / *_ORIGINS: tu dominio de conductores + el host de gestión (IP/DNS interno)
#   - ADMIN_USERNAME / ADMIN_PASSWORD / ADMIN_EMAIL
```

Carpeta de datos con permisos del usuario del contenedor (uid **10001**):

```bash
mkdir -p data
sudo chown -R 10001:10001 data
```

## 3. Construir y levantar

```bash
docker compose up -d --build     # db, redis, back, jobs, gestión Y conductores
docker compose ps
docker compose logs -f back      # migraciones + creación del admin
```

`docker compose ps` debe listar **seis** servicios; si falta `front-conductores`,
no está corriendo este compose (o se nombraron servicios sueltos en el `up`).
Para levantar solo una de las dos apps:

```bash
docker compose up -d --build back jobs front-conductores
docker compose up -d --build back jobs front-gestion
```

Arranque del back: `migrate` → `collectstatic` → `bootstrap_admin` (crea el admin
desde `ADMIN_*`) → `gunicorn`. En producción **no se siembran datos de prueba**;
el único registro inicial es el administrador.

Comprobación dentro del servidor:

```bash
curl -s http://127.0.0.1:8092/healthz              # ok  (nginx conductores)
curl -s http://127.0.0.1:8093/healthz              # ok  (nginx gestión)
curl -s http://127.0.0.1:8092/api/health/          # {"status":"ok"}  (proxy -> back)
```

## 4. Publicar conductores en el Cloudflare Tunnel

Tu túnel usa un `config.yml` local. Añade la regla de `deploy/cloudflared/ingress.example.yml`
a la lista `ingress:` (antes del `- service: http_status:404` final):

```yaml
  - hostname: flota-conductores.gransolar.com     # tu dominio real
    service: http://localhost:8092
```

Crea el DNS del hostname y recarga:

```bash
# Si gestionas rutas por CLI (ajusta el nombre del túnel):
cloudflared tunnel route dns <tunel> flota-conductores.gransolar.com
sudo docker restart cloudflared
```

> El túnel entra por `http://localhost:8092`, así que `CONDUCTORES_BIND` tiene
> que seguir cubriendo el loopback: `127.0.0.1` (por defecto) o `0.0.0.0`. Usa
> `0.0.0.0` si además quieres abrir conductores desde la VPN para probarlo. Si
> lo fijas a la IP interna a secas (`10.3.4.6`), el loopback deja de publicarse
> y el túnel se queda sin destino hasta que cambies el `service:` del ingress.

> Gestión **no** se añade al túnel. Se accede por la VPN a
> `http://<IP-interna-o-DNS>:8093` (recuerda poner ese host en `ALLOWED_HOSTS` y
> en `CSRF_TRUSTED_ORIGINS`). Para que la VPN llegue, `GESTION_BIND` debe ser la
> IP interna (p. ej. `10.3.4.6`), no `127.0.0.1`.

## 5. Operación

```bash
docker compose up -d --build     # redeploy
docker compose restart back
docker compose logs -f back

# Cambiar contraseña del admin: edita ADMIN_PASSWORD en back/.env.prod y:
docker compose up -d back        # bootstrap_admin la re-sincroniza

# Jobs del back (ITV, seguro, km, alertas, Drive, Jira): los ejecuta el
# servicio `jobs` del compose cada 15 min (idempotentes; OPS1). Para forzar uno:
docker compose exec back python manage.py run_fleet_jobs
docker compose logs -f jobs

# Backup (OPS2): BD Postgres (volumen flota_pgdata) + media, con retención.
sh deploy/backup.sh /srv/backups/flota
# Cron del host recomendado (diario 03:30):
#   30 3 * * *  cd /srv/flota && sh deploy/backup.sh /srv/backups/flota >> /var/log/flota-backup.log 2>&1
# Restaurar:
#   docker compose exec -T db pg_restore -U flota -d flota --clean --if-exists < backups/db-<fecha>.dump
#   tar -xzf backups/media-<fecha>.tar.gz -C .
```

## Notas

- **BD**: **PostgreSQL** en el volumen Docker `flota_pgdata` (servicio `db` del
  compose). ⚠️ Copiar `./data` NO incluye la BD: `./data` solo tiene media y
  estáticos.
- **Backups**: `deploy/backup.sh` — `pg_dump` de la BD + tar de la media, con
  retención (`BACKUP_RETENTION_DAYS`, 14 días por defecto). Prueba la
  restauración al configurarlo (comandos en el propio script).
- **RGPD (conductores es público)**: resuelto (SEC3) — `/media` ya NO se sirve
  por ruta directa: nginx reenvía a Django, que exige sesión y responde con
  `X-Accel-Redirect` a una location `internal`. No requiere configuración.
- **Push (N9)**: para activar las notificaciones push genera un par VAPID
  (`python -m py_vapid --gen`) y define `WEBPUSH_VAPID_PUBLIC_KEY`,
  `WEBPUSH_VAPID_PRIVATE_KEY` y `WEBPUSH_CONTACT` en `back/.env` (ver
  `back/.env.prod.example`). Sin claves, el push queda deshabilitado sin error.
- **Correo saliente (N10a)**: define `EMAIL_HOST`/`EMAIL_PORT`/`EMAIL_HOST_USER`/
  `EMAIL_HOST_PASSWORD`/`DEFAULT_FROM_EMAIL` para los avisos por email (seguro →
  renting, km → conductor). Sin `EMAIL_HOST` el envío es un no-op con traza.
- **Cookies no-Secure**: es a propósito porque gestión va por http interno; ver
  la explicación en `back/.env.prod.example`. Si pones TLS interno a gestión,
  vuelve a `SESSION_COOKIE_SECURE=True` y `CSRF_COOKIE_SECURE=True`.
