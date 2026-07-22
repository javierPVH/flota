# Indicaciones: seeding de datos de prueba en desarrollo (Flota / Django)

## 1. Regla mental de partida

- El seeding **no vive en migraciones ni en el entrypoint de Docker**. Vive en el
  hook de arranque `FleetConfig.ready()` → [`fleet/apps.py`](./fleet/apps.py),
  que lanza el comando `seed_dev_data` (la cadena completa de `reset_*`).
- El patrón es **destructivo (wipe & recreate)**, NO "insertar si vacío". Cada
  seed borra TODAS las filas de sus modelos y las vuelve a crear. Nunca asumas
  idempotencia acumulativa: la garantía es que tras cada ejecución el estado es
  siempre el mismo.
- Solo se ejecuta bajo **`runserver`** (desarrollo) con **`FLEET_SEED_DATA=True`**.
  Bajo gunicorn/Docker no corre (no existe `RUN_MAIN='true'`), y en tests,
  `migrate` o `shell` tampoco.

## 2. Cómo activarlo/desactivarlo

Flag en [`.env`](./.env.example):

| Variable | Efecto |
|----------|--------|
| `FLEET_SEED_DATA=True` | Activa la cadena de seeding en cada arranque de `runserver` **y** el login de desarrollo (selector de usuarios). |
| `DEBUG=True` | Requisito: el flag **se ignora sin DEBUG** (`settings.py` lo fuerza: `FLEET_SEED_DATA = DEBUG and env_bool(...)`). |

Se lanza con `python manage.py runserver`. Cada paso es también ejecutable
suelto:

```bash
python manage.py seed_dev_data          # cadena completa (pide el flag; --force lo salta)
python manage.py reset_users            # un paso concreto
python manage.py reset_vehicles
```

## 3. Anatomía de un seed (patrón a copiar)

La lógica vive en [`fleet/services/seed.py`](./fleet/services/seed.py) (funciones
`seed_*`); los comandos `reset_*` son envoltorios finos. Plantilla de una función:

```python
def seed_cosa(stdout=None) -> None:
    wipe(Cosa, stdout)                       # 1) BORRA todo el modelo
    duenio = User.objects.get(username="carlos")   # 2) resuelve dependencias
    Cosa.objects.create(owner=duenio, ...)         # 3) crea registros fijos
```

Y del comando (`fleet/management/commands/reset_cosa.py`):

```python
class Command(BaseCommand):
    help = "Seed de desarrollo: cosas (borra y recrea)."

    def handle(self, *args, **kwargs):
        try:
            seed.seed_cosa(self.stdout)
            self.stdout.write(self.style.SUCCESS("Seed [cosa] OK."))
        except Exception as exc:   # el arranque no debe romperse por un seed
            self.stdout.write(self.style.ERROR(f"Seed [cosa] falló: {exc}"))
```

Reglas al escribir/modificar uno:

- Empieza **siempre** con `wipe(Modelo, stdout)` (helper en `seed.py` =
  `Model.objects.all().delete()`). Si borrar todo es demasiado, usa un
  `.filter(...).delete()` acotado.
- Todo envuelto en `try/except` que imprime el error pero **no lo relanza** (el
  arranque no debe romperse por un seed fallido).
- Los datos de referencia se resuelven con `User.objects.get(username=...)` /
  `Vehicle.objects.get(plate=...)` → por eso el **orden importa** (punto 4).
- Valores **fijos y deterministas**; las fechas se calculan relativas a hoy
  (`timezone.localdate()`) para que las alertas de ITV/km siempre "salten".

## 4. Respetar el ORDEN de dependencias

El orden de `SEED_CHAIN` en `fleet/services/seed.py` no es arbitrario; refleja
las FK. Si añades un modelo, insértalo en el punto correcto:

```
users → catalogs → vehicles → contracts (y lecturas de km)
      → assignments (reparto de uso, vínculos de sustitución)
      → operations (eventos/ITV, incidencias, documentos, facturas, solicitudes)
      → alerts (el MOTOR REAL regenera la bandeja sobre lo sembrado)
```

Nunca crees un registro cuya FK aún no se ha sembrado.

## 5. Cómo AÑADIR un nuevo seed (checklist)

1. Escribe `seed_<entidad>(stdout=None)` en `fleet/services/seed.py` siguiendo la
   plantilla del punto 3 (empieza por `wipe(...)`).
2. Insértala en `SEED_CHAIN` en la **posición correcta según sus FK**.
3. Crea `fleet/management/commands/reset_<entidad>.py` (envoltorio con
   `try/except`; copia cualquier `reset_*` existente).
4. Verifica en aislado: `python manage.py reset_<entidad>` antes de confiar en
   el arranque.
5. Añade/ajusta los asserts de `fleet/tests/test_seed.py` (¡sin depender de las
   alertas exactas: las regenera el motor!).

## 6. Datos fijos que ya asume el sistema (no los rompas)

**Usuarios de referencia** — muchos seeds hacen `get(username=...)`; si los
renombras rompes la cadena. Contraseña de prueba de TODOS: **`flota-dev-2026`**.

| Usuario | Rol(es) | Situación sembrada |
|---------|---------|--------------------|
| `admin` | admin (superuser) | Administradora "Alicia" |
| `sara`  | supervisor + driver | Su grupo: `1234KLM` y `5678BCD`; conduce `7890NPQ` |
| `carlos`| driver | Conduce `1234KLM` (y tiene una **propuesta** pendiente) |
| `lucia` | driver | Conduce `5678BCD` (en taller, cubierto por el Leaf de sustitución) |
| `david` | driver | **SIN coche** → prueba el portón; solicitud `pending` con ticket **`FLT-123`** |
| `nuevo` | *(sin rol)* | Simula el auto-alta por Google → prueba el portón desde cero |

**Vehículos**: `1234KLM` (activo, proyección de km **en exceso**, ITV a 10 días),
`5678BCD` (en taller, **ITV vencida**, vínculo de sustitución activo), `7890NPQ`
(sin lectura de km este mes → alerta), `4567JKL` (sustitución), `0000ZZZ` (baja).

Al final siempre corre `seed_alerts`, que **borra las alertas y ejecuta el motor
real** (`alerts.run_all()`): la bandeja refleja exactamente lo sembrado. No
escribas asserts que dependan del número exacto de alertas.

## 7. Login de desarrollo en los fronts (saltarse Google)

Con el mismo flag activo, `GET /api/v1/auth/config/` devuelve
`dev_login_enabled: true` y se abre `GET|POST /api/v1/auth/dev-login/`:

- `GET` → lista de usuarios activos (username, nombre, roles) para pintar un
  **selector** en la pantalla de login del front (conductores y gestión).
- `POST {"username": "carlos"}` → inicia la **sesión real** como ese usuario,
  sin contraseña ni Google. Cambiar de usuario = volver a hacer POST.

Fuera de desarrollo (sin `DEBUG` **y** el flag) el endpoint responde **404**,
como si no existiera. El front solo pinta el selector si `dev_login_enabled`
viene a `true`.

Prueba rápida por curl:

```bash
curl -s http://127.0.0.1:8000/api/v1/auth/dev-login/ | jq
curl -s -c c.txt http://127.0.0.1:8000/api/v1/auth/csrf/
curl -s -b c.txt -H "X-CSRFToken: $(grep csrftoken c.txt | cut -f7)" \
     -H "Content-Type: application/json" \
     -d '{"username":"david"}' http://127.0.0.1:8000/api/v1/auth/dev-login/
```

## 8. Avisos críticos (para no causar daño)

- 🔴 **Nunca actives `FLEET_SEED_DATA=True` fuera de desarrollo**: borra tablas
  enteras en cada arranque → pérdida total de datos reales. Hay tres candados
  (el flag exige `DEBUG`, el comando re-comprueba `DEBUG`, y el hook solo corre
  bajo `runserver`+`RUN_MAIN`), pero el flag no debe salir de tu `.env` local.
- Guardas anti doble ejecución: `RUN_MAIN=='true'` + variable global `_seeded`
  (`fleet/apps.py`). Si necesitas sembrar desde otro proceso, llama al comando
  directamente (`manage.py seed_dev_data --force`) en vez de confiar en
  `ready()`.
- La suite de tests NO usa el seeding (crea sus propios datos); `test_seed.py`
  lo cubre explícitamente.
