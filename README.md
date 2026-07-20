# Flota

Gestión de flota de vehículos. Monorepo con **un backend** y **dos frontends**,
basado en el design-system / stack de [`@gs/base`](../base) (Django 5.2 + DRF y
React 19 + Vite + SASS). El código del DS se ha **copiado** a `front/` (paquete
`@flota/ui`), por lo que este repo es autónomo e independiente de `base`.

```
flota/
├── back/               # API Django + DRF (auth sesión/CSRF, roles, app fleet)
├── front/              # @flota/ui — copia del DS de @gs/base (React 19)
├── front-gestion/      # SPA de GESTIÓN     → solo VPN     (admin + admin_flota)
└── front-conductores/  # SPA de CONDUCTORES → internet     (conductor)
```

## Roles y accesos

| Rol                     | Front            | Red      | Puede |
|-------------------------|------------------|----------|-------|
| `admin`                 | gestión          | **VPN**  | CRUD completo de la flota, aprovisionar usuarios |
| `admin_flota`           | gestión          | **VPN**  | CRUD completo de la flota |
| `conductor`             | conductores      | internet | Ver **solo** su(s) vehículo(s) asignado(s) (lectura) |

La separación por red la impone el despliegue (nginx/firewall/VPN), pero el
**backend no se fía de la red**: cada endpoint está protegido por rol
(`accounts/permissions.py`) y el queryset del conductor está acotado a lo suyo.
Además, cada front rechaza en el login a quien no le corresponde y su `bootstrap`
de sesión trata como anónimo a un rol ajeno.

## Arranque en desarrollo

**1) Backend** (`:8000`)

```bash
cd back
python -m venv .venv && source .venv/bin/activate   # (el repo ya trae uno)
pip install -r requirements.txt                      # si creas el venv de cero
cp .env.example .env                                 # DEBUG=True por defecto
python manage.py migrate
python manage.py createsuperuser                     # crea un admin
python manage.py runserver
```

Crear usuarios de prueba rápido (uno por rol):

```bash
python manage.py shell -c "
from accounts.models import User
User.objects.create_superuser(username='admin', email='a@x.com', password='pass12345', role=User.Role.ADMIN)
User.objects.create_user(username='gestor', password='pass12345', role=User.Role.FLEET_MANAGER)
User.objects.create_user(username='carlos', password='pass12345', role=User.Role.DRIVER)
"
```

Los `conductor` y `admin_flota` se aprovisionan desde el admin de Django
(`/admin/`) o por shell: el **registro público está desactivado** por defecto
(`AUTH_REGISTRATION_ENABLED=False`) porque el front de conductores da a internet.

**2) Fronts** (desde la raíz `flota/`, workspaces npm)

```bash
npm install                 # instala los 3 paquetes (hoisted)
npm run build:ui            # compila @flota/ui una vez (front-*/ lo consumen)
npm run dev:gestion         # → http://localhost:5173  (gestión)
npm run dev:conductores     # → http://localhost:5174  (conductores)
```

Cada front lee el origen del back de `VITE_BACKEND_BASE_URL` (ver
`front-*/.env.example`). En dev, CORS del back ya permite `:5173` y `:5174`.

## Despliegue (split VPN / internet)

Se despliega **un** backend y se sirven los dos fronts como sitios estáticos
distintos, cada uno tras su propio nginx/host:

- `gestion.flota.interno` → `front-gestion/dist`, **solo alcanzable por VPN**
  (regla de firewall / server block restringido a la red interna).
- `flota.empresa.com` → `front-conductores/dist`, público en internet.
- Ambos hablan con el mismo `/api` del backend. Si el conductor puede llegar al
  API desde internet, el backend igualmente le corta todo lo que no sea leer su
  vehículo (permisos por rol). Endurecer en `back/.env`: `SESSION_COOKIE_SECURE`,
  `CSRF_COOKIE_SECURE`, `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`,
  `CSRF_TRUSTED_ORIGINS`, `SECURE_HSTS_SECONDS`.

## Módulo de dominio actual

Primer recurso end-to-end: **Vehículos** (`fleet.Vehicle`) con matrícula, marca,
modelo, año, estado (activo/mantenimiento/retirado), observaciones y **conductor
asignado**. La gestión hace el CRUD; el conductor consulta su asignación. Punto
de partida para ir copiando más lógica de negocio.

## Tests

```bash
cd back && .venv/bin/python manage.py test      # 29 tests
npm run typecheck                                # typecheck de ambos fronts
npm run build                                    # build DS + ambos fronts
```
