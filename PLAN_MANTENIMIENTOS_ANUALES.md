# Plan de rediseño — mantenimientos anuales y neumáticos de sustitución

## 1. Objetivo

Sustituir la lógica actual de planes configurables por vehículo —ciclos por
kilómetros y/o meses— por un registro anual de mantenimientos obligatorios.

Además, incorporar un registro específico para los cambios de neumáticos de
sustitución. Este segundo flujo no es una obligación anual: documenta cada
intervención y qué neumáticos quedaron instalados en el vehículo.

El resultado debe permitir responder, sin reconstruir datos históricos:

- qué mantenimientos eran obligatorios para cada vehículo y año;
- cuáles están pendientes, programados, realizados o vencidos;
- cuándo, dónde y con qué kilometraje se realizaron;
- qué justificante respalda cada realización;
- quién registró o corrigió la información;
- cuál es el grado de cumplimiento anual de toda la flota.

Este documento planifica la modificación. No implica todavía cambios de código
ni de base de datos.

---

## 2. Situación actual comprobada

La implementación existente está repartida entre:

- `back/fleet/models/maintenance.py`: `MaintenancePlan` por vehículo, con
  `every_km`, `every_months`, `last_done_date` y `last_done_km`.
- `back/fleet/services/alerts.py`: calcula el siguiente vencimiento desde la
  última realización y genera alertas por meses o kilómetros.
- `back/fleet/views.py` y `back/fleet/serializers.py`: CRUD de
  `/api/v1/maintenance-plans/`.
- `front-gestion/src/components/MaintenancePlansCard.tsx`: alta, edición y
  desactivación de planes desde la ficha del vehículo.
- `back/fleet/services/reports.py`: hoja «Mantenimiento» del documento completo
  de vehículos.
- `front-gestion/src/pages/AlertsPage.tsx` y la campana del encabezado: muestran
  alertas, aunque la pantalla todavía no ofrece un cierre específico para un
  mantenimiento realizado.
- `Incident(type=maintenance)`: registra una incidencia reactiva, pero no es un
  registro anual preventivo.

Problemas para la nueva necesidad:

1. Cada vehículo puede tener un conjunto distinto de planes.
2. El plan se sobrescribe al actualizar «último realizado»; no existe una fila
   histórica e inmutable por año.
3. Un plan puede depender solo de kilómetros o tener una periodicidad distinta
   de doce meses.
4. Desactivar un plan puede eliminar de la operativa una obligación.
5. No hay una vista global de cumplimiento anual.
6. «Plan», «incidencia de mantenimiento», «alerta» y «evento» no representan hoy
   un único flujo de negocio enlazado.

---

## 3. Regla funcional propuesta

### 3.1 Interpretación de “anual, fijo y obligatorio”

El plan parte de estas reglas. Deben validarse antes de crear la primera
migración:

1. Existe un **catálogo central** de tipos de mantenimiento. No se crean planes
   arbitrarios desde cada vehículo.
2. Cada tipo activo se aplica **una vez por año natural** a todos los vehículos
   que estén en servicio, incluidos los de sustitución.
3. Cada tipo tiene una **fecha límite fija** (`mes` + `día`) común a la flota.
4. Una obligación asignada a un vehículo no se puede borrar ni marcar como
   “no aplicable” desde la ficha.
5. La obligación se conserva aunque después se retire el vehículo, para que el
   informe histórico no cambie.
6. Los ciclos por kilómetros dejan de formar parte del mantenimiento anual.
   Podrán seguir controlándose mediante kilometraje, incidencias u otra futura
   política, pero no condicionarán el cumplimiento anual. Los cambios de
   neumáticos se registran mediante el flujo específico descrito en el §12.

Si “fecha fija” debe significar aniversario de matriculación, alta o contrato,
solo cambia el cálculo de `due_date`; el resto del diseño se mantiene.

### 3.2 Estados

Estados visibles:

- **Pendiente**: obligación creada y todavía dentro de plazo.
- **Programado**: tiene fecha de cita, pero aún no consta como realizado.
- **Realizado**: tiene fecha de realización y datos de cierre.
- **Vencido**: no realizado y fecha límite anterior a hoy.

`Vencido` debe calcularse desde las fechas y no guardarse como un estado
editable. Así no hace falta un proceso que cambie filas a medianoche y se evita
que la base de datos contradiga al calendario.

Transiciones autorizadas:

```text
Pendiente ── programar ──> Programado ── registrar realización ──> Realizado
    │                           │
    └──── registrar realización ┘

Pendiente/Programado + fecha límite pasada = Vencido
```

Un registro realizado no se elimina. Una corrección deja auditoría y exige
motivo; si se decide anular una realización, la operación será exclusiva de
administración y devolverá la obligación a pendiente/vencida.

---

## 4. Modelo de datos objetivo

### 4.1 `MaintenanceDefinition` — catálogo obligatorio

Representa el conjunto fijo que se repite cada año.

| Campo | Regla |
|---|---|
| `code` | Código estable, único y no reutilizable. |
| `name` | Nombre visible del mantenimiento. |
| `description` | Alcance o checklist que debe realizar el taller. |
| `due_month` / `due_day` | Fecha límite anual fija. |
| `reminder_days` | Antelación de aviso; por defecto, la configuración global. |
| `sort_order` | Orden común en formularios e informes. |
| `is_active` | Controlado con el patrón `DeactivatableModel`. |
| auditoría | Creación, modificación, desactivación, actor y motivo. |

Una definición activa nueva no debe cambiar silenciosamente años cerrados. Al
activarla se elegirá el primer año aplicable. Al renombrarla, los registros ya
generados conservarán una copia del nombre y del código.

### 4.2 `AnnualMaintenanceRecord` — obligación e historial

Una fila por vehículo, definición y año.

| Campo | Regla |
|---|---|
| `vehicle` | Vehículo dentro del ámbito del usuario. |
| `definition` | Tipo del catálogo que originó la obligación. |
| `year` | Año natural al que corresponde. |
| `code_snapshot` / `name_snapshot` | Evitan reescribir el histórico al editar el catálogo. |
| `due_date` | Fecha límite materializada para ese año. |
| `scheduled_date` | Cita opcional. No equivale a realización. |
| `completed_date` | Fecha efectiva; determina que está realizado. |
| `completed_km` | Odómetro en la realización; opcional, validado contra lecturas. |
| `workshop` | Taller o proveedor. |
| `cost` | Importe opcional, decimal y no negativo. |
| `invoice` | Factura relacionada, opcional. |
| `document` | Justificante principal, opcional; se podrán consultar los demás documentos relacionados. |
| `notes` | Observaciones operativas. |
| `completed_by` | Usuario que registró la realización. |
| `completed_at` | Momento exacto del registro, distinto de la fecha efectiva. |
| auditoría | Timestamps y `django-auditlog`. |

Restricciones:

- unicidad de `(vehicle, definition, year)`;
- creación idempotente ante jobs concurrentes;
- `completed_date` no puede quedar en el futuro;
- `scheduled_date` no puede pertenecer a otro año salvo permiso explícito para
  citas cercanas al cambio de año;
- una factura o documento relacionado debe pertenecer al mismo vehículo;
- `completed_km` no puede ser negativo ni menor que una lectura histórica
  posterior ya registrada sin confirmar la corrección;
- el día 29 de febrero se materializa como 28 de febrero en años no bisiestos.

### 4.3 Relaciones con entidades actuales

- **Incidencia de tipo mantenimiento**: se mantiene para averías o actuaciones
  no planificadas. No completa una obligación automáticamente. Desde la
  incidencia se podrá enlazar una obligación anual si realmente corresponde.
- **Evento**: completar o anular una realización crea un `Event` de tipo
  `maintenance`, mediante un servicio de dominio y dentro de la misma
  transacción.
- **Alerta**: avisa de una obligación concreta y se cierra automáticamente al
  registrar su realización.
- **Documento**: el justificante vive en el sistema documental existente, no
  como un segundo fichero aislado.
- **Factura**: el enlace evita duplicar el coste y permite trazabilidad contable.
- **Estado “En mantenimiento” del vehículo**: no se activa por programar una
  cita. Solo cambia mediante el flujo operativo que ya inmoviliza el vehículo.

---

## 5. Servicios y API

La lógica de negocio debe residir en `back/fleet/services/maintenance.py`, no en
serializadores ni señales dispersas.

### 5.1 Operaciones de dominio

- `generate_year(year, definition_ids=None, vehicle_ids=None)`: crea, de forma
  idempotente, las obligaciones que falten.
- `ensure_vehicle_year(vehicle, year)`: cubre un vehículo dado de alta durante
  el año.
- `schedule(record, date, actor, notes)`: registra o cambia una cita.
- `complete(record, data, actor)`: valida, registra la realización, genera el
  evento y resuelve las alertas abiertas en una transacción atómica.
- `correct_completion(record, data, actor, reason)`: corrige sin perder el diff
  ni el motivo.
- `reopen(record, actor, reason)`: operación administrativa excepcional.
- `compliance_summary(queryset, year)`: totales globales y por vehículo sin N+1.

### 5.2 Endpoints previstos

| Método y ruta | Uso | Permiso |
|---|---|---|
| `GET /api/v1/maintenance-definitions/` | Consultar catálogo | Gestión y conductores, lectura acotada donde proceda |
| `POST/PATCH/DELETE /api/v1/maintenance-definitions/` | Mantener catálogo | Solo admin |
| `GET /api/v1/annual-maintenance/` | Listado global/histórico | Gestión; conductor solo sus vehículos |
| `GET /api/v1/annual-maintenance/{id}/` | Detalle | Según `vehicles_for(user)` |
| `POST /api/v1/annual-maintenance/{id}/schedule/` | Programar cita | Gestión |
| `POST /api/v1/annual-maintenance/{id}/complete/` | Registrar realización | Gestión |
| `POST /api/v1/annual-maintenance/{id}/reopen/` | Anulación excepcional | Admin + motivo |
| `POST /api/v1/annual-maintenance/generate/` | Regenerar faltantes | Admin, idempotente |
| `GET /api/v1/annual-maintenance/summary/` | KPI de cumplimiento | Gestión, acotado |

Filtros del listado:

- `year`, `status`, `vehicle`, `definition`;
- `brand`, `model`, `is_substitute`, `vehicle_state`;
- `due_from`, `due_to`, `completed_from`, `completed_to`;
- búsqueda por matrícula, nombre, código o taller;
- orden por fecha límite, realización, matrícula, tipo o coste.

No se expondrá un `PATCH` genérico capaz de marcar directamente un registro
como realizado. Las acciones de dominio garantizan evento, alerta y auditoría.

### 5.3 Job anual y alertas

`run_fleet_jobs` debe:

1. asegurar las obligaciones del año actual;
2. generar aviso `warning` cuando falten `reminder_days`;
3. escalar a `critical` al vencer;
4. resolver alertas si la obligación se completa o se reabre/corrige de modo que
   deje de corresponder;
5. usar una clave estable como
   `annual-maintenance:{record_id}:{due_date}:{level}`.

El job se ejecutará diariamente y seguirá siendo idempotente. El cambio de año
no dependerá de que una persona abra una pantalla.

---

## 6. Plan de modificación de vistas

### 6.1 Gestión — nueva vista global «Mantenimientos»

**Ruta propuesta:** `/mantenimientos`.

Es la vista principal de trabajo y evita recorrer vehículo por vehículo.

Cabecera:

- selector de año, por defecto el actual;
- KPI: total exigible, realizados, pendientes, programados y vencidos;
- porcentaje de cumplimiento;
- acción admin «Generar/revisar obligaciones del año»;
- exportación de la selección visible.

Filtros:

- estado de cumplimiento;
- tipo de mantenimiento;
- vehículo/matrícula;
- marca y modelo;
- flota o sustitución;
- estado del vehículo;
- fecha límite y fecha de realización.

Tabla con panel lateral:

- matrícula y vehículo;
- mantenimiento obligatorio;
- año y fecha límite;
- estado con badge;
- fecha programada;
- fecha realizada, kilómetros y taller;
- factura/justificante;
- acciones «Programar», «Registrar realización», «Ver ficha» y, solo para admin,
  «Corregir/reabrir».

Criterios de aceptación:

- el filtro se conserva en la URL;
- los datos se paginan y filtran en servidor;
- vencidos aparecen primero por defecto;
- ninguna acción permite completar un vehículo fuera del ámbito;
- la tabla es navegable por teclado y usa textos ES/EN desde i18n.

### 6.2 Menú, rutas y atajos de Gestión

Modificar `front-gestion/src/App.tsx`, `AppHeader.tsx`, `Layout.tsx` e i18n:

- añadir la ruta perezosa `/mantenimientos`;
- añadir «Mantenimientos» al grupo de Operaciones, con icono de herramienta;
- reservar un atajo de navegación que no colisione con los existentes;
- hacer que enlaces desde alertas, panel y vehículo abran el registro correcto,
  conservando `year`, `status` o `vehicle` en la query cuando ayude al contexto.

### 6.3 Ficha de vehículo

Reemplazar `MaintenancePlansCard` por `AnnualMaintenanceCard`.

Estado cerrado del acordeón:

- `N de M realizados` del año actual;
- badge crítico si existe algún vencido;
- siguiente fecha límite.

Estado abierto:

- selector de año y lista/checklist del catálogo obligatorio;
- fecha límite y estado de cada obligación;
- programación, realización, taller, kilómetros y justificante;
- acceso al histórico de años anteriores;
- botones «Programar» y «Registrar realización»;
- sin botones «Añadir plan» ni «Eliminar plan».

El modal de realización solicitará como mínimo fecha y confirmación. Taller,
kilómetros, coste, factura, documento y notas se mostrarán como datos
complementarios. Si el negocio exige justificante, se convertirá en campo
obligatorio mediante configuración, no con una validación exclusiva del front.

### 6.4 Listado de vehículos

Añadir una columna opcional «Mantenimiento anual»:

- `Al día`, `Pendiente`, `Programado` o `Vencido`;
- contador `realizados/total`;
- filtro rápido por estado anual;
- clic abre `/mantenimientos?vehicle={id}&year={actual}`.

La API de vehículos no debe consultar registros por fila. Se usará una
anotación/subconsulta o un endpoint de resumen en lote.

### 6.5 Panel principal

Añadir al dashboard:

- KPI de mantenimientos vencidos;
- KPI de próximos a vencer dentro del umbral;
- porcentaje de cumplimiento del año;
- bloque «Mantenimientos prioritarios» con los primeros registros vencidos o
  próximos.

Cada KPI enlaza a la vista global con filtros. El dashboard no ofrecerá un
formulario distinto: reutilizará los mismos modales/acciones o navegará al
detalle para evitar dos flujos de cierre.

### 6.6 Alertas y campana

Incluir `maintenance_due` en los filtros visibles de Alertas y en la traducción
de ambos idiomas.

Para una alerta de mantenimiento:

- mostrar mantenimiento, matrícula, año y fecha límite;
- «Ver mantenimiento» abre el registro correspondiente;
- «Registrar realización» usa la acción de dominio;
- retirar el cierre manual genérico: la alerta se resuelve al completar la
  obligación;
- si se reabre la obligación, el job puede volver a abrir el aviso adecuado.

La campana debe enlazar a `/mantenimientos` para este tipo, no solo a la ficha
general del vehículo.

### 6.7 Incidencias

Mantener la vista y el tipo actual `maintenance`, pero aclarar en UI:

- incidencia = mantenimiento reactivo/no planificado;
- obligación anual = mantenimiento preventivo obligatorio.

En el panel de una incidencia de mantenimiento se podrá mostrar «Vincular con
obligación anual» solo si el usuario decide que esa actuación cumple una de
ellas. Vincular no basta para completar: debe abrir el modal de realización y
validar sus campos.

### 6.8 Informes y Descargas

La hoja «Mantenimiento» del documento único de vehículos dejará de exportar
planes y pasará a exportar registros anuales.

Columnas mínimas:

- matrícula, marca, modelo, flota/sustitución y estado del vehículo;
- año, código y mantenimiento obligatorio;
- fecha límite, estado calculado y fecha programada;
- fecha realizada, kilómetros, taller y coste;
- factura y justificante;
- usuario y momento de registro;
- notas.

Reglas:

- respetar los filtros de marca, modelo, estado y tipo ya aplicados al documento
  completo de vehículos;
- añadir filtro de año, por defecto actual;
- conservar años históricos cuando el usuario seleccione «Todos»;
- CSV de vehículos sigue siendo una tabla plana; el XLSX mantiene la hoja
  detallada dentro del único documento.

### 6.9 Notificaciones programadas y correo

Actualizar la opción de informe de mantenimiento para que acepte:

- año;
- estado (`pending`, `scheduled`, `completed`, `overdue`);
- días hasta vencimiento;
- los filtros de flota ya existentes.

Crear una plantilla específica de recordatorio anual con variables seguras:

- vehículo, mantenimiento, año, fecha límite, días restantes y enlace interno;
- nunca interpolar HTML no confiable;
- respetar ámbito y destinatarios al generar adjuntos.

El envío seguirá el patrón `mailer.py`: best-effort, trazado en `EmailLog` y sin
interrumpir la creación de alertas.

### 6.10 Ajustes — catálogo de mantenimientos

Añadir una pestaña o bloque «Mantenimientos obligatorios» en Catálogos:

- listado ordenable de definiciones;
- alta con código, nombre, descripción y fecha límite;
- edición con advertencia de que el histórico conserva snapshots;
- desactivación con doble confirmación y motivo;
- elección explícita del último año aplicable al desactivar;
- previsualización de cuántas obligaciones se crearán al activar un tipo.

Solo admin puede mutar. No se permitirá cambiar el código después de que existan
registros; deberá crearse una nueva definición si cambia el significado.

### 6.11 Erratas

Registrar ambos nuevos tipos:

- definiciones desactivadas;
- registros anuales anulados/reabiertos, si se modelan como desactivables.

La restauración debe comprobar la restricción única antes de operar. Un registro
realizado no se purga como corrección ordinaria: se corrige o reabre con motivo.
La purga definitiva sigue reservada al superusuario.

### 6.12 Documentos y facturas

En Documentos:

- mostrar la obligación anual relacionada;
- permitir adjuntar un justificante desde el modal de realización reutilizando
  el flujo de subida existente;
- mantener archivado y permisos actuales.

En Facturas:

- mostrar el mantenimiento relacionado cuando exista;
- permitir seleccionar una factura ya asociada al mismo vehículo;
- evitar duplicar el importe en los informes de costes: `cost` será informativo
  si hay factura y la factura será la fuente contable.

### 6.13 Alta y edición de vehículo

No añadir campos de plan al formulario. Al crear o reactivar un vehículo:

- `ensure_vehicle_year` genera las obligaciones del año actual;
- si entra después de una fecha límite, la política inicial será crear la
  obligación como pendiente/vencida y dejar trazabilidad de la fecha de alta;
- no se regeneran obligaciones de años previos salvo operación administrativa.

Al retirar un vehículo no se elimina su historial ni se crean obligaciones para
años posteriores.

### 6.14 PWA de conductores — Mis vehículos y ficha móvil

Mostrar un resumen de solo lectura para los vehículos dentro del scope:

- `Al día`, próximos y vencidos;
- lista del año actual en la ficha móvil;
- fecha programada y fecha límite;
- enlace a la alerta correspondiente.

Primera entrega recomendada: el conductor puede consultar y subir un documento,
pero no marcar el mantenimiento como realizado. La validación final corresponde
a gestión. Si después se necesita una propuesta desde campo, se añadirá una
acción separada `submit-evidence`, compatible con la cola offline, que gestión
deberá aceptar.

### 6.15 PWA de conductores — Alertas y grupo del supervisor

- incluir el tipo `maintenance_due` en filtros, badges y textos ES/EN;
- el conductor no podrá cerrar manualmente la alerta;
- el supervisor verá el resumen de cumplimiento de los vehículos de su grupo;
- desde la alerta se abrirá la ficha móvil del vehículo y el mantenimiento
  concreto;
- las notificaciones Web Push no incluirán datos de vehículos fuera del scope.

### 6.16 Administración Django

Registrar los dos modelos con:

- búsqueda por matrícula, código y nombre;
- filtros por año, definición, realización y actividad;
- `list_select_related` para vehículo/definición/usuario;
- acciones masivas solo si llaman a servicios de dominio;
- campos de snapshots y auditoría como solo lectura;
- sin borrado físico ordinario.

### 6.17 Vistas sin cambio funcional

- Usuarios y detalle de usuario: no necesitan mantenimiento en esta fase.
- Kilometraje: mantiene su flujo; solo sirve como referencia al validar
  `completed_km`.
- Solicitudes y propuestas: no cambian.
- Login y control de acceso: no cambian, salvo que la nueva ruta debe quedar
  dentro de los gates existentes.

---

## 7. Migración desde `MaintenancePlan`

La migración no debe deducir datos dudosos ni borrar información.

### Fase de transición

1. Crear las nuevas tablas sin retirar `MaintenancePlan`.
2. Crear el catálogo fijo validado por negocio.
3. Implementar un comando con `--dry-run` que muestre:
   - nombres de planes existentes y vehículos afectados;
   - planes de doce meses potencialmente mapeables;
   - ciclos por kilómetros o periodicidades distintas que no encajan;
   - duplicados y anclas incompletas.
4. Aprobar un mapa explícito `plan antiguo -> definición nueva`.
5. Generar obligaciones del año actual y, solo cuando los datos sean fiables,
   registros históricos desde `last_done_date`.
6. Marcar los planes antiguos como solo lectura durante una versión.
7. Comparar recuentos, alertas e informes.
8. Desactivar el CRUD y el job antiguos; conservar los registros en auditoría o
   erratas según el patrón N7.
9. Retirar campos/código legado en una migración posterior, nunca en el mismo
   despliegue que introduce el nuevo flujo.

Los planes solo por kilómetros no se transformarán en cumplimiento anual de
forma automática. Se exportarán en el informe de migración y requerirán una
decisión explícita.

---

## 8. Pruebas necesarias

### Backend

- restricciones y validaciones de ambos modelos;
- generación anual completa, parcial, concurrente e idempotente;
- alta/reactivación/retirada de vehículo;
- cálculo de estado antes, durante y después del vencimiento;
- completar, corregir y reabrir con evento, alerta y auditoría;
- pertenencia de factura/documento al vehículo;
- scopes admin/supervisor/driver en lectura y escritura;
- bloqueo de `PATCH` directo y acceso a vehículos ajenos;
- alertas warning/critical sin duplicados;
- 29 de febrero, cambio de año y zona `Europe/Madrid`;
- informes XLSX/CSV y ausencia de N+1;
- migración `--dry-run` y mapeos ambiguos.

### Front de gestión

- filtros sincronizados con URL y selector de año;
- estados derivados, orden y KPIs;
- programación y realización con errores del servidor;
- accesibilidad de tabla, paneles, modales y badges;
- ficha del vehículo sin CRUD de planes arbitrarios;
- navegación desde dashboard, alertas, campana e informes;
- traducciones completas ES/EN.

### PWA

- scope del conductor y supervisor;
- modo offline de lectura cacheada sin mostrar datos de otro usuario;
- alerta no cerrable manualmente;
- subida de justificante con el flujo existente;
- Push y enlaces profundos a la ficha correcta.

---

## 9. Despliegue por fases

### MAN-1 — Dominio y migración segura

- modelos, enums, auditoría y admin;
- servicio de generación y estados;
- comando `--dry-run` de inventario legado;
- documentación de esquema y endpoints.

### MAN-2 — API y alertas

- ViewSets/acciones, permisos y scope;
- jobs idempotentes;
- eventos y cierre automático de alertas;
- pruebas backend completas.

### MAN-3 — Gestión operativa

- nueva vista global, ruta y menú;
- ficha de vehículo;
- listado y dashboard;
- alertas y campana.

### MAN-4 — Evidencias e información

- documentos y facturas;
- hoja del documento completo de vehículos;
- notificaciones programadas y correo;
- erratas.

### MAN-5 — Conductores y retirada del legado

- resumen y alertas en la PWA;
- validación de migración con negocio;
- desactivación de endpoints/componentes/jobs antiguos;
- actualización de `README`, `back/README.md`, `ERD.md`, `schema.dbml`,
  `QA_MANUAL.md` y seeds.

Cada fase debe terminar con `makemigrations --check`, Ruff, typecheck, lint,
tests y build de los dos frontends.

---

## 10. Criterios de cierre

La modificación se considerará terminada cuando:

- todo vehículo en servicio tenga exactamente una obligación por definición y
  año aplicable;
- no sea posible eliminar una obligación desde la ficha;
- completar un mantenimiento cree histórico, evento y cierre su alerta en una
  única operación;
- el estado anual sea consistente en ficha, listado, dashboard, alertas,
  informe y PWA;
- el documento completo de vehículos incluya el historial anual filtrado;
- los roles solo consulten o modifiquen vehículos de su ámbito;
- los planes legados estén conciliados y no exista doble generación de alertas;
- la documentación y el QA manual reflejen el flujo nuevo.

---

## 11. Decisiones que deben cerrarse antes de MAN-1

1. Confirmar si la fecha fija es común por tipo o depende de la fecha de alta,
   matriculación o contrato de cada vehículo.
2. Aprobar el catálogo inicial de mantenimientos obligatorios y sus fechas.
3. Confirmar si el justificante es obligatorio para completar.
4. Confirmar si gestión puede registrar una realización fuera de plazo o de año
   y qué aviso debe mostrarse.
5. Decidir si el conductor solo consulta/sube evidencia o puede proponer la
   realización desde la PWA.
6. Definir qué ocurre con un vehículo incorporado después del vencimiento anual.
7. Aprobar el mapeo de los `MaintenancePlan` actuales y el tratamiento de los
   planes basados únicamente en kilómetros.

---

## 12. Extensión — neumáticos de sustitución

### 12.1 Qué dejó hecho Claude

La revisión del árbol de trabajo y de `ANALISIS_GAP.md` confirma que Claude
detectó el cambio de neumáticos como **GAP-6** e inició una solución deliberadamente
pequeña.

Ya existe, aunque parte todavía está sin confirmar en Git:

- `IncidentType.TIRES = "tires"`: permite crear una incidencia de neumáticos.
- `LinkReason.TIRES`: permite indicar que un vehículo de sustitución cubre al
  principal mientras se cambian los neumáticos.
- El tipo «Neumáticos» en el formulario de Incidencias de Gestión.
- El tipo «Neumáticos» en el alta móvil de incidencias de Conductores.
- Traducciones ES/EN.
- Datos de seed con incidencias y un vínculo histórico por neumáticos.
- Una prueba API que comprueba que el tipo de incidencia es aceptado.
- Documentación parcial en `ERD.md`, `schema.dbml`, `back/README.md` y
  `QA_MANUAL.md`.

Había además un `MaintenancePlan` de seed llamado «Neumáticos» que avisaba por
kilómetros. **Resuelto (2026-08-28)**: negocio fijó la regla «los neumáticos
siempre son una avería» y el seed ya no modela neumáticos como plan — los
ciclos por km de ejemplo usan conceptos de taller («Cambio de aceite y
filtros», «Revisión de frenos») y el `help_text` del modelo ya no sugiere
«Neumáticos» como nombre de plan.

Lo que **no** está implementado:

- modelo propio de cambio de neumáticos;
- número y posición de neumáticos sustituidos;
- marca, modelo, medida o DOT de los neumáticos instalados;
- motivo técnico del cambio;
- kilometraje, taller, factura y justificante estructurados;
- consulta del juego instalado actualmente;
- histórico específico en la ficha del vehículo;
- informe propio dentro del documento completo del vehículo;
- cierre coordinado entre intervención, incidencia y sustitución de vehículo;
- validaciones y pruebas del proceso completo.

Conclusión: el trabajo de Claude es una base reutilizable para comunicar la
necesidad y asignar un coche sustituto, pero no resuelve el registro técnico que
se necesita conservar.

### 12.2 Terminología y alcance

Para evitar confundir dos significados de «sustitución»:

- **Cambio de neumáticos**: intervención en la que se reemplazan uno o varios
  neumáticos del vehículo.
- **Vehículo de sustitución**: otro vehículo que cubre temporalmente al primero
  mediante `VehicleLink(reason=tires)`.

Un cambio de neumáticos puede existir sin vehículo de sustitución. Del mismo
modo, abrir una incidencia `tires` no demuestra que el cambio ya se haya
realizado.

Primera versión propuesta:

- registrar intervenciones por vehículo y fecha;
- identificar posiciones y características del material instalado;
- enlazar opcionalmente incidencia, factura, documento y vínculo de vehículo de
  sustitución;
- conservar historial y calcular cuál fue la última instalación por posición;
- no gestionar stock, almacenes, compras ni números de serie individuales;
- no generar alertas automáticas de desgaste hasta que negocio defina una regla
  objetiva por kilómetros, antigüedad o profundidad del dibujo.

### 12.3 Modelo `TireReplacement`

Una fila representa una intervención, no cada neumático físico.

| Campo | Regla |
|---|---|
| `vehicle` | Vehículo al que se montaron los neumáticos. |
| `date` | Fecha efectiva de sustitución. |
| `km` | Odómetro al realizar el cambio. |
| `positions` | Delanteros, traseros, todos o selección individual. |
| `quantity` | Número de unidades sustituidas; coherente con las posiciones. |
| `brand` / `model` | Fabricante y gama instalados. |
| `size` | Medida normalizada, por ejemplo `205/55 R16 91V`. |
| `dot` | Código/lote DOT opcional. |
| `season` | Verano, invierno o todo tiempo. |
| `reason` | Desgaste, pinchazo, daño, campaña, cambio estacional u otro. |
| `workshop` | Taller/proveedor. |
| `cost` | Coste informativo, decimal no negativo. |
| `incident` | Incidencia `type=tires`, opcional. |
| `vehicle_link` | Vínculo con motivo `tires`, opcional. |
| `invoice` / `document` | Evidencia contable y justificante, opcionales. |
| `notes` | Observaciones. |
| `recorded_by` / timestamps | Autoría y auditoría. |

Si en una misma visita se montan modelos o medidas diferentes por eje, se
crearán dos líneas de detalle bajo una cabecera `TireReplacement`, en lugar de
duplicar toda la intervención. Por ello, durante MAN-T1 se decidirá entre:

- modelo simple de una fila, suficiente si siempre se monta el mismo producto;
- `TireReplacement` + `TireReplacementLine`, recomendado si pueden variar
  medida, modelo o DOT según la posición.

La opción recomendada es cabecera + líneas:

```text
TireReplacement
└── TireReplacementLine (posición, cantidad, marca, modelo, medida, DOT, temporada)
```

Restricciones principales:

- al menos una línea y una posición;
- una posición no aparece dos veces dentro de la misma intervención;
- la suma de cantidades coincide con las posiciones declaradas;
- `date` no es futura;
- el kilometraje no retrocede respecto a una lectura posterior sin confirmación
  y motivo;
- la incidencia enlazada debe ser del mismo vehículo y de tipo `tires`;
- el vínculo enlazado debe incluir al vehículo principal, tener motivo `tires`
  y cubrir la fecha de la intervención;
- factura y documentos deben corresponder al mismo vehículo;
- se aplica `DeactivatableModel`: corrección con motivo, nunca borrado ordinario.

### 12.4 Servicio de dominio y API

Crear las operaciones en `back/fleet/services/tires.py`:

- `register_replacement(data, actor)`: crea cabecera y líneas atómicamente,
  registra evento y, si procede, cierra la incidencia.
- `correct_replacement(record, data, actor, reason)`: conserva auditoría.
- `current_tires(vehicle)`: obtiene la última instalación vigente por posición
  sin consultas N+1.
- `close_related_incident(record, actor)`: cierre explícito y trazable; no se
  ejecuta solo por subir un documento.
- `validate_related_link(record)`: comprueba el vínculo de sustitución.

Endpoints propuestos:

| Método y ruta | Uso | Permiso |
|---|---|---|
| `GET /api/v1/tire-replacements/` | Historial filtrable | Gestión; conductor sobre sus vehículos |
| `POST /api/v1/tire-replacements/` | Registrar cambio completo | Gestión |
| `GET /api/v1/tire-replacements/{id}/` | Detalle y evidencias | Según scope del vehículo |
| `PATCH /api/v1/tire-replacements/{id}/` | Corrección con motivo | Gestión |
| `DELETE /api/v1/tire-replacements/{id}/` | Desactivación/errata | Admin + motivo |
| `GET /api/v1/vehicles/{id}/current-tires/` | Juego actual por posición | Usuarios con acceso al vehículo |
| `POST /api/v1/incidents/{id}/register-tire-replacement/` | Completar desde incidencia | Gestión |

Filtros: vehículo, fecha, posición, marca, modelo, medida, motivo, taller,
incidencia, con/sin vehículo de sustitución y búsqueda por matrícula o DOT.

### 12.5 Modificación de cada vista — Gestión

#### Vista global «Mantenimientos»

Añadir una pestaña **Neumáticos** junto a **Mantenimientos anuales**:

- historial global de sustituciones;
- filtros por vehículo, marca/modelo del neumático, medida, posición, motivo y
  rango de fechas;
- acción «Registrar cambio»;
- panel con líneas instaladas, km, taller, coste, factura, documentos,
  incidencia y vehículo de sustitución;
- exportación de las filas filtradas.

Los KPI anuales no mezclarán estos registros. La pestaña de neumáticos tendrá
sus propios totales: intervenciones, unidades cambiadas y coste del periodo.

#### Ficha de vehículo

Añadir un bloque **Neumáticos** independiente del checklist anual:

- resumen del juego actual por eje/posición;
- último cambio, kilómetros desde el cambio si hay lecturas y coste;
- historial de intervenciones;
- acción «Registrar sustitución»;
- acceso a incidencia, justificante, factura y vehículo sustituto vinculados.

No mostrar el `MaintenancePlan` antiguo «Neumáticos» una vez migrado el flujo.

#### Incidencias

Cuando `type=tires`:

- cambiar el panel genérico por un flujo guiado;
- mostrar «Registrar cambio de neumáticos»;
- precargar vehículo, fecha, descripción, coste y documentos cuando sea seguro;
- mantener la incidencia abierta hasta que gestión confirme la intervención o
  la cierre indicando que no hubo sustitución;
- ofrecer la creación/cierre del `VehicleLink(reason=tires)` usando el flujo de
  sustituciones ya implementado por Claude/N9.

#### Listado de vehículos y dashboard

No añadir un estado técnico nuevo. Opcionalmente mostrar:

- fecha/kilometraje del último cambio;
- badge si existe una incidencia de neumáticos abierta;
- acceso al historial filtrado.

Hasta que haya política de caducidad, no se mostrará «neumático vencido» ni se
inventará un umbral.

#### Alertas y campana

Las incidencias abiertas ya aparecen en la campana. No crear un `AlertType`
para neumáticos en la primera versión. Si se aprueban umbrales futuros, se
añadirá una alerta diferenciada y deduplicada por vehículo/posición/objetivo.

#### Informes y Descargas

Añadir una hoja **Neumáticos** al único documento completo de vehículos:

- matrícula y datos básicos del vehículo;
- fecha, km, posiciones y cantidad;
- marca, modelo, medida, DOT y temporada;
- motivo, taller y coste;
- incidencia, factura, documento y vehículo de sustitución;
- autor y fecha de registro.

La hoja respetará los filtros de vehículos existentes. No se incrustarán estas
filas en «Mantenimiento anual», porque representan reglas y periodicidades
distintas.

#### Documentos, facturas y erratas

- Documentos mostrará la intervención relacionada.
- Facturas podrá enlazar una intervención del mismo vehículo.
- El informe de costes contabilizará la factura una sola vez.
- Erratas permitirá restaurar una intervención desactivada siempre que no
  contradiga otra corrección vigente.

#### Ajustes y catálogos

En la primera versión, marca/modelo/medida serán valores normalizados con
sugerencias desde el histórico. Si el volumen o la calidad del dato lo exige,
se promoverán después a catálogos administrables; no deben añadirse al catálogo
obligatorio de mantenimiento anual.

### 12.6 Modificación de cada vista — Conductores

#### Nueva incidencia

Conservar el tipo `tires` añadido por Claude y mejorar el formulario:

- indicar posición afectada y motivo aparente;
- permitir fotos;
- no pedir marca, medida, DOT ni coste al conductor;
- explicar que comunicar la incidencia no registra todavía la sustitución.

El envío seguirá usando el endpoint público acotado y su throttling actual.

#### Mis vehículos y ficha móvil

- mostrar incidencia de neumáticos abierta;
- mostrar el último cambio confirmado y el juego actual de forma resumida;
- si hay vehículo sustituto por este motivo, mantener las dos tarjetas ligadas
  con el comportamiento N9 ya implementado;
- el conductor solo consulta el registro técnico confirmado.

#### Grupo del supervisor

- filtrar incidencias por tipo neumáticos;
- ver vehículo principal y sustituto;
- permitir aportar evidencia, pero no confirmar la instalación en la primera
  entrega.

La futura aportación offline se modelará como propuesta/evidencia pendiente de
validación, no como creación directa de `TireReplacement`.

### 12.7 Migración del trabajo actual

1. Conservar `IncidentType.TIRES`, `LinkReason.TIRES`, traducciones y seed.
2. Añadir el modelo específico sin reescribir incidencias existentes.
3. Ofrecer un comando `link_legacy_tire_incidents --dry-run` que liste las
   incidencias `tires` cerradas y los datos que faltarían para crear una
   intervención.
4. No generar sustituciones históricas automáticamente desde descripciones
   libres.
5. ~~Retirar el `MaintenancePlan` «Neumáticos»~~ **Hecho (2026-08-28)**: por la
   regla «los neumáticos siempre son una avería», el seed ya no crea planes de
   neumáticos (los ciclos por km de ejemplo son de taller). Queda pendiente
   solo la política futura de aviso por km/desgaste (§12.10.4).
6. Actualizar `ANALISIS_GAP.md`: GAP-6 pasa de «enum e i18n» a «registro técnico
   completo» únicamente al terminar esta extensión.

### 12.8 Pruebas específicas

- creación atómica de cabecera y líneas;
- posiciones/cantidades duplicadas o incoherentes;
- fecha, kilometraje y pertenencia de relaciones;
- permisos admin/supervisor/driver y cambio de vehículo malicioso;
- registro desde una incidencia `tires` y rechazo desde otro tipo;
- cierre trazable de incidencia;
- vínculo `reason=tires` vigente en la fecha;
- cálculo del juego actual con cambios parciales por eje;
- corrección, desactivación, restauración y auditoría;
- hoja XLSX filtrada y sin doble contabilización de coste;
- formulario móvil, fotos, i18n, accesibilidad y comportamiento offline.

### 12.9 Fases adicionales

#### MAN-T1 — Registro técnico

- cerrar cabecera/líneas y enums;
- modelos, migración, auditoría, admin y servicios;
- API con permisos y scope;
- pruebas backend.

#### MAN-T2 — Gestión e integración

- pestaña global y bloque en ficha;
- flujo guiado desde Incidencias;
- documentos, facturas, eventos y erratas;
- hoja «Neumáticos» del documento completo.

#### MAN-T3 — Conductores y retirada del legado

- formulario móvil mejorado y consulta del historial;
- relación visual principal/sustituto;
- conciliación de incidencias existentes;
- decisión y retirada del plan kilométrico legado;
- documentación, QA y seeds definitivos.

### 12.10 Decisiones pendientes de neumáticos

1. Confirmar si se necesita una fila por intervención o detalle por eje/posición.
2. Confirmar las posiciones que admite cada tipo de vehículo.
3. Decidir qué campos son obligatorios: medida, marca/modelo, DOT, taller,
   factura y justificante.
4. Definir si existe una política futura de revisión/cambio por kilómetros,
   antigüedad o profundidad del dibujo.
5. Confirmar si registrar el cambio cierra siempre la incidencia asociada.
6. Confirmar si gestión debe abrir/cerrar automáticamente el vínculo con el
   vehículo de sustitución o si seguirá siendo una acción independiente.
