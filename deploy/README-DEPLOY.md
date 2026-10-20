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
   # ALLOWED_HOSTS / CSRF_TRUSTED_ORIGINS / CORS_ALLOWED_ORIGINS. Y, con el SSO
   # ya activo, cerrar la contraseña en la dirección pública (la gestión, que
   # llega por la IP interna, sigue entrando con contraseña):
   #   AUTH_PASSWORD_BLOCKED_HOSTS=fleetdrivers.gransolar-app.com
   sudo docker compose up -d --build back jobs   # la imagen trae xmlsec1 y djangosaml2
   curl -s https://fleetdrivers.gransolar-app.com/api/v1/auth/config/   # "saml_enabled": true, "password_enabled": false
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
# desde la aplicación —el /admin de Django va apagado (DJANGO_ADMIN_ENABLED)—
# y ningún arranque la pisa. Para forzarla desde
# el entorno: ADMIN_PASSWORD nueva + ADMIN_UPDATE_PASSWORD=True en back/.env.prod y
docker compose up -d back        # la reaplica; luego vuelve a poner False
#   (un `restart` no relee el env_file: hace falta el `up`)

# Panel /admin de Django: va APAGADO (DJANGO_ADMIN_ENABLED=False en
# back/.env.prod) porque la operación se hace desde gestión y en producción
# solo sería una puerta de login más: /admin/ devuelve 404. Enciéndelo
# PUNTUALMENTE para lo único que no se hace desde gestión, conceder el
# superusuario: pon DJANGO_ADMIN_ENABLED=True y
docker compose up -d back        # (el `up` relee el env_file; `restart` no)
# El collectstatic del arranque recoge solo entonces los estáticos del panel,
# así que se ve con sus estilos sin ningún paso extra. Concedido el privilegio,
# vuelve a False y repite el `up`.

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
| FE-4 | CSP en modo `Report-Only` en gestión (mirar la consola del navegador antes de hacerla bloqueante) | `front-gestion/nginx/gestion-server.conf` |
| — | Gestión por **https** con la CA corporativa, opcional (`COMPOSE_FILE` + `GESTION_TLS_DIR`); HSTS solo por https vía `map $scheme $hsts` | `docker-compose.gestion-tls.yml`, `front-gestion/nginx.tls.conf`, §7 |

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
- **Cookies `Secure`** (A15): siguen a `False` por el http interno de gestión.
  El TLS interno ya está preparado (§7); al activarlo, vuelven a `True`.

## 7. Gestión por HTTPS (certificado de la CA corporativa)

Gestión se sirve por defecto en **http** (`GESTION_BIND:GESTION_PORT`, VPN).
Para servirla por **https con un nombre del DNS interno** y un certificado
emitido por la CA de la empresa hay un override opcional que **no cambia nada
hasta que se activa en el `.env`**:

| Fichero | Qué es |
|---|---|
| `front-gestion/nginx/gestion-http.conf` | `upstream` al back y el `map $scheme $hsts` (HSTS solo en https). Lo incluyen las dos variantes. |
| `front-gestion/nginx/gestion-server.conf` | TODO lo que se sirve (cabeceras, proxy `/api`, `/static`, `/media`, SPA). Lo incluyen las dos variantes, así http y https sirven lo mismo. |
| `front-gestion/nginx.conf` | Variante **http** (la de la imagen): `listen 80` + snippets. |
| `front-gestion/nginx.tls.conf` | Variante **https**: `:443` con TLS 1.2/1.3, HTTP/2 y caché de sesión; `:80` solo con la sonda `/healthz` y `301` a https. |
| `docker-compose.gestion-tls.yml` | Override: monta `nginx.tls.conf` sobre la config de la imagen, monta `GESTION_TLS_DIR` en `/etc/nginx/certs` (solo lectura) y publica el 443 en `GESTION_BIND`. |

Lo que llega al back no cambia de forma: nginx manda `X-Forwarded-Proto` con el
esquema **real** (`$scheme`), nunca el del cliente, y Django lo acepta porque
`SECURE_BEHIND_PROXY=True` activa `SECURE_PROXY_SSL_HEADER`. Django **no**
redirige a https (`SECURE_SSL_REDIRECT=False`): lo hace el `:80` de nginx, y
con dos redirecciones habría bucle. HSTS sale **solo** de nginx y **solo** por
https (`SECURE_HSTS_SECONDS=0` en el back).

En lo que sigue, `<nombre>` es el nombre del DNS interno (p. ej.
`gestionflota.empresa.local`), que IT tiene que apuntar a la IP interna del
servidor (`GESTION_BIND`).

### 7.1 Clave y CSR, en el servidor

La clave privada **se genera en el servidor y no sale de él**; a IT solo se le
envía el `.csr`. Carpeta fuera del repo y del volumen de datos:

```bash
sudo mkdir -p /mnt/data/flota/tls && cd /mnt/data/flota/tls

# Clave RSA 2048 (sin contraseña: la lee el master de nginx al arrancar).
sudo openssl genrsa -out gestion.key 2048
sudo chown root:root gestion.key && sudo chmod 600 gestion.key

# CSR con CN y subjectAltName=DNS:<nombre> (sin SAN, los navegadores lo rechazan).
sudo openssl req -new -key gestion.key -out gestion.csr \
  -subj "/CN=<nombre>" \
  -addext "subjectAltName=DNS:<nombre>"

sudo openssl req -in gestion.csr -noout -text | grep -A1 "Subject Alternative Name"
#   DNS:<nombre>
```

Envía `gestion.csr` a IT pidiendo un certificado de **servidor** para ese
nombre, en PEM, **con la cadena de intermedias**.

### 7.2 Montar `gestion.crt` con la cadena y fijar permisos

`gestion.crt` = certificado del servidor y, debajo, las intermedias de la CA
corporativa **en ese orden**, y **sin la raíz** (la raíz la tienen ya los
clientes: incluirla solo engorda el handshake). Si IT manda un solo fichero
ya encadenado, cópialo tal cual.

```bash
cd /mnt/data/flota/tls
sudo sh -c 'cat servidor.pem intermedia.pem > gestion.crt'   # lo que mande IT

# El certificado es de ESTA clave (los dos hashes tienen que coincidir):
sudo openssl x509 -in gestion.crt -noout -modulus | openssl md5
sudo openssl rsa  -in gestion.key -noout -modulus | openssl md5
# La cadena se verifica contra la CA del sistema (la raíz corporativa debe
# estar instalada en el servidor; si no, pásala con -CAfile raiz.pem):
sudo openssl verify -untrusted gestion.crt gestion.crt

# Permisos: con cap_drop ALL (CFG-8) el master de nginx corre como root pero
# SIN DAC_OVERRIDE, así que la clave tiene que ser SUYA y legible solo por él.
sudo chown root:root gestion.crt gestion.key
sudo chmod 644 gestion.crt
sudo chmod 600 gestion.key
ls -l /mnt/data/flota/tls
#   -rw-r--r-- root root gestion.crt
#   -rw------- root root gestion.key
```

### 7.3 Activar el override en el `.env` de infra

Antes, comprueba que el **443 está libre en esa IP** (el nginx del host no
existe, pero otro proyecto o `cloudflared` podrían tenerlo):

```bash
ss -tln | grep -E "(0\.0\.0\.0|\*|$(grep ^GESTION_BIND .env | cut -d= -f2)):443 " \
  && echo "443 OCUPADO: elige otro GESTION_HTTPS_PORT" || echo "443 libre"
```

En `.env` (el de la raíz del proyecto, **no** `back/.env.prod`):

```bash
COMPOSE_FILE=docker-compose.yml:docker-compose.gestion-tls.yml
GESTION_TLS_DIR=/mnt/data/flota/tls
GESTION_HTTPS_PORT=443          # opcional; es el valor por defecto
# GESTION_BIND ya debe ser la IP interna del servidor (la de <nombre> en el DNS)
```

`GESTION_TLS_DIR` es **obligatoria** con el override: sin ella el compose se
niega a arrancar (`${GESTION_TLS_DIR:?...}`), a propósito. Si
`GESTION_HTTPS_PORT` no es 443, la redirección del `:80` (`https://<nombre>/`,
sin puerto) no llega: la sonda y el 443 funcionan igual, pero habrá que entrar
escribiendo el puerto.

### 7.4 Levantar y validar

```bash
cd /mnt/data/proyectos/2026/flota
docker compose config --services            # tiene que listar los 7 de siempre
docker compose config | sed -n '/front-gestion:/,/^  [a-z]/p' | grep -E "nginx.tls|certs|443"
#   .../front-gestion/nginx.tls.conf -> /etc/nginx/conf.d/default.conf (ro)
#   /mnt/data/flota/tls              -> /etc/nginx/certs (ro)
#   published 443 en GESTION_BIND

docker compose up -d front-gestion          # recrea solo ese contenedor
docker compose exec front-gestion nginx -t  # "syntax is ok" + "test is successful"
docker compose ps front-gestion             # healthy (la sonda sigue en :80)

curl -sI https://<nombre>/ | grep -iE "^HTTP|strict-transport"
#   HTTP/2 200
#   strict-transport-security: max-age=31536000
curl -sI http://<nombre>:8093/ | grep -iE "^HTTP|^location"
#   HTTP/1.1 301 Moved Permanently
#   Location: https://<nombre>/
curl -s  http://127.0.0.1:8093/healthz      # ok   (la sonda, sin redirigir)
curl -sI http://<nombre>:8093/ | grep -i strict-transport || echo "sin HSTS en http: correcto"
```

Si `nginx -t` falla por la clave («permission denied»), repasa los permisos
de §7.2. Si `curl` se queja del certificado, es que la raíz corporativa no
está en el almacén del cliente desde el que pruebas (o la cadena de
`gestion.crt` está incompleta: `openssl s_client -connect <nombre>:443
-servername <nombre> </dev/null | grep -E "s:|i:"` enseña lo que sirve).

### 7.5 El back, cuando https ya responde

Con el `curl -I https://<nombre>/` en verde, y **solo entonces**, el back
tiene que conocer el nombre nuevo y marcar las cookies como seguras. Los
cuatro cambios están explicados en `back/.env.prod.example`, bloque «Gestión
por HTTPS»: `<nombre>` en `ALLOWED_HOSTS`; `https://<nombre>` en
`CSRF_TRUSTED_ORIGINS` y `CORS_ALLOWED_ORIGINS`; `FRONTEND_BASE_URL=https://<nombre>`;
y `SESSION_COOKIE_SECURE=True` + `CSRF_COOKIE_SECURE=True` (cierra la deuda A15
de §6.2). ⚠️ **Las cookies `Secure` antes de tener https rompen el login**: el
navegador no guarda la cookie de sesión por http y se entra en bucle. Después:

```bash
docker compose up -d back                   # un `restart` no relee el env_file
curl -s https://<nombre>/api/health/        # {"status":"ok"}
```

y entra en gestión desde la VPN por `https://<nombre>/`.

### 7.6 Renovar el certificado

```bash
sudo openssl x509 -in /mnt/data/flota/tls/gestion.crt -enddate -noout
#   notAfter=...
```

Con el nuevo certificado de IT (misma clave, así que la CSR de §7.1 sirve;
si se genera clave nueva, repite §7.1 y §7.2): sustituye `gestion.crt`, deja
los permisos como en §7.2 y reinicia **solo** el contenedor del front, que es
quien lo tiene cargado en memoria:

```bash
docker compose restart front-gestion
docker compose exec front-gestion nginx -t
echo | openssl s_client -connect <nombre>:443 -servername <nombre> 2>/dev/null | openssl x509 -noout -enddate
```

Para **volver a http**: comenta las tres líneas de §7.3 en `.env`,
`docker compose up -d front-gestion`, y deshaz §7.5 en `back/.env.prod`
(sobre todo las cookies `Secure`, o el login deja de funcionar por http) +
`docker compose up -d back`.

## 8. Modo DEMO: los datos de prueba en el despliegue

Con **`FLEET_DEMO=True`** en el `.env` de infra, el back y los jobs trabajan
sobre **otra base de datos del mismo Postgres** (`FLEET_DEMO_DB_NAME`, por
defecto `<DB_NAME>_demo`) con los datos de prueba de desarrollo
(`back/SEED_DEV.md`: `admin`, `sara`, `carlos`…, las matrículas `1234KLM`,
`8888TRX`…). Con **`False`** todo apunta a la de producción, que **no se toca
en ningún momento**: no se copia, no se vacía, no se escribe en ella. Cambiar
el flag solo cambia a qué BD se conecta la aplicación.

Qué pasa en el arranque del back con el flag a `True` (`back/entrypoint.sh`):

1. `ensure_demo_db` crea la BD demo si no existe (conecta a `postgres` con el
   mismo usuario; la de producción no interviene).
2. `migrate` y `collectstatic`, sobre la demo.
3. `seed_dev_data --if-empty`: siembra **solo si la demo está vacía**. Lo que
   se toque en la demo sobrevive al siguiente `up`; para empezar de cero,
   `FLEET_DEMO_RESEED=True` resiembra (borra y recrea) en cada arranque. El
   seed es **todo o nada** (una transacción): si un paso falla, la demo queda
   vacía y el siguiente arranque lo reintenta, en vez de arrancar a medias.
4. `bootstrap_admin` de siempre: si `ADMIN_USERNAME` coincide con un usuario
   del seed (`admin`), lo deja como está (`ADMIN_UPDATE_PASSWORD=False`), así
   que entra con la contraseña del seed.

Candados (si fallan, el contenedor **no arranca** y lo dice en el log):

- `FLEET_DEMO_DB_NAME` distinto de `DB_NAME` (settings lo rechaza).
- `seed_dev_data` solo siembra si la BD activa **es** la demo.
- **`FLEET_SEED_PASSWORD` es obligatoria**: la contraseña de desarrollo está en
  el repositorio y la app de conductores es pública; en modo demo todos los
  usuarios sembrados (también `admin`, superusuario) usan la del entorno.

Lo que **no** cambia con el flag, y conviene tener en cuenta antes de encender
una demo en el servidor: la **media** (`./data/media`), Redis, Drive, Gmail,
Jira y el push son los mismos en los dos modos. La media compartida tiene dos
consecuencias: lo que se suba en la demo se queda en la carpeta de producción
(y entra en su backup; Django nunca pisa un fichero existente, le añade un
sufijo), y por eso en modo demo **el admin no salta la comprobación de
`/media`**: solo se sirve un binario si existe su `Document` en la BD activa,
para que el admin de la demo —cuya contraseña conoce quien la prueba— no se
baje por URL ficheros de producción. Una demo con Drive configurado
**archiva de verdad** (un documento `pendiente_archivar` del seed crea su
carpeta en el Drive real); los correos de alerta salen de verdad, a los buzones
ficticios `@flota.dev` del seed; y con SAML desplegado los usuarios del seed no
existen en el IdP (entran solo por contraseña, que en el dominio público está
bloqueada por `AUTH_PASSWORD_BLOCKED_HOSTS`). El **backup** sigue volcando la de
producción: la demo se regenera con un flag.

```bash
# Encender la demo (en .env de infra):
#   FLEET_DEMO=True
#   FLEET_SEED_PASSWORD=<una contraseña que no sea la del repositorio>
docker compose up -d back jobs           # relee el .env; `restart` NO
docker compose logs -f back              # "[entrypoint] MODO DEMO: ..." + "Datos de prueba sembrados"
docker compose exec db psql -U flota -d postgres -c '\l'   # flota y flota_demo
curl -s http://127.0.0.1:8093/api/health/

# Resembrar la demo desde cero (una vez):
#   FLEET_DEMO_RESEED=True  → docker compose up -d back → volver a False

# Volver a producción:
#   FLEET_DEMO=False
docker compose up -d back jobs           # la BD de producción, tal y como estaba

# Borrar la demo cuando ya no haga falta (opcional; solo la demo):
docker compose exec db psql -U flota -d postgres -c 'DROP DATABASE flota_demo;'
```

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
