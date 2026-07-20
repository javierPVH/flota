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

| Rol          | Front        | Red      | Puede |
|--------------|--------------|----------|-------|
| `admin`      | gestión      | **VPN**  | CRUD completo de la flota, aprovisionar usuarios y roles |
| `supervisor` | gestión      | **VPN**  | Gestión de la flota (vehículos, asignaciones, reparto de uso) |
| `driver`     | conductores  | internet | Ver **solo** su(s) vehículo(s) asignado(s) (lectura) |

Los roles son **multi-rol**: una persona puede acumular varios (p. ej.
supervisor que además conduce). Se modelan en `accounts.UserRole` (mapea la tabla
`driver_roles` del DBML) y una persona = un `User` (mapea `drivers`). `admin` o
`supervisor` ⇒ acceso al front de gestión; `driver` ⇒ front de conductores.

La separación por red la impone el despliegue (nginx/firewall/VPN), pero el
**backend no se fía de la red**: cada endpoint está protegido por rol
(`accounts/permissions.py` → `IsAdmin`/`IsSupervisor`/`IsManagement`/`IsDriver`)
y el queryset del conductor está acotado a lo suyo. Además, cada front rechaza en
el login a quien no le corresponde y su `bootstrap` de sesión trata como anónimo
a un rol ajeno.

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

Crear usuarios de prueba rápido (uno por rol; los roles son multi-rol):

```bash
python manage.py shell -c "
from accounts.models import User, UserRole, Role
admin = User.objects.create_superuser(username='admin', email='a@x.com', password='pass12345')
sup = User.objects.create_user(username='sup', password='pass12345', first_name='Sara')
UserRole.objects.create(user=sup, role=Role.SUPERVISOR)
drv = User.objects.create_user(username='carlos', password='pass12345', first_name='Carlos')
UserRole.objects.create(user=drv, role=Role.DRIVER)
"
```

Los usuarios y sus roles se aprovisionan desde el admin de Django (`/admin/`,
roles inline) o por shell: el **registro público está desactivado** por defecto
(`AUTH_REGISTRATION_ENABLED=False`) porque el front de conductores da a internet.
El self-registro, si se activa, crea siempre un `driver`.

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

## Modelo de dominio (app `fleet`)

Modelado completo del esquema (DBML) en `back/fleet/` (`models/` por áreas +
`enums.py`):

- **Vehículo** (`Vehicle`): matrícula, marca/modelo/versión/año, estado,
  combustible, tipo, tamaño, segmento, uso, propiedad, supervisor, sustitución…
- **Catálogos**: `Country`, `BusinessUnit`, `Project`, `Pep` (CECO), `Renting`.
- **Contratos y km**: `Contract`, `KmReading`.
- **Asignación y uso**: `Assignment` (conductor↔vehículo, con estado
  propuesta→aceptada/rechazada→finalizada), `VehicleUsage` (reparto %),
  `VehicleLink` (principal↔sustituto).
- **Eventos**: `Event` + subtipos 1-a-1 (`EventPenalty`, `EventFeeChange`,
  `EventItv`, `EventProjectChange`, `EventLocationChange`, `EventPepChange`,
  `EventDriverChange`).
- **Facturación**: `Invoice`, `InvoiceAllocation` (imputación a proyecto/PEP).

Todo es administrable desde `/admin/`. Por ahora solo `Vehicle` tiene API REST
(`/api/vehicles/`); el resto son modelos + admin, a la espera de exponer
endpoints según se vaya necesitando.

> **Nota:** los dos fronts (`front-gestion`/`front-conductores`) todavía usan el
> contrato anterior (rol único, `assigned_driver`). Con el nuevo esquema el `/me`
> devuelve `roles` (lista) y el vehículo ya no lleva conductor directo (va por
> `Assignment`). Actualizar los fronts a este contrato es el siguiente paso.

## Tests

```bash
cd back && .venv/bin/python manage.py test      # 30 tests
npm run typecheck                                # typecheck de ambos fronts
npm run build                                    # build DS + ambos fronts
```
