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
      → operations (eventos/ITV, incidencias, consumos de combustible,
                    planes de mantenimiento, documentos, facturas, solicitudes)
      → erratas (N7: desactivaciones de varios tipos + usuario inactivo)
      → alerts (el MOTOR REAL regenera la bandeja sobre lo sembrado)
      → comms (N9/N10: traza de correos ligada a alertas reales + push)
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
6. Si el modelo trae un enumerado nuevo, añádelo a la tabla de
   `SeedCoverageTests.test_every_enum_variant_is_seeded` — ver §6bis.

## 6. Datos fijos que ya asume el sistema (no los rompas)

**Usuarios de referencia** — muchos seeds hacen `get(username=...)`; si los
renombras rompes la cadena. Contraseña de prueba de TODOS: **`flota-dev-2026`**.

| Usuario | Rol(es) | Situación sembrada |
|---------|---------|--------------------|
| `admin` | admin (superuser) | Administradora "Alicia" |
| `sara`  | supervisor + driver | Su grupo: `1234KLM` y `5678BCD`; conduce `7890NPQ` |
| `carlos`| driver | Conduce `1234KLM` (y tiene una **propuesta** pendiente) |
| `lucia` | driver | Conduce `5678BCD` (en taller, cubierto por el Leaf) **y el propio Leaf `4567JKL`**: es el par sustituto↔principal de la app de campo |
| `david` | driver | **SIN coche** → prueba el portón; solicitud `pending` con ticket **`FLT-123`** |
| `nuevo` | *(sin rol)* | Simula el auto-alta por Google → prueba el portón desde cero |

**Vehículos**: `1234KLM` (activo, proyección de km **en exceso**, ITV a 10 días,
**seguro a 20 días**, timeline con los 18 tipos de evento y póliza versionada),
`5678BCD` (en taller, **ITV y seguro vencidos**, vínculo de sustitución activo),
`7890NPQ` (**km ilimitados**: sin proyección y, desde X2, tampoco recordatorio
de lectura), `4567JKL` (sustitución), `0000ZZZ` (baja, con `km_end` y acta de
devolución).

⚠️ El seguro de `1234KLM` se fija en DOS sitios que deben coincidir: la ficha
(`seed_vehicles`) y su documento de seguro (`seed_operations`). La señal de N2
denormaliza el documento sobre la ficha **solo hacia adelante**, así que si el
documento llevara una fecha posterior se comería el aviso de los 30 días. Lo
vigila `SeedCoverageTests.test_reference_layer_invariants_hold`.

**Capa de VOLUMEN** (constantes `BULK_*` en `seed.py`) — encima de la
referencia, cada seed añade datos masivos **deterministas** (aritmética modular
sobre el índice, sin `random`): la supervisora `marta`, **12 conductores**
(`pedro`, `ana`, `jorge`, `elena`, `raul`, `marina`, `sergio`, `nuria`, `ivan`,
`paula`, `oscar`, `teresa` — misma contraseña, y entre los 12 recorren los **6
tipos de permiso**), 3 CECOs, 6 proyectos, 2 rentings y 2 unidades más, y **30
vehículos** con matrículas `2000???`…`2029???` (`_bulk_plate(i)`), repartidos
entre los grupos de `sara`/`marta`/sin supervisor. Los 16 modelos de
`BULK_MODELS` cubren entre todos los 4 tipos, los 5 combustibles, los 3 tamaños
y los **9 segmentos de mercado**; cada vehículo lleva además bastidor, fecha de
matriculación, versión y consumo, y 1 de cada 4 ya tiene carpeta de Drive.

Los **7 estados** salen del reparto por índice (los 2 últimos en baja —con
`km_end`—, más mantenimiento, ITV, averiado, accidentado y no activo), y hay **4
sustitutos** (índices 2, 9, 16 y 23), uno por cada motivo de vínculo.

Cada vehículo arrastra: contrato de renting (si aplica) con **ritmos
~70/100/130%** del km contratado (proyecciones repartidas entre los tres
niveles) y 1 de cada 8 con un contrato anterior ya cerrado; **hasta 12 meses de
lecturas** mensuales (1 de cada 4 con la última "vieja" → alerta de lectura
pendiente); conductor vigente (1 de cada 5 sin conductor → alerta; históricos
finalizados, propuestas y alguna **rechazada**); ITV vencida/próxima/lejana;
**14 incidencias**; documentos de los **9 tipos** (seguro —1 de cada 6 con la
póliza anterior encadenada por `replaces`—, ficha técnica, permiso, contrato,
actas, parte de accidente, fotos pendientes de archivar y "otros"); **3 meses de
facturas** con reparto 100% a proyecto o CECO y alguno **mixto 70/30**; y
solicitudes de Jira en **los 5 estados** (`FLT-201`…`FLT-207` sin solicitante —
"Conceder" queda deshabilitado a propósito— y `FLT-208`…`FLT-211` **con**
solicitante, incluida una ya `assigned` sobre un vehículo real).

El seguro de cada vehículo se decide en su DOCUMENTO de seguro (la señal lo
denormaliza a `Vehicle.insurance_expiry_date`): vencido (i%8==5), próximo a <30
días (i%8 in 1,2) o lejano → bandeja de alertas de seguro (N2) con los tres
niveles. 1 de cada 5 vehículos lleva su última lectura de km **estimada** (N8b,
trazo diferenciado en la gráfica). Además, cada vehículo suma **3 eventos** que
recorren los 18 tipos y reparten los subtipos (sanciones pagadas y sin pagar,
cambios de cuota, de proyecto, de ubicación, de CECO y de conductor).

No dependas de los datos de volumen en asserts finos; para eso está la
referencia.

## 6bis. Cobertura total (el contrato del seed)

El seed garantiza que **toda tabla del dominio tiene filas** y que **toda
variante de todo enumerado aparece al menos una vez**. Lo verifica
`SeedCoverageTests` en [`fleet/tests/test_seed.py`](./fleet/tests/test_seed.py),
que comprueba presencia —nunca cantidades exactas, para que el volumen se pueda
reajustar sin romper nada:

| Test | Qué garantiza |
|------|----------------|
| `test_every_enum_variant_is_seeded` | Todas las parejas modelo/campo del listado tienen todas sus variantes. |
| `test_every_domain_table_has_rows` | Ninguna tabla de `fleet`/`accounts` se queda vacía. |
| `test_every_event_subtype_is_seeded` | Los 7 subtipos 1-a-1 de `Event`, no solo la ITV. |
| `test_erratas_space_has_one_of_each_type` | Todos los tipos desactivables (`fleet.erratas.DEACTIVATABLE`) + bajas + usuarios. |
| `test_reference_layer_invariants_hold` | Los datos de referencia de §6 siguen en pie. |

**Única excepción declarada**: `accounts.GoogleCredential` se queda vacía a
propósito. Guarda los tokens OAuth de Google (cifrados en reposo) que solo
escribe el consentimiento real del usuario; sembrar uno falso haría creer al
front que Drive está conectado y las llamadas al Picker fallarían con 401 en vez
de degradar limpiamente a "sin conectar".

Si añades un valor a un enumerado o un modelo nuevo, el test falla hasta que lo
siembres: es intencionado.

Casi al final corre `seed_alerts`, que **borra las alertas y ejecuta el motor
real** (`alerts.run_all()`): la bandeja refleja exactamente lo sembrado. No
escribas asserts que dependan del número exacto de alertas. Como el motor solo
crea alertas **abiertas**, después se cierran dos a mano —elegidas de forma
determinista por `dedup_key` entre los tipos más numerosos— para que la pestaña
de resueltas tenga contenido: una la cierra el **responsable del propio
vehículo** (la bandeja la marca en verde) y la otra `admin`, que no conduce ni
supervisa ese coche (en rojo, con el bocadillo de aviso). Los únicos estados son
`open` y `resolved`.

**Erratas y comunicaciones** (los dos últimos pasos): `seed_erratas` deja **un
ejemplo desactivado de cada tipo** de `fleet.erratas.DEACTIVATABLE` (el test
`test_erratas_space_has_one_of_each_type` lo exige: si añades un tipo, añade su
errata aquí)
— una incidencia, una lectura de km, un documento, una factura, un reparto, y
para los catálogos una fila huérfana creada a propósito (la marca `Saab` y su
modelo, la sociedad `GS-OLD`, `Renting Histórico`, el CECO `4900`, la obra
`Z-99`, la unidad `OLD`, `Andorra`) más la firma "Firma antigua (2024)" y la
plantilla genérica — y el usuario inactivo `expedro`; junto con los vehículos en
baja, la página de Erratas enseña TODOS sus grupos.

> Se desactiva siempre algo **sin uso**: si se retirara un catálogo en uso, los
> listados que filtran por `is_active` dejarían huecos raros en otras pantallas.
> La excepción obligada es `EmailTemplate`, cuya `key` es única (una fila por
> tipo): se retira la **genérica**, que es el comodín para avisos sin plantilla
> propia — los tres tipos que envían correo ya tienen la suya activa, así que
> nadie se queda mudo.

`seed_comms` deja **7 `EmailLog`** que cubren los tres estados (enviado, fallido
y omitido) y las **6 claves de plantilla**, algunos ligados a alertas reales, y
**3 `PushSubscription`** ficticias (`carlos` con móvil y tablet, `sara` con el
suyo — endpoints falsos: sin claves VAPID nadie las usa, y con ellas el push
service las poda al primer 404/410).

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
