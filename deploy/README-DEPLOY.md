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
  red interna. `/static` y `/media` salen del volumen `./data` (solo lectura, y
  **solo esas dos subcarpetas**: `data/secrets/` y `data/saml/` no se montan en
  los nginx — CFG-4).
- **conductores** → público por el túnel. **gestión** → solo interna/VPN, **no**
  entra en el túnel. El **back** no publica ningún puerto al host.
- **Dos redes** (CFG-5): `frontend` (los dos nginx + back) y `backend` (back,
  jobs, db, redis, backup). Un nginx no alcanza la BD ni Redis; Redis lleva
  contraseña (`REDIS_PASSWORD`).

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
#   DB_PASSWORD           -> obligatoria (sin '$')
#   REDIS_PASSWORD        -> OBLIGATORIA (CFG-5): openssl rand -hex 32
#                            Sin ella el compose no arranca (a propósito).
#   CONDUCTORES_BIND      -> 127.0.0.1 en el servidor (CFG-13): el túnel entra por
#                            localhost:8092 y NADA más debe alcanzar ese puerto.
#   BACKUP_AGE_RECIPIENT  -> clave pública age1... (CFG-6, ver §6.1). Vacía =
#                            backups en claro (el log lo avisa).
#   GESTION_BIND=127.0.0.1 -> cámbialo a la IP interna del servidor para llegar por VPN
#   (no hay perfiles: el `up` levanta el back y LOS DOS fronts)

cp back/.env.prod.example back/.env.prod
#   - SECRET_KEY:  python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"
#   - ALLOWED_HOSTS / *_ORIGINS: tu dominio de conductores + el host de gestión
#     (sustituye IP_INTERNA_DEL_SERVIDOR por la IP/DNS interno real)
#   - ADMIN_USERNAME / ADMIN_PASSWORD / ADMIN_EMAIL
#   - SECURE_HSTS_SECONDS=0 y TRUSTED_PROXY_COUNT=2 se quedan como están (explicados ahí)
```

Carpeta de datos con permisos del usuario del contenedor (uid **10001**).
**Crea también `media/` y `staticfiles/`**: desde CFG-4 los nginx montan solo
esas dos subcarpetas, y si no existieran Docker las crearía como root y el back
(`appuser`) no podría escribir en `media/`:

```bash
mkdir -p data/media data/staticfiles
sudo chown -R 10001:10001 data
```

## 3. Construir y levantar

```bash
docker compose up -d --build     # db, redis, back, jobs, gestión Y conductores
docker compose ps
docker compose logs -f back      # migraciones + creación del admin
```

`docker compose ps` debe listar **siete** servicios (db, redis, back, jobs,
backup y los dos fronts); si falta `front-conductores`,
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
  - hostname: fleetdrivers.gransolar-app.com     # tu dominio real
    service: http://localhost:8092
```

Crea el DNS del hostname y recarga:

```bash
# Si gestionas rutas por CLI (ajusta el nombre del túnel):
cloudflared tunnel route dns <tunel> fleetdrivers.gransolar-app.com
sudo docker restart cloudflared
```

> El túnel entra por `http://localhost:8092`, así que `CONDUCTORES_BIND` tiene
> que cubrir el loopback. **En el servidor pon `CONDUCTORES_BIND=127.0.0.1`
> en el `.env`** (CFG-13): es el valor por defecto y el único que deja el puerto
> alcanzable SOLO desde cloudflared, que es quien pone el TLS y el filtro
> delante. `0.0.0.0` abre además el puerto en claro a toda la LAN/VPN (solo
> para una prueba puntual, y vuelve atrás). Si lo fijas a la IP interna a
> secas, el loopback deja de publicarse y el túnel se queda sin destino hasta
> que cambies el `service:` del ingress.

> Gestión **no** se añade al túnel. Se accede por la VPN a
> `http://<IP-interna-o-DNS>:8093` (recuerda poner ese host en `ALLOWED_HOSTS` y
> en `CSRF_TRUSTED_ORIGINS`). Para que la VPN llegue, `GESTION_BIND` debe ser la
> IP interna del servidor, no `127.0.0.1`.

### 4.1 Entrada de conductores por SSO (SAML contra Google Workspace)

En producción la PWA entra **solo** por el SSO corporativo. Quién entra lo
decide la app, no Google: **únicamente un correo ya dado de alta en Flota y
activo**; si no existe, no se abre sesión y la PWA enseña el modal que manda a
abrir el Jira de solicitud de vehículo (`FLEET_JIRA_REQUEST_URL`). Nunca se
crean usuarios desde el SSO.

1. **Consola de Google** (superadministrador, `admin.google.com`): crear la app
   SAML personalizada con los valores de `docs/SAML_CONDUCTORES.md`:
   - ACS URL: `https://fleetdrivers.gransolar-app.com/api/v1/auth/saml/acs/`
   - Entity ID: `https://fleetdrivers.gransolar-app.com/api/v1/auth/saml/metadata/`
   - Name ID: correo principal, formato `EMAIL`; atributos `email`,
     `first_name`, `last_name`; «Respuesta firmada» sin marcar.
   - Activar la app para el grupo/unidad de los conductores (tarda hasta 24 h).
   - **Descargar metadatos** (XML) y traerlo al servidor.
2. **Servidor**:

   ```bash
   cd /mnt/data/proyectos/2026/flota
   sudo mkdir -p data/saml
   sudo cp ~/google_idp_metadata.xml data/saml/google_idp_metadata.xml
   sudo chown -R 10001:10001 data/saml && sudo chmod 400 data/saml/google_idp_metadata.xml
   # back/.env.prod: bloque SAML_* (ver back/.env.prod.example) y el dominio en
   # ALLOWED_HOSTS / CSRF_TRUSTED_ORIGINS / CORS_ALLOWED_ORIGINS.
   sudo docker compose up -d --build back jobs   # la imagen trae xmlsec1 y djangosaml2
   curl -s https://fleetdrivers.gransolar-app.com/api/v1/auth/config/   # "saml_enabled": true
   curl -s https://fleetdrivers.gransolar-app.com/api/v1/auth/saml/metadata/ | head -3
   ```

3. **Prueba**: abrir `https://fleetdrivers.gransolar-app.com/` → «Entrar con mi
   cuenta corporativa» → Google → vuelve con sesión (usuario existente) o con el
   modal «Aún no tienes acceso» (correo sin alta). Un fallo de firma o de
   entity id vuelve con `?saml=error`; el motivo real está en
   `docker compose logs back | grep saml`.

Detalles: sin cierre de sesión único (Google no lo soporta en apps SAML
personalizadas: salir de la app no cierra Google); el certificado del IdP
caduca y hay que renovarlo en `data/saml/` cuando el administrador lo rote.

## 5. Operación

```bash
docker compose up -d --build     # redeploy
docker compose restart back
docker compose logs -f back

# Contraseña del admin (CFG-14): bootstrap_admin corre en cada arranque, pero
# con ADMIN_UPDATE_PASSWORD=False (el valor del ejemplo y el recomendado) la
# contraseña del entorno SOLO se usa al crear el usuario; después se cambia
# desde la aplicación o /admin y ningún arranque la pisa. Para forzarla desde
# el entorno: ADMIN_PASSWORD nueva + ADMIN_UPDATE_PASSWORD=True en back/.env.prod y
docker compose up -d back        # la reaplica; luego vuelve a poner False
#   (un `restart` no relee el env_file: hace falta el `up`)

# Jobs del back (ITV, seguro, km, alertas, Drive, Jira): los ejecuta el
# servicio `jobs` del compose cada 15 min (idempotentes; OPS1). Para forzar uno:
docker compose exec back python manage.py run_fleet_jobs
docker compose logs -f jobs

# Backup (OPS2): lo hace el servicio `backup` del compose, solo: un dump al
# arrancar y después cada BACKUP_CRON (03:30 UTC por defecto), a BACKUP_HOST_DIR
# (en srvgcptd: /mnt/data/backups/flota, OTRO disco que el de la BD).
docker compose ps backup                 # debe estar "healthy": crond vivo + backup de < 26 h
docker compose logs --tail 20 backup     # "[backup] BD hecha y verificada -> ..." o el motivo del fallo
ls -la /mnt/data/backups/flota           # db-<fecha>.dump[.age], media-<fecha>.tar.gz[.age] y .last-backup-ok
# Forzar uno ahora:
docker compose exec backup sh -c '. /tmp/backup.env; sh /deploy/backup.sh'
# Restaurar (si están cifrados, primero descifra con la clave PRIVADA, que no
# está en el servidor: cópiala de forma temporal y bórrala al acabar, ver §6.1):
#   age -d -i flota-backup.key -o db-<fecha>.dump /mnt/data/backups/flota/db-<fecha>.dump.age
#   age -d -i flota-backup.key -o media-<fecha>.tar.gz /mnt/data/backups/flota/media-<fecha>.tar.gz.age
#   docker compose exec -T db pg_restore -U flota -d flota --clean --if-exists < db-<fecha>.dump
#   tar -xzf media-<fecha>.tar.gz -C ./data
```

## 6. Seguridad del despliegue (auditoría de ciberseguridad, sep-2026)

Lo que aplica el `docker-compose.yml` y los `nginx.conf` sin nada que
configurar, salvo las variables del `.env` que se indican:

| Código | Qué | Dónde |
|---|---|---|
| CFG-4 | Los nginx montan solo `data/media` y `data/staticfiles` (no `data/secrets`, `data/saml`) | `docker-compose.yml` |
| CFG-5 | Redis con `requirepass` (`REDIS_PASSWORD`, obligatoria) y redes `frontend`/`backend` | `docker-compose.yml`, `.env` |
| CFG-6 | Backups cifrados con `age` si `BACKUP_AGE_RECIPIENT` está definida | `deploy/backup.sh`, `.env` |
| CFG-8 | `cap_drop: [ALL]` en back, jobs, redis y los dos nginx (+ las mínimas de vuelta) | `docker-compose.yml` |
| CFG-10/SRV-5 | `server_tokens off`; HSTS solo desde el nginx de conductores (`SECURE_HSTS_SECONDS=0`); sin cabeceras duplicadas en `/api` | `nginx.conf` × 2, `back/.env.prod` |
| CFG-12 | El access-log de gunicorn no registra la query string (`?code=`, `?SAMLResponse=`) | `back/entrypoint.sh` |
| CFG-13/AUTH-5 | `X-Forwarded-Proto` fijo a `https` en conductores; `CONDUCTORES_BIND=127.0.0.1` | `front-conductores/nginx.conf`, `.env` |
| FE-4 | CSP en modo `Report-Only` en gestión (mirar la consola del navegador antes de hacerla bloqueante) | `front-gestion/nginx.conf` |

### 6.1 Backups cifrados (`age`)

El dump lleva datos personales (conductores, permisos, partes de accidente), así
que en el servidor **debe** ir cifrado. Es cifrado a **clave pública**: el
servidor solo conoce la pública (`age1...`) y no puede descifrar lo que guarda.

```bash
# En TU equipo (no en el servidor). age: https://github.com/FiloSottile/age
age-keygen -o flota-backup.key
#   Public key: age1qxyz...        <- esto es BACKUP_AGE_RECIPIENT
```

- La **clave privada** (`flota-backup.key`) se guarda **fuera del servidor**, en
  el gestor de contraseñas del equipo (con una copia en otro sitio: sin ella
  los backups no valen nada). Nunca en el repo ni en `/mnt/data`.
- En el `.env` del servidor: `BACKUP_AGE_RECIPIENT=age1qxyz...` y
  `docker compose up -d backup`. El entrypoint instala `age` (`apk add`) al
  arrancar; el siguiente backup sale como `.dump.age` / `.tar.gz.age`, con
  permisos `0600` y la carpeta `0700`. Si se pidió cifrar y no se puede, el
  backup **falla** (healthcheck en rojo) en vez de guardarse en claro.
- Para restaurar, descifra con `age -d -i flota-backup.key` (comandos en §5) en
  un equipo de confianza o copiando la clave al servidor solo durante la
  restauración.
- Sin la variable, el backup sigue funcionando en claro y lo avisa en cada
  pasada (`[backup] AVISO: BACKUP_AGE_RECIPIENT vacio`).

### 6.2 Pendiente (valorado y NO aplicado a ciegas en producción)

- **nginx sin root** (`nginxinc/nginx-unprivileged`): obliga a cambiar la
  imagen base de los dos `Dockerfile`, el `listen 80` → `8080`, el
  `HEALTHCHECK` y los `ports` del compose a la vez. Se hará en una ventana con
  prueba; mientras, los nginx corren como root con las cuatro capacidades
  mínimas (CFG-8).
- **`read_only: true`** en los contenedores (con `tmpfs` para `/tmp`,
  `/var/cache/nginx`, `/var/run`…): hay que inventariar qué escribe cada imagen.
- **Imágenes por digest** (`postgres:16-alpine@sha256:...`, `redis`, `nginx`,
  `node`, `python`): fija exactamente lo que se despliega, pero exige un proceso
  de actualización (Renovate/Dependabot) para no quedarse sin parches.
- **`cap_drop` en `db` y `backup`**: el entrypoint de postgres hace `chown` de
  PGDATA y baja de root (`CHOWN, DAC_OVERRIDE, FOWNER, SETGID, SETUID`), y el
  `crond` de BusyBox necesita `setgroups` para lanzar cada job. Probarlo primero
  en local con un volumen de prueba.
- **CSP bloqueante en gestión**: pasar `Content-Security-Policy-Report-Only` a
  `Content-Security-Policy` cuando la consola del navegador no enseñe
  violaciones con el Picker de Drive y el login de Google en uso.
- **Cookies `Secure`** (A15): siguen a `False` por el http interno de gestión;
  pendiente de TLS interno.

## Notas

- **BD**: **PostgreSQL** (servicio `db`) en la carpeta del host `PGDATA_HOST_DIR`
  (en srvgcptd `/mnt/data/flota/pgdata`), montada como volumen bind
  `flota_flota_pgdata`. ⚠️ Copiar `./data` NO incluye la BD: `./data` solo
  tiene media y estáticos. **Mover la BD de sitio** (p. ej. de un volumen
  interno a `/mnt/data`): `docker compose down` (sin `-v`) →
  `rsync -a <origen>/ <destino>/` como root (conserva el uid de postgres) →
  comparar con `du -s` → `docker volume rm flota_flota_pgdata` → poner
  `PGDATA_HOST_DIR` en `.env` → `docker compose up -d`. Con un dump reciente a
  mano antes de empezar.
- **Backups**: servicio `backup` del compose (imagen `postgres:16-alpine`, la
  misma que `db`, así `pg_dump` es siempre la versión del servidor).
  `deploy/backup-entrypoint.sh` instala el cron y `deploy/backup.sh` hace el
  trabajo: `pg_dump` en formato custom a `.part`, verificación con
  `pg_restore --list` y tamaño mínimo, tar de la media, marcador
  `.last-backup-ok` y retención (`BACKUP_KEEP_DAYS`, 30 días), cifrado con
  `age` si hay `BACKUP_AGE_RECIPIENT` (§6.1). El healthcheck
  del servicio se pone en rojo si no hay un backup verificado en 26 h. Variables
  en `.env` (`BACKUP_HOST_DIR`, `BACKUP_KEEP_DAYS`, `BACKUP_CRON`,
  `BACKUP_AGE_RECIPIENT`). Hasta el
  15-sep-2026 no había ninguna copia: el script era un cron del host que nunca
  se instaló (auditoría srvgcptd). Prueba la restauración al configurarlo.
- **RGPD (conductores es público)**: resuelto (SEC3) — `/media` ya NO se sirve
  por ruta directa: nginx reenvía a Django, que exige sesión y responde con
  `X-Accel-Redirect` a una location `internal`. No requiere configuración.
- **Push (N9)**: para activar las notificaciones push genera un par VAPID
  (`python -m py_vapid --gen`) y define `WEBPUSH_VAPID_PUBLIC_KEY`,
  `WEBPUSH_VAPID_PRIVATE_KEY` y `WEBPUSH_CONTACT` en `back/.env` (ver
  `back/.env.prod.example`). Sin claves, el push queda deshabilitado sin error.
- **Correo saliente (N10a/N10b)**: en srvgcptd la red de GCP **no deja salir a
  25/465/587** (comprobado el 16-sep-2026: solo 80/443), así que SMTP no sirve.
  Flota envía como `list`: por la **API de Gmail (HTTPS)** con el token OAuth de
  un solo buzón. En `back/.env.prod`: `GMAIL_OAUTH_ENABLED=True`,
  `GMAIL_OAUTH_TOKEN_FILE=/app/data/secrets/gmail-oauth-token.json` y
  `GMAIL_SENDER=<buzón>`; el token va en `data/secrets/` (uid 10001, modo 400,
  la misma carpeta que la clave de Drive) y se genera con
  `manage.py get_gmail_oauth_token` en un PC con navegador (o se reutiliza el
  de `list`, que es el mismo buzón `digitaltransformation@gransolar.com`). Tras
  tocar el `.env.prod`: `docker compose up -d back jobs` (un `restart` no relee
  el `env_file`). Prueba: `docker compose exec back python manage.py shell -c
  "from django.core.mail import send_mail; print(send_mail('Prueba flota',
  'ok', None, ['tu@gransolar.com']))"` → `1`. La alternativa SMTP
  (`EMAIL_HOST`…) sigue existiendo para un servidor con salida al 587. Sin
  ninguno de los dos, el envío es un no-op con traza.
- **Cookies no-Secure**: es a propósito porque gestión va por http interno; ver
  la explicación en `back/.env.prod.example`. Si pones TLS interno a gestión,
  vuelve a `SESSION_COOKIE_SECURE=True` y `CSRF_COOKIE_SECURE=True`.
