# Plan: tutorial de administradores como vista de la app de gestión

Estado a 16-11-2026. Pasos para construir, dentro de `front-gestion`, una vista **«Ayuda»**
que enseñe a usar la app de gestión. Es la hermana del tutorial de conductores
(`tutoriales/conductores/tutoriales.html`), pero **no es un HTML suelto**: es una página
más de la SPA, con sus rutas, su menú, su i18n y sus pruebas.

> Referencia de forma y de contenido: el tutorial de conductores y su plan
> (`docs/PLAN_TUTORIALES.md`). Lo que allí funcionó —capturas reales, recorridos por
> pestañas, guía rápida por caso, chapas de público, enlaces a una pestaña concreta— se
> reutiliza aquí como componentes React.
>
> Todos los rótulos citados en este plan están **comprobados en el código** a esta fecha
> (fichero y línea entre paréntesis cuando ayuda). Antes de redactar un capítulo, vuelve a
> mirarlos: la copia cambia.

## En una página

- **Qué**: una página «Ayuda» dentro de gestión (`/ayuda`), con 21 capítulos, uno por
  pantalla o tarea, en castellano e inglés, con capturas reales.
- **Para quién**: los administradores de la flota. No necesita backend.
- **Cómo no se queda vieja**:
  - Los rótulos de botones salen de la copia de la propia app.
  - Las capturas se rehacen con un script.
  - Unas pruebas fallan si falta algo.
- **Qué gana frente a un HTML suelto**:
  - «Abrir esta pantalla» en cada capítulo.
  - «¿Cómo funciona?» en cada pantalla.
  - El idioma, que ya viene de la app.
- **Cómo se hace**: seis fases (§10). La 1 y la 2 dejan la vista funcionando con un
  capítulo; la 4 es la gorda (el contenido).

| Ficha | |
|---|---|
| Estado | **Fases 1 a 5 hechas** (16-11-2026): los 21 capítulos tienen texto en es/en y capturas en los dos idiomas. Queda la revisión por administración y la fase 6, que es opcional. Detalle en «Estado real», justo debajo. |
| Código afectado | solo `front-gestion` (y `e2e/` y `docs/tutoriales-capturas/`) |
| Riesgo para producción | bajo: una ruta nueva, una entrada de menú y un atajo |
| Depende de | gestión y back en dev con el seed (`seed_dev_data`) para las capturas |

## Estado real (16-11-2026)

**Hecho**

- Los 21 capítulos, en castellano e inglés, con los rótulos por clave (§4.3). El último en
  escribirse fue «Enviar correo».
- Capturas de todos los capítulos en `es/` y `en/`, con `docs/tutoriales-capturas/capture-gestion.mjs`.
- Aspecto: el del tutorial de conductores (`tutoriales/conductores/tutoriales.html`) llevado a
  escritorio. Cada capítulo es una tarjeta; la guía rápida, tarjetas con icono; el recorrido,
  una caja con pestañas rellenas («1 · Buscar», las pasadas en verde) y pie con «‹ Atrás /
  Continuar ›»; pasos con círculo sólido y línea; avisos con icono; dudas en cajas plegables;
  índice numerado. Las capturas van sin marco de móvil y se amplían al pulsarlas.
- Portada: un bloque por grupo y, en cada capítulo, sus tareas (la guía rápida); «Seguir
  donde lo dejaste» y cuántos capítulos se han abierto.
- Buscador: cada resultado lleva a su sección o a su duda (`#ancla`) y la abre; busca
  también por las tareas de la guía rápida; Esc lo vacía.
- Recorrido: en el último paso, en vez de «Continuar», el enlace al capítulo siguiente.
- «Preguntas frecuentes» junta además las dudas de todos los capítulos.
- «Importar en bloque» explica el formato del fichero y deja descargar los ejemplos
  (`front-gestion/public/tutorial/ejemplos/`, copia de `ejemplos-importacion/`; una prueba
  falla si dejan de ser iguales).
- Ayuda en contexto (fase 5): se hizo con el botón «?» de la cabecera, que abre el capítulo
  de la pantalla abierta y deja volver, en vez de un `HelpLink` en cada `PageHeader`.
- `CLAUDE.md`, el e2e (`navegacion.spec.ts`) y el README de los ejemplos, al día. El
  subtítulo de Ajustes ya no habla de facturas (anexo B).

**Lo que se hizo distinto de este plan**

- No hay `QuickGuide.tsx` ni `HelpLink.tsx`: la guía rápida vive en `ChapterView` y la
  ayuda en contexto, en `AppHeader`. Hay dos ficheros que el plan no preveía:
  `RichText.tsx` (rótulos como botones y enlaces `[[id]]`) y `progress.ts` (leídos y último).
- Las marcas numeradas sobre las capturas (§7.6) no se hicieron: las capturas van en
  miniatura y se amplían al pulsarlas.
- No hay `check-gestion.mjs` ni `webp.mjs` parametrizado: el propio script de capturas
  escribe el WebP y tiene una tarea de revisión (`revision-ayuda`).
- Las capturas se hacen como `ana_hse`, no como `admin` (una sesión por usuario).

**Secciones que se quedan sin captura, y por qué**

Fotografiarlas obligaría a guardar algo de verdad, y el script nunca guarda:

- La ficha · «Deshacer un cambio» (hace falta un cambio reversible en el histórico).
- Importar · «Mientras se importa» (habría que importar).
- Accidentes · los pasos 2 a 4 del parte (hay que rellenarlo) y el borrado de terceros (el
  botón solo se enciende a los 18 meses).

**Trampas del script de capturas** (añadir a §7.4)

- Todas las tandas comparten el puerto 9333 y el usuario `ana_hse`: **una tanda cada vez**.
  Una segunda se engancha al navegador de la primera y le cierra la sesión.
- Dos límites del back: 2.000 peticiones/hora por usuario (una tanda completa gasta
  buena parte) y 100/hora anónimas (cada carga del login cuenta). Si se agotan, el script
  lo dice y hay que esperar; no reintentar en bucle.
- El e2e y el servidor de desarrollo compartían la caché de dependencias de Vite: lanzar
  el e2e con dev encendido la reescribía con un React duplicado y las dos apps salían con
  «Algo ha fallado». El e2e usa ya la suya (`VITE_CACHE_DIR`, `node_modules/.vite-e2e`).
- Un recorte de alto negativo dejaba la captura colgada para siempre (pasaba en
  `ficha-historico`). Ya da error en vez de colgarse.

**Pendiente**

- [ ] Revisión del contenido por alguien de administración (§16), y sus preguntas
  frecuentes reales.
- [x] Fase 6, el vídeo (16-11): capítulo «Vídeo de presentación» (`/ayuda/video`, grupo
  nuevo «Presentación», el primero del índice), en castellano y en inglés, sin audio.
  - Guion: `front-gestion/src/tutorial/video-scenes.json` (20 escenas, ~89 s). Lo leen el
    generador y la página (`IntroVideo.tsx`), así que el vídeo y la lista de escenas dicen
    lo mismo. Si cambian textos o duraciones hay que regenerar los dos vídeos.
  - Rehacerlo (unos 10 min por idioma lanzando los dos a la vez):
    `python docs/tutoriales-capturas/video_gestion.py <es|en>` y después
    `node docs/tutoriales-capturas/video_reencode.mjs <es|en> 1000 gestion`.
    Con `--stills <carpeta>` saca una foto por escena sin grabar, para revisar.
  - Salen en `front-gestion/public/tutorial/video/presentacion-<idioma>.webm` y `.jpg`.
- [ ] Fase 6, lo que queda: el enlace desde la cabecera HSE.
- [x] `Gestión de flotas Visuales Administrador.pdf` (anexo E), leído el 16-11-2026: son siete
  maquetas (vista general, creación, detalle, proyección de km, edición y refacturación de
  vehículos) sin texto. No trae recorrido ni vocabulario que contradiga la Ayuda.

---


## Índice

0. Decisiones de partida · 1. Inventario de capítulos · 2. Guion de cada capítulo ·
3. Ruta, menú y atajo · 4. Estructura del código · 5. La vista · 6. Cómo se escribe ·
7. Capturas · 8. Vídeo (opcional) · 9. Pruebas · 10. Fases paso a paso ·
11. Mantenimiento · 12. Riesgos y preguntas abiertas · 13. Antes de dar por terminado ·
14. Capítulo de muestra redactado · 15. Esfuerzo orientativo · 16. Quién hace qué ·
Anexo A. Glosario es/en · Anexo B. Hallazgos al preparar el plan ·
Anexo C. Mapa ruta → capítulo · Anexo D. Plantilla de PR por capítulo ·
Anexo E. Fuentes

---

## 0. Decisiones de partida

| Tema | Decisión | Por qué |
|---|---|---|
| Dónde vive | `front-gestion`, ruta **`/ayuda`** (y `/ayuda/:capitulo`) | Quien la necesita ya está dentro de gestión; un HTML aparte no sabe quién entra ni en qué idioma. |
| Quién la ve | **Admin** (la cuelga `AdminGate`, como el resto). El HSE puro sigue sin salir de `/hse` (`HseOnlyRedirect`). | Es el manual de gestión. Para HSE, un capítulo propio enlazado desde su cabecera (fase 6). |
| Backend | **Ninguno**. Sin endpoints, sin migraciones, sin permisos nuevos. | Es contenido estático; va en el chunk perezoso de la página. |
| Textos | `src/translations/tutorial.ts` (es/en), **sin literales en el JSX**. Los rótulos de botones se toman **de la propia copia de la app** (§4.3). | Regla del repo (i18n tipado) y que el tutorial no se quede viejo al renombrar un botón. |
| Capturas | Reales, de gestión en dev sobre el seed, en `src/assets/tutorial/{es,en}/` como WebP. | Igual que conductores: si se dibujan, «distan mucho de lo que es la app». |
| Carpeta `tutoriales/administradores/` | Guarda este plan, los **originales PNG** de las capturas y el guion del vídeo. | La fuente de verdad del contenido está en el código; aquí, el material de trabajo. |
| h1 de la vista | Siempre **«Ayuda» / «Help»** (`PageHeader`); el capítulo es un `h2`. | Una sola cabecera por pantalla (como el resto) y una prueba e2e sencilla. |

**Fuera de alcance** (para no estirar el trabajo):
- Tours guiados encima de la pantalla real (globos que señalan botones). Se rompen con
  cada cambio de maquetación; las capturas con marcas cumplen igual y se rehacen con un
  script.
- Un buscador global de la app. El buscador es solo del tutorial.
- Editar el tutorial desde la app (CMS). El contenido cambia con el código y se revisa en PR.

---

## 1. Inventario: qué tiene que explicar (capítulos)

Sale de las rutas de `src/App.tsx`, del menú de `components/AppHeader.tsx` y de los
modales que se abren desde el menú ⋮ de cada coche (`components/useVehicleActions.tsx`).

| # | id (URL) | Capítulo | Pantalla / pieza | Copia de origen |
|---|---|---|---|---|
| 1 | `entrar` | Entrar y moverse | `/login`, cabecera (`ManagementHeader`), campana, llave de solicitudes, menú, idioma, atajos (`Layout`) | `i18n.tsx` → `login`, `shell`, `shortcuts` |
| 2 | `panel` | Vista general | `/` `DashboardPage` | `i18n.tsx` → `home`; `translations/panels.ts` |
| 3 | `vehiculos` | Vehículos | `/vehiculos` | `translations/vehicles.ts` |
| 4 | `ficha` | La ficha del vehículo | `/vehiculos/:id` | `translations/vehicleDetail.ts` |
| 5 | `alta` | Alta y edición de un vehículo | `/vehiculos/nuevo`, `/vehiculos/:id/editar` (`VehicleForm`) | `translations/vehicleForm.ts` |
| 6 | `importar` | Importar en bloque | `BulkImportModal` (desde Vehículos y Usuarios) | `translations/bulkImport.ts` |
| 7 | `estado` | Cambiar el estado y el coche de sustitución | `VehicleStateModal` («Nuevo estado») | `translations/vehicles.ts` (`ops`) |
| 8 | `incidencias` | Incidencias | `/incidencias` (`IncidentsPage`) | `translations/incidents.ts` |
| 9 | `resolver` | Resolver alertas e incidencias | `ResolveDispatcher` y sus formularios | `translations/resolve.ts`, `alertsPage.ts` |
| 10 | `accidentes` | Accidentes | `/accidentes`, `AccidentReportForm` | `translations/incidents.ts`, `vehicles.ts` |
| 11 | `itv-mantenimiento` | Programar ITV y mantenimiento | `ScheduleItvMaintenanceModal` | `translations/schedule.ts` |
| 12 | `kilometraje` | Kilometraje y proyección | `/kilometraje` (`MileagePage`) | `translations/mileage.ts` |
| 13 | `alertas` | Alertas | `/alertas` | `translations/alertsPage.ts` |
| 14 | `solicitudes` | Solicitudes | `/solicitudes` (seis bandejas) | `translations/requests.ts` |
| 15 | `documentos` | Documentos | `/documentos` | `translations/documents.ts` |
| 16 | `usuarios` | Usuarios | `/conductores`, `/conductores/:id` | `translations/users.ts`, `userDetail.ts` |
| 17 | `correo` | Enviar correo | `VehicleEmailModal` | `translations/vehicles.ts` (`email`) |
| 18 | `informes` | Informes y facturas | `/informes` | `translations/reports.ts`, `invoices.ts` |
| 19 | `ajustes` | Ajustes | `/ajustes/:tab` | `translations/ajustes.ts`, `catalogs.ts`, `erratas.ts`, `emailTemplates.ts`, `emailSettings.ts` |
| 20 | `hse` | Vista HSE | `/hse` | `translations/hse.ts` |
| 21 | `preguntas` | Preguntas frecuentes | — | recogidas de soporte, no inventadas |

**Grupos del índice**:

| Grupo | Capítulos |
|---|---|
| *Primeros pasos* | 1, 2 |
| *La flota* | 3, 4, 5, 6, 7, 11, 12 |
| *Lo que pasa* | 8, 9, 10, 13, 14 |
| *Papeles y personas* | 15, 16, 17 |
| *Administración* | 18, 19 |
| *Otros* | 20, 21 |

**Chapas de público.** Aquí no son conductor/supervisor sino:
- **«Solo superusuario»**: el «Eliminar definitivamente» de Borrado (`ErratasPage`, mira
  `user.is_superuser`).
- **«Necesita el rol HSE»**: el capítulo 20 (`RequireHse`; un admin sin el rol no entra).

**Lo que no se explica**:
- La pestaña «Notificaciones» de Ajustes: está **oculta a propósito**
  (`AjustesPage.tsx:9-13`), aunque su página y su API siguen vivas.
- El `/ui-kit`, que solo existe en dev.

---

## 2. Guion de cada capítulo

Es el material de partida para redactar. Para cada capítulo:
- **Secciones**: lo que hay que contar, en orden.
- **Recorrido**: las pestañas, cuando la pantalla es un asistente o tiene pestañas.
- **Capturas**: el nombre del fichero (sin `.webp`).
- **Avisos**: lo que suele confundir.

Los rótulos van entre «» tal cual salen en castellano. En la copia del tutorial se
**referencian** por su clave (§4.3), no se copian.

### 2.1 Entrar y moverse (`entrar`)
- **Secciones**:
  - Entrar: «Inicia sesión», «Usuario o email», «Contraseña», «Entrar».
  - La cabecera:
    - La marca «Flota · Gestión».
    - El botón «HSE», si se tiene el rol.
    - La **llave** de solicitudes con su número: lleva a la primera bandeja con algo pendiente.
    - La **campana**: pestañas Alertas/Incidencias, con Abiertas/Resueltas o Abiertas/En curso/Cerradas, hasta 8 avisos y «Ver todas…».
  - El **menú** y sus grupos:
    - General: Panel.
    - Flota: Vehículos, Usuarios, Kilometraje.
    - Incidencias y alertas: Incidencias, Accidentes, Alertas, Solicitudes.
    - Administración: Ajustes, Informes, Documentos.
  - Cambiar de idioma y «Salir».
  - **Atajos**:
    - `/` busca, `n` nuevo vehículo y `?` abre la hoja.
    - `g` + letra lleva a cada pantalla: h panel, v vehículos, a alertas, i incidencias, x accidentes, k kilometraje, f facturas, c usuarios, d documentos, m informes, j ajustes, t catálogos y, nueva, **y ayuda**.
- **Capturas**: `login`, `cabecera`, `campana`, `menu`, `atajos`.
- **Avisos**:
  - Entrar como un usuario cierra su sesión abierta en otro sitio.
  - Los atajos no funcionan mientras se escribe en un campo.

### 2.2 Vista general (`panel`)
- **Secciones**:
  - Las cifras de la cabecera: Vehículos, Alertas abiertas e Incidencias abiertas.
  - «Añadir vehículo» y «Añadir conductor». Avisan antes de salir: «Vas a salir de la vista general» → «Ir y crear».
  - Los **seis indicadores**. Cada uno abre su ventana:
    - Vehículos.
    - «Personal / obra» → «Reparto de uso».
    - «Coste mensual» → «Costes de la flota».
    - «ITV próximas (30 días)».
    - Seguro.
    - «Mantenimiento anual (30 días)».
  - Dentro de esas ventanas, las acciones por coche: «Registrar ITV», «Enviar correo», «Renovar seguro» y «Registrar servicio».
  - Las dos tiras de pendientes:
    - «Alertas que requieren atención», con las chapas Todas / ITV programada / Seguro / Kilómetros / Mantenimiento programado / Sin conductor.
    - «Incidencias abiertas», con las chapas Todas / Averías / Averías de neumáticos / Mantenimiento puntual / Accidentes / Peticiones generales.
  - Las pestañas Flota / Sustitución / Supervisores / Conductores.
  - «Buscar y exportar» y los «Cortes».
- **Recorrido**: no hace falta. **Guía rápida**: «Ver qué ITV vencen», «Ver cuánto cuesta la flota», «Atender lo pendiente».
- **Capturas**: `panel`, `panel-indicadores`, `panel-reparto`, `panel-pendientes`.

### 2.3 Vehículos (`vehiculos`)
- **Secciones**:
  - Las pestañas «Vehículos de flota» / «Vehículos de sustitución», con su número.
  - «Buscar y filtrar»: Estado (incluye «Con coche de sustitución»), Supervisor, Conductor, Fecha de alta, y «Columnas».
  - Los «Cortes»: ITV próximas, Seguros próximos, Mantenimientos próximos, Km sobrepasados y Mostrar bajas. También «Limpiar filtros».
  - «Exportar CSV» exporta lo que se está viendo.
  - El **menú ⋮** de cada fila, en su orden:
    - Enviar correo.
    - Cambiar conductor / supervisor.
    - Gestionar facturas.
    - Kilómetros y combustible.
    - Convertir en coche de flota (solo en sustitutos libres).
    - Alertas e incidencias.
    - Accidente.
    - Programar ITV y mantenimiento.
    - Editar.
    - Dar de baja.
  - Las filas de coches cubiertos se despliegan: «Coche de sustitución · Cubre desde …».
  - La celda de km avisa de cuánto lleva sin lectura («Sin lecturas», «N días sin
    lectura»), con un semáforo.
  - «Dar de baja» no borra el coche: conserva su histórico, facturas y documentos, y se
    reactiva en Ajustes → Borrado definitivo.
- **Guía rápida**: «Encontrar un coche», «Ver los que tienen la ITV cerca», «Sacar un listado», «Cambiar el conductor».
- **Capturas**: `vehiculos`, `vehiculos-filtros`, `vehiculos-cortes`, `vehiculos-menu`, `vehiculos-sustituto`.
- **Avisos**:
  - No hay vistas guardadas: al volver de una ficha, la lista recuerda solo el último filtro y el scroll.
  - «Convertir en coche de flota» avisa tres veces y no tiene vuelta atrás.

### 2.4 La ficha del vehículo (`ficha`)
- **Secciones**:
  - Cabecera: la matrícula, las chapas, «Expandir/Plegar todo», y «Coste mensual» y «Fin de contrato» como indicadores.
  - Fila superior: «Enviar correo», «Editar ficha» y el aviso «Estado».
  - Los indicadores, cada uno abre lo suyo:
    - «Vencimiento del seguro».
    - «Próxima ITV» y «Próximo mantenimiento» → programar.
    - «Alertas e incidencias».
    - «Kilometraje» y «Consumo medio» → kilómetros y combustible.
  - Las tarjetas:
    - Datos técnicos.
    - Contrato.
    - Facturas.
    - Alertas e incidencias.
    - Accidentes.
    - Kilómetros contratados (Anual / Contrato completo).
    - Conductor y reparto.
    - Documentos.
    - Histórico.
  - **Histórico**:
    - El filtro «Origen» y «Ver histórico completo (n)».
    - **«Revertir»**: sale solo en los cambios que se pueden deshacer y pide confirmación («Revertir este cambio» → «Sí, revertir»).
- **Capturas**: `ficha`, `ficha-indicadores`, `ficha-historico`, `ficha-revertir`.
- **«Abrir esta pantalla»**: no hay una ficha fija. El botón lleva a `/vehiculos` con el texto «Abre cualquier coche de la lista».

### 2.5 Alta y edición de un vehículo (`alta`)
- **Secciones**:
  - «Tipo de vehículo»: Flota o Sustitución.
  - «Datos del vehículo»: Matrícula, Bastidor y Matriculación.
  - El **candado**:
    - Solo sale al editar: «Bloqueado» / «Editable».
    - Desbloquear pide confirmar: «Vas a modificar datos sensibles del vehículo» → «Entiendo, quiero editarlos».
  - El pie fijo: «Cancelar», el aviso «Hay cambios sin guardar.», y «Atrás» / «Siguiente» → «Crear vehículo».
  - Al editar, «Revisar cambios…» abre la vista previa: «Confirmar cambios» / «Seguir editando» / «Guardar cambios».
- **Recorrido** (pestañas del formulario):
  1. Identificación.
  2. Características técnicas.
  3. Uso y asignación (no sale en los sustitutos).
  4. Propiedad y contrato.
- **Capturas**: `alta-tipo`, `alta-1` … `alta-4`, `editar-candado`, `editar-revisar`.

### 2.6 Importar en bloque (`importar`)
- **Desde dónde**: «Importar» en Vehículos y en Usuarios, junto a «Exportar CSV». Títulos
  de la ventana: «Importar vehículos» / «Importar personas» (`bulkImport.ts`, `titles`).
- **Recorrido** (`components/bulk-import/`, pasos `file → map → preview → run`):
  1. **Fichero**:
     - «Arrastra un fichero o pulsa para elegirlo».
     - Excel (.xlsx) o CSV, y la primera fila es la cabecera.
     - Avisa de «N filas detectadas» y «N filas vacías omitidas».
     - «Cambiar fichero», luego «Siguiente».
  2. **Columnas**:
     - Cada campo de la base se asigna a una columna del fichero. Los marcados con * son obligatorios.
     - «— Sin asignar —» deja un campo sin tocar.
     - «N de M campos asignados».
     - «Validar fichero».
     - **Aviso de actualización**: si la matrícula ya existe, se actualizan solo los campos distintos. Para actualizar unos pocos datos, asigna solo esos.
  3. **Vista previa**:
     - Pestañas «Nuevos» / «Errores», con Fila, Campo y Motivo.
     - «N se crearán · M ya existen y se actualizarán»; la chapa «Actualiza».
     - «Descargar errores (CSV)».
     - «Importar N registros».
  4. **Progreso**:
     - «Importando…», «N / M procesados», y creados, actualizados, sin cambios y errores.
     - «Detener la importación»: lo ya creado **no se deshace**.
     - La tabla de resultados por fila, con «Descargar resultado (CSV)».
- **Ficheros de ejemplo** (ya existen, datos ficticios): `ejemplos-importacion/`:
  - `vehiculos.csv`, para el alta.
  - `vehiculos-actualizacion.csv`, para actualizar solo matrícula, estado, seguro, km y combustible. Es el ejemplo perfecto del aviso del paso 2.
  - `conductores.csv`.
  - Su `README.md` tiene el formato. El capítulo lo resume y enlaza los ejemplos como descarga: copiarlos a `front-gestion/public/tutorial/ejemplos/`.
- **Formato que hay que contar** (del README de los ejemplos):
  - Separador `;`, `,` o tabulador, que se detecta solo. Codificación UTF-8.
  - Fechas `AAAA-MM-DD` o `DD/MM/AAAA`.
  - Sí/no: `sí`/`no` (también `x`, `1`…).
  - Opciones por su nombre: `Diésel`, `Renting`.
  - Roles separados por comas.
- **Avisos**:
  - `Sociedad`, `Proyecto`, `CECO`, `Supervisor` y `Conductor` tienen que **existir ya** en la base. Si no, la fila sale en errores.
  - El DNI ya no se usa para identificar a un conductor: hay que usar el correo o el usuario.
  - Reimportar el mismo fichero no duplica nada.
- **Guía rápida**: «Dar de alta muchos coches», «Actualizar un dato de muchos coches», «Dar de alta personas».
- **Capturas**: `importar-1` … `importar-4`, `importar-errores`, `importar-actualiza`.
  - Se hacen con los CSV de ejemplo, **sin pulsar «Importar N registros»**.

### 2.7 Cambiar el estado y el coche de sustitución (`estado`)
- **Cómo se llega**: ⋮ «Alertas e incidencias» → pestaña «Nuevo estado». Ahí, «Nuevo estado» / «Estados abiertos».
- **Recorrido** (la barra de pasos):
  1. «Estado del vehículo». El desplegable agrupa:
     - Mantenimiento: «Mantenimiento puntual» y «Cambio de neumáticos».
     - Avería: «Vehículo averiado».
     - Otras: «Petición general».
  2. «Disponibilidad». Las opciones dependen de cómo esté el coche:
     - Si está activo:
       - «No activo · se le asigna un coche de sustitución».
       - «No activo · sale sin coche de sustitución».
       - «Activo · el coche sigue en servicio».
     - Si está parado:
       - «No activo · el coche sigue fuera de servicio».
       - «Activo · el coche vuelve al servicio».
     - Aquí está el **coche de sustitución**:
       - Campos: «Vehículo de sustitución», fechas de inicio y fin, y «Motivo de la sustitución».
       - «Crear coche de sustitución» lo da de alta sin salir.
       - Si ya hay un sustituto: «Sustituto activo» y «Cerrar vínculo (fin hoy)».
  3. «Datos del cambio de neumáticos» (solo para esa opción).
  4. «Gestión · ubicación».
  5. «Archivos del estado».
  6. «Comunicado por email».
  - Pie: «Anterior» / «Siguiente» → «Guardar».
- **Capturas**: `estado-1` … `estado-6`, `estado-sustituto`.
- **Avisos**:
  - Los pasos bloqueados explican por qué con un tooltip.
  - El paso 3 solo aparece con «Cambio de neumáticos»: el recorrido lo dice para que nadie lo busque.

### 2.8 Incidencias (`incidencias`)
- **Secciones**:
  - El listado, con «Ver accidentes» y «Ver alertas» en la cabecera.
  - Los filtros: Vehículo, **Tipo** (solo aquí) y Prioridad.
  - Las acciones de cada fila: Editar, Resolver y Documentos. La fila se despliega con el parte.
  - «Exportar CSV».
- **Pestañas**: «Abiertas» / «Cerradas» (`incidents.ts`, `tabOpen`/`tabClosed`). Dentro
  de Abiertas, cada incidencia está «Abierta» o «En curso».
- **Las tres bandejas van juntas**: Incidencias ↔ Accidentes ↔ Alertas se saltan entre sí
  con los botones «Ver…» de la cabecera. El capítulo lo dice una vez y enlaza los otros dos.
- **Capturas**: `incidencias`, `incidencias-fila`, `incidencias-filtros`.

### 2.9 Resolver alertas e incidencias (`resolver`)
- **Secciones**:
  - Un solo botón «Resolver» abre el formulario que toca según lo que sea:

    | Qué se resuelve | Formulario |
    |---|---|
    | ITV que vence / inspección | «Registrar ITV · X» |
    | ITV sin cita | Programar ITV (cap. 11) |
    | Seguro que vence | «Mandar correo a la renting» o «Renovar seguro» |
    | Mantenimiento | registrar el servicio |
    | Neumáticos | cierre del cambio de neumáticos |
    | Accidente | cierre del accidente. «Siniestro total» encadena la baja: «Resolver y dar de baja». |
    | Avería, petición general, otras | «Resolver y cerrar» |
    | Lectura de km pendiente, exceso de km, sin conductor | ventana de alerta. El exceso permite «Cambiar conductor y resolver». |
  - **Devolver a Activo**:
    - Si el coche está parado sale «Este coche está parado (…)» con «Devolver el coche a Activo al resolver».
    - Si tiene sustituto, la opción es «…y dejar libre el de sustitución (X)».
    - Viene marcado cuando la incidencia es la que paró el coche (ITV, mantenimiento, avería, accidente).
- **Guía rápida**: una entrada por fila de la tabla.
- **Capturas**: `resolver-itv`, `resolver-seguro`, `resolver-mantenimiento`, `resolver-averia`, `resolver-accidente`, `resolver-activo`.

### 2.10 Accidentes (`accidentes`)
- **Secciones**:
  - La bandeja: Abiertas / Cerradas, «Ver incidencias», «Ver alertas» y «Exportar CSV».
  - «Comunicar accidente»: primero «Elige el coche accidentado…» → «Continuar al parte».
  - Las acciones de cada fila, incluida **«Borrar datos de terceros»** (RGPD, a los 18 meses).
- **Recorrido** (el parte):
  1. «Dónde y cuándo».
  2. «Daños».
  3. «Implicados» (Terceros / Lesionados).
  4. «Atestado y archivo»: «Marcar el vehículo como «Accidentado»» → «Enviar reporte».
- Desde el ⋮ del coche: «Accidente», con las pestañas «Comunicar accidente» / «Gestionar accidentes».
- **Capturas**: `accidentes`, `accidente-elegir`, `accidente-1` … `accidente-4`, `accidente-terceros-borrar`.
- **Aviso**: las capturas de terceros, lesionados y atestado van **solo con datos del seed** (§13).

### 2.11 Programar ITV y mantenimiento (`itv-mantenimiento`)
- **Recorrido**:
  1. «Programar ITV»:
     - Campos: fecha y «CP preferente para la ITV».
     - Botones: «Programar ITV» / «Modificar la cita» / «Guardar la cita», «Registrar ITV» y «Eliminar la cita».
     - Solo hay **una cita por coche**.
  2. «Programar mantenimiento»:
     - «Programa de mantenimiento», con «+ Nuevo programa».
     - «Se cuenta desde» (fecha o km).
     - «Ya se pasó la revisión» y «Eliminar el mantenimiento».
- Abajo: «Últimas ITV realizadas» y «Últimos mantenimientos realizados».
- **Capturas**: `programar-itv`, `programar-mantenimiento`, `programa-nuevo`.

### 2.12 Kilometraje y proyección (`kilometraje`)
- **Recorrido** (las pestañas de la pantalla):
  1. «Lecturas».
  2. «Lecturas pendientes de este mes»:
     - «Avisar a todos».
     - «Completar km faltantes» → «Completar km faltantes del mes anterior».
  3. «Proyección a fin de contrato/año»:
     - «Horizonte»: Fin de contrato / Fin de año.
     - «Resolver» en los coches con exceso.
  4. «Flota con km ilimitados».
- Filtros: Buscar, «Grupo / supervisor» y el mes.
- **Capturas**: `km-lecturas`, `km-pendientes`, `km-completar`, `km-proyeccion`, `km-exceso`.

### 2.13 Alertas (`alertas`)
- **Secciones**:
  - Abiertas / Resueltas.
  - Los filtros:
    - Tipo: ITV programada, ITV sin cita, Lectura de km pendiente, Exceso de km proyectado, Mantenimiento programado y Sin conductor.
    - También Plazo, Conductor y Supervisor.
  - El orden: «Antes la más próxima» / «Antes la más lejana».
  - **Agrupar**: «Agrupar por mes de vencimiento» y «Agrupar por tipo».
  - Las acciones de cada fila: Resolver (cap. 9), «Mandar correo» y Documentos. En la cabecera, «Exportar CSV» y «Registrar ITV».
- **Capturas**: `alertas`, `alertas-mes`, `alertas-tipo`, `alertas-correo`.

### 2.14 Solicitudes (`solicitudes`)
- **Recorrido** (una pestaña por bandeja, con su clave de URL):
  1. Coche pedido (`vehiculos`). Tiene además «Origen»: Todos / Coche de sustitución / Sin vehículo.
  2. Sobre un documento que ya está (`documentos`).
  3. Documento que falta (`pedidos`).
  4. Otro conductor propuesto (`conductores`).
  5. Corregir una ficha personal (`fichas`).
  6. Modificar el parte de una incidencia (`partes`).
- **Común a todas**:
  - La barra: Registros, Buscar, y Pendientes / Concedidas / Rechazadas. La segunda opción se llama Resueltas, Atendidas o Aplicadas según la bandeja.
  - La caja «Cómo se decide»: «Conceder» / «Rechazar».
  - En las de documentos, «Gestionar»: Decisión / Documentación.
- **Guía rápida**: «Un conductor pide coche», «Un conductor quiere ver o borrar un documento», «Falta un papel», «Proponen otro conductor», «Hay que corregir mis datos», «Cambiar un parte».
- **Capturas**: `solicitudes-1` … `solicitudes-6`, `solicitudes-gestionar`.
- **Enlace**: la llave de la cabecera lleva aquí. El capítulo 1 lo cuenta.

### 2.15 Documentos (`documentos`)
- **Recorrido**:
  1. **Ajustes**: «Quién lee cada tipo de documento».
     - Administración: siempre.
     - Supervisión: «Lo lee».
     - Conductores:
       - «Listar documentos»: ninguno / solo los suyos / también los de otros.
       - Lectura, Descarga y Borrado, cada uno con Permitir / Enviar solicitud / No permitir.
     - Al terminar, «Guardar cambios».
  2. **Documentos**:
     - Los tipos («Todos» y uno por tipo) y «De un vistazo».
     - Los filtros: «Titular o conductor» y «Subido por».
     - «Agrupar por matrícula» y «Nuevo documento».
     - Las columnas «Acceso · Supervisión» y «Acceso · Conductor».
  3. **Acceso de un documento**:
     - El botón «Acceso de {tipo}» de la fila abre «Acceso · {tipo}».
     - Cada permiso puede quedarse en «Según el tipo» o cambiarse. Si se cambia, sale la chapa «Ajustado».
- **Avisos**:
  - «Enviar solicitud» es lo que llena las bandejas 2 y 3 de Solicitudes: enlazar al capítulo 14.
  - Este capítulo es la otra cara del tutorial de conductores (pedir acceso). Enlazar a esa página en la misma sección.
- **Capturas**: `documentos-ajustes`, `documentos-lista`, `documentos-acceso`.

### 2.16 Usuarios (`usuarios`)
- **Secciones**:
  - «Tu cuenta y la de administración»:
    - La cuenta del sistema no se edita ni se desactiva.
    - La tuya no se puede desactivar.
  - Las pestañas por rol: Todos, Admin, Supervisor, Conductor y HSE.
  - Los filtros: «Filtrar por rol», «Fecha de creación», Columnas y «Mostrar desactivados».
  - «Nuevo usuario», «Editar», «Desactivar» / «Reactivar», «Importar» (cap. 6) y «Exportar CSV».
  - La ficha de una persona:
    - «Vehículos que ha tenido».
    - «Documentos personales».
    - «Su grupo como supervisor», solo si lo es.
- **Avisos**:
  - En el menú se llama «Usuarios», pero la URL es `/conductores`. En el texto se dice «Usuarios».
  - La URL no se nombra.
- **Capturas**: `usuarios`, `usuarios-cuentas`, `usuario-nuevo`, `usuario-ficha`.

### 2.17 Enviar correo (`correo`)
- **Recorrido**:
  1. «Tipo de correo» (ocho tipos).
  2. «Contenido».
  3. «Destinatarios»: Administrador, Conductor, Supervisor, Empresa de renting u Otro email.
  4. «Vista previa» → «Enviar correo».
- Atajos del asistente: «Enviar ahora este correo» y «Enviar todos (n)».
- **Aviso**: las capturas se hacen sin pulsar enviar. El seed tiene correos de ejemplo, pero un envío real sale.
- **Capturas**: `correo-1` … `correo-4`.

### 2.18 Informes y facturas (`informes`)
- **Recorrido**:
  1. «Descargas»:
     - Elegir vehículos (Excel completo) o usuarios, y los filtros.
     - «Ver datos», «Descargar Excel» y «Descargar CSV».
  2. «Facturas»: el listado, el filtro Vehículo, «Exportar CSV» y «Nueva factura».
- Cada coche tiene también ⋮ «Gestionar facturas».
- **Capturas**: `informes-descargas`, `informes-facturas`.

### 2.19 Ajustes (`ajustes`)
- **Recorrido**:
  1. **Catálogos**. Una subpestaña por maestro:
     - Proyectos.
     - PEP / CECO.
     - Unidades de negocio.
     - Rentings.
     - Países.
     - Marcas.
     - Modelos.
     - Sociedades.
     - Combustibles.
     - Sedes.
     - Programas de mantenimiento.
  2. **Borrado definitivo**:
     - Qué se puede «Restaurar».
     - La vista previa «Se eliminarán además:».
     - **«Eliminar definitivamente»**, con la chapa «Solo superusuario».
  3. **Plantillas de correo**:
     - «Trazas» (últimos envíos).
     - «Configuración»:
       - Recordatorios de km, combustible, ITV y mantenimiento.
       - Avisos por incidencias y por accidentes.
       - Aspecto del correo.
     - «Plantillas por tipo de correo».
- **Aviso**: «Eliminar definitivamente» no tiene vuelta atrás. El capítulo lo dice antes de enseñarlo, no después.
- **Capturas**: `ajustes-catalogos`, `ajustes-borrado`, `ajustes-purgar`, `ajustes-plantillas`, `ajustes-configuracion`.

### 2.20 Vista HSE (`hse`) — chapa «Necesita el rol HSE»
- **Secciones**:
  - Es de **solo lectura**.
  - Las cuatro cifras: Coches activos, Con lectura este mes, Con consumo este mes y Sin leer hace +30 días.
  - Las pestañas:
    - «Vehículos», con «Incluir los coches parados» y las gráficas de km y consumo.
    - «Informe»: Resumen, Vehículos y Kilometraje.
  - Quien es HSE sin ser admin solo ve esta pantalla, y sin menú.
- **Capturas**: `hse`, `hse-informe`.

### 2.21 Preguntas frecuentes (`preguntas`)

Solo preguntas que hayan llegado de verdad. Se recogen durante la fase 4 preguntando a
administración. Candidatas que el propio código ya responde:
- «¿Por qué no puedo desactivar mi cuenta?»
- «¿Por qué no me sale "Eliminar definitivamente"?»
- «¿Por qué no veo la pantalla HSE?»
- «¿Dónde están las facturas?» Están en Informes; la ruta antigua de Ajustes redirige.
- «Al importar, una fila sale en errores aunque los datos están bien.» La sociedad, el
  proyecto, el CECO, el supervisor o el conductor tienen que existir ya en la base.
- «He importado el mismo fichero dos veces, ¿tengo duplicados?» No: lo que ya existe se
  actualiza o se queda sin cambios.
- «He detenido una importación, ¿se deshace lo importado?» No.
- «¿Por qué no puedo identificar al conductor por su DNI al importar?» El DNI ya no se
  guarda: usa su correo o su usuario.

---

## 3. Ruta, menú y atajo

1. **Página perezosa** en `src/App.tsx`, dentro del bloque protegido, junto a las demás:
   ```tsx
   // Ayuda (tutorial de administración): contenido estático, chunk propio.
   const TutorialPage = page(() => import('./pages/TutorialPage.tsx'), 'TutorialPage')
   // …
   <Route path="/ayuda" element={<TutorialPage />} />
   <Route path="/ayuda/:capitulo" element={<TutorialPage />} />
   ```
   - El capítulo va en la URL, como `/ajustes/:tab`. Un id que no existe cae en el índice.
   - El paso de un recorrido va en `?paso=N`, para poder mandar el enlace exacto.
2. **Clave de navegación** en `i18n.tsx`:
   - Añadir `help` a `shell.nav`: es «Ayuda» (bloque es, líneas ~14-30) y en «Help» (bloque en, ~362-378).
   - El tipo `const en: typeof es` obliga a poner las dos.
3. **Menú** (`components/AppHeader.tsx`):
   - Una entrada «Ayuda» en el grupo *General*, debajo de «Panel».
   - Icono `LifeBuoy` de `lucide-react`. Hay que importarlo: hoy la cabecera importa AlertTriangle, Bell, BellRing, Car, FileText, FolderOpen, Gauge, HardHat, Home, KeyRound, LogOut, Menu, Settings, Siren y Users.
4. **Atajo** (`components/Layout.tsx`, `GO_KEYS`):
   ```ts
   { key: 'y', path: '/ayuda', nav: 'help' },
   ```
   - La «y» de aYuda está libre. Ya están cogidas `h v a i x k f c d m j t`.
   - La hoja «?» lo enseña sola, porque lee `GO_KEYS`.
5. **Pista de la cabecera** (`shell.shortcutsHint`):
   - Hoy dice `"?" ayuda`, y `?` abre la **hoja de atajos**, no esta vista. Con una vista llamada «Ayuda», eso confunde.
   - Cambiarla a `"?" atajos · "g y" ayuda`. En inglés, `"?" shortcuts · "g y" help`.
   - Revisar también `shortcuts.help`, que es el texto de la línea `?` en la hoja.
6. (Fase 5) **Ayuda en contexto**:
   - `PageHeader` acepta `actions` pero no `children` (`front/src/ui/display/PageHeader.tsx:15-28`).
   - El enlace «¿Cómo funciona?» va en `actions`, con un componente pequeño `HelpLink`:
     ```tsx
     // tutorial/HelpLink.tsx
     export function HelpLink({ chapter }: { chapter: ChapterId }) {
       const t = useTutorialCopy()
       return <Link className="help-link" to={`/ayuda/${chapter}`}>{t.ui.howItWorks}</Link>
     }
     ```
   - **No tocar el DS** para esto. Si más adelante otra app lo quiere, se sube.
   - El mapa `ruta → capítulo` vive en `tutorial/chapters.ts`, para no repetir ids a mano.

---

## 4. Estructura del código

```
front-gestion/src/
  pages/TutorialPage.tsx            # la vista: índice + capítulo activo
  pages/TutorialPage.test.tsx
  tutorial/
    chapters.ts                     # estructura: id, grupo, icono, ruta, capturas, recorrido
    chapters.test.ts                # integridad del contenido (§9.2)
    TutorialIndex.tsx               # índice agrupado + buscador
    ChapterView.tsx                 # pinta un capítulo a partir de chapters + copia
    Walk.tsx                        # recorrido por pestañas (Atrás / Continuar, flechas)
    Shot.tsx                        # captura en marco de escritorio + visor
    QuickGuide.tsx                  # «¿Qué quieres hacer?» → abre el paso N
    HelpLink.tsx                    # «¿Cómo funciona?» para los PageHeader (fase 5)
    search.ts                       # normalización y búsqueda (sin acentos, por palabras)
    shots.ts                        # nombre → URL de la captura, por idioma
    tutorial.css                    # estilos propios (prefijo .tut-)
  translations/tutorial.ts          # copia es/en
  assets/tutorial/es/*.webp         # capturas con la app en castellano
  assets/tutorial/en/*.webp         # y en inglés
```

### 4.1 La estructura va en datos, la prosa en la copia

`chapters.ts` describe **qué** hay, sin texto. `translations/tutorial.ts` dice **cómo se
cuenta** en cada idioma.

```ts
// tutorial/chapters.ts
import type { LucideIcon } from 'lucide-react'
import { Car, Gauge, /* … */ LifeBuoy } from 'lucide-react'

export const CHAPTER_IDS = [
  'entrar', 'panel', 'vehiculos', 'ficha', 'alta', 'importar', 'estado',
  'incidencias', 'resolver', 'accidentes', 'itv-mantenimiento', 'kilometraje',
  'alertas', 'solicitudes', 'documentos', 'usuarios', 'correo', 'informes',
  'ajustes', 'hse', 'preguntas',
] as const
export type ChapterId = (typeof CHAPTER_IDS)[number]

export type GroupId = 'start' | 'fleet' | 'events' | 'papers' | 'admin' | 'other'

export interface Chapter {
  id: ChapterId
  group: GroupId
  icon: LucideIcon
  route?: string          // pantalla que explica («Abrir esta pantalla»)
  routes?: RegExp[]       // rutas que enlazan aquí desde «¿Cómo funciona?»
  shots: string[]         // nombres de captura, en orden
  walk?: number           // nº de pestañas del recorrido
  audience?: 'superuser' | 'hse'
}

export const CHAPTERS: Chapter[] = [
  { id: 'vehiculos', group: 'fleet', icon: Car, route: '/vehiculos',
    routes: [/^\/vehiculos$/],
    shots: ['vehiculos', 'vehiculos-filtros', 'vehiculos-cortes', 'vehiculos-menu', 'vehiculos-sustituto'] },
  // …
]

/** Capítulo de una ruta de la app (para la ayuda en contexto). */
export function chapterForPath(path: string): ChapterId | undefined {
  return CHAPTERS.find((c) => c.routes?.some((r) => r.test(path)))?.id
}
```

### 4.2 La copia: una función por idioma con la misma forma

```ts
// translations/tutorial.ts
import { useAppLang } from '@flota/ui/i18n'
import type { ChapterId } from '../tutorial/chapters.ts'
import { useVehiclesCopy } from './vehicles.ts'
import { useRequestsCopy } from './requests.ts'
// … una importación por pantalla citada

/** Rótulos de la app que el tutorial cita (§4.3). */
interface Ui {
  vehicles: ReturnType<typeof useVehiclesCopy>
  requests: ReturnType<typeof useRequestsCopy>
  // …
}

interface ChapterCopy {
  title: string
  lead: string                       // una frase: para qué sirve la pantalla
  sections: { title: string; steps: string[]; note?: string }[]
  walk?: { tab: string; title: string; steps: string[] }[]
  quick?: { label: string; step: number }[]
  shots: Record<string, string>      // nombre de captura → texto alternativo
  faq?: { q: string; a: string }[]
}

const es = (ui: Ui) => ({
  ui: {
    title: 'Ayuda',
    subtitle: 'Cómo se usa la app de gestión, pantalla a pantalla',
    search: 'Buscar en la ayuda',
    openScreen: 'Abrir esta pantalla',
    howItWorks: '¿Cómo funciona?',
    shotPending: 'Captura pendiente',
    back: 'Atrás',
    next: 'Continuar',
    // …
  },
  groups: { start: 'Primeros pasos', fleet: 'La flota', events: 'Lo que pasa',
            papers: 'Papeles y personas', admin: 'Administración', other: 'Otros' },
  audience: { superuser: 'Solo superusuario', hse: 'Necesita el rol HSE' },
  chapters: {
    vehiculos: {
      title: 'Vehículos',
      lead: 'El inventario de la flota: buscar, filtrar, exportar y actuar sobre un coche.',
      sections: [
        { title: 'Sacar un listado',
          steps: [`Filtra lo que quieras y pulsa «${ui.vehicles.exportCsv}».`] },
      ],
      // …
    },
  } satisfies Record<ChapterId, ChapterCopy>,
})

const en: typeof es = (ui) => ({ /* misma forma */ })

export function useTutorialCopy() {
  const lang = useAppLang()
  const ui: Ui = { vehicles: useVehiclesCopy(), requests: useRequestsCopy() /* … */ }
  return (lang === 'en' ? en : es)(ui)
}
```

- `satisfies Record<ChapterId, ChapterCopy>` obliga a que **cada capítulo tenga copia**.
- `const en: typeof es` obliga a que el inglés tenga **la misma forma**.
- Lo que el tipo no ve es la **longitud** de las listas (pasos de un recorrido). Eso lo
  comprueba la prueba de integridad (§9.2).
- Los hooks de copia se llaman siempre, en el mismo orden, sin condiciones. Es la regla
  de los hooks.

### 4.3 Rótulos de la app sacados de su propia copia

En vez de escribir «Exportar CSV» en la copia del tutorial, se usa la clave de la
pantalla: `ui.vehicles.exportCsv` (comprobada: `vehicles.ts:13`). Ventajas:
- Si mañana el botón se renombra, el tutorial cambia solo.
- Si se borra la clave, **no compila**.

Es la versión «a prueba de olvidos» de la regla de oro del tutorial de conductores.

- **Cuándo sí**: todo rótulo que el usuario tiene que buscar en pantalla (botones,
  pestañas, opciones de un desplegable, títulos de ventana).
- **Cuándo no**: la explicación. «Exporta solo lo que ves» es prosa del tutorial.
- Rótulos con parámetros, como `pendingRequests(n)` o `titles.itv(plate)`: se llaman con
  un ejemplo neutro o se describe la forma («la ventana *Registrar ITV · matrícula*»).
- Rótulos que están en `i18n.tsx` (cabecera, atajos, login): se toman de `useLang().t`,
  que el hook `useTutorialCopy` también puede leer.

### 4.4 Capturas por idioma

```ts
// tutorial/shots.ts
const files = import.meta.glob('../assets/tutorial/*/*.webp', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>

export function shotUrl(lang: 'es' | 'en', name: string): string | undefined {
  return files[`../assets/tutorial/${lang}/${name}.webp`]
    ?? files[`../assets/tutorial/es/${name}.webp`]   // reserva: la castellana
}
export const SHOT_NAMES = new Set(
  Object.keys(files).map((k) => k.replace(/^.*\/(es|en)\//, '$1:').replace(/\.webp$/, '')),
)
```

- `eager` con `?url` solo mete **las URLs** en el chunk. Las imágenes se piden cuando se
  pinta el `<img loading="lazy">`.
- Sin `shotUrl`, `Shot` enseña «Captura pendiente» en un recuadro discontinuo, no una
  imagen rota.

### 4.5 Componentes del DS que se reutilizan

| Pieza | Del DS | Nota |
|---|---|---|
| Cabecera | `PageHeader` | `title`, `subtitle` y `actions` (buscador o «Índice») |
| Secciones plegables | `CollapsibleCard` + `useAccordion` | una por sección del capítulo |
| Visor de capturas | `Modal` | cierra con Esc y devuelve el foco |
| Chapas | `Badge` / `Chip` | público y «Nuevo» |
| Pestañas del recorrido | `TabButton` o `SegmentedControl` | con `role="tablist"` |
| Buscador | `TextInputField` | `type="search"`: así el atajo `/` lo encuentra (`Layout.tsx:79`) |
| Botones | `Button` | «Abrir esta pantalla», Atrás/Continuar |

- Importar **por subpath** (`@flota/ui/ui`).
- Lo que no exista en el DS se hace en `tutorial/`, no en el DS: es de una sola vista.

---

## 5. La vista (`TutorialPage`)

- **Disposición**:
  - Índice a la izquierda, pegado al hacer scroll (`position: sticky`), y el capítulo a la derecha.
  - En anchos de menos de ~1000 px, el índice se pliega en un botón «Índice» dentro de `actions`.
- **Sin capítulo en la URL** (`/ayuda`) se ve la **portada**:
  - Una frase de bienvenida.
  - Los seis grupos como tarjetas.
  - «Empieza por aquí» (capítulos 1 y 2).
  - El vídeo, si existe (fase 6).
- **Un capítulo cada vez** (el de la URL). La página de conductores pesa 190 KB de HTML
  porque lo pinta todo; aquí cada capítulo monta sus capturas solo cuando se abre.
- **Cada capítulo**, en este orden:
  1. Cabecera: icono, título (`h2`), `lead` y chapa de público si la lleva.
  2. **«Abrir esta pantalla»**: navega a `route`. Es lo que un HTML suelto no puede hacer y la razón de integrarlo.
  3. **Guía rápida** («¿Qué quieres hacer?»), si el capítulo tiene varios caminos. Cada caso abre su pestaña del recorrido y actualiza `?paso=N`.
  4. **Recorrido** por pestañas, si la pantalla es un asistente o tiene pestañas. Atrás / Continuar, flechas ← →, y «Paso 2 de 4».
  5. **Secciones**: pasos numerados y captura con marcas numeradas.
  6. Avisos (`.callout`) y dudas frecuentes del capítulo.
  7. Pie: «← capítulo anterior · capítulo siguiente →», en el orden del índice.
- **Buscador**:
  - Busca en títulos, `lead`, pasos y preguntas de **todos** los capítulos. La copia es texto y ya está cargada.
  - Normaliza: minúsculas, sin acentos (`normalize('NFD')` y quitar los diacríticos) y por palabras sueltas, que tienen que estar todas.
  - Los resultados salen debajo del buscador, con el capítulo y el paso. Al pulsar uno se va a `/ayuda/<id>?paso=N`.
- **Idioma**: lo pone el conmutador ES/EN de la app (`useAppLang`). No hay conmutador propio.
- **Título de la pestaña del navegador**: ninguna página de gestión toca hoy
  `document.title`. Esta tampoco, para no ser la única distinta. Si se quiere, es un
  cambio aparte para todas.
- **Volver**: al entrar desde «¿Cómo funciona?», el capítulo lleva un «← Volver a <pantalla>» (`location.state.from`).
- **Accesibilidad**:
  - Pestañas con `role="tablist"`/`tab`/`tabpanel` y flechas.
  - El visor cierra con Esc y devuelve el foco.
  - El `alt` de cada captura sale de la copia.
  - Las marcas numeradas llevan `aria-hidden`; el número también está en el texto del paso.
  - El índice es un `<nav aria-label>`, con `aria-current="page"` en el capítulo abierto.
- **Estilos**: en `tutorial/tutorial.css`, con el prefijo `.tut-` y los tokens del DS. Nada de colores fijos, para que valga en claro y en oscuro si el DS lo tiene.

---

## 6. Cómo se escribe (guía de estilo)

Las mismas reglas del tutorial de conductores, adaptadas:

1. **Tú**, frases cortas, verbo delante: «Pulsa», «Elige», «Marca».
2. **Los rótulos entre «»**, tal cual salen en pantalla, y siempre desde su clave (§4.3).
   - En inglés van entre comillas tipográficas “ ” y se sigue el mismo criterio.
3. **Nada que la pantalla no haga.** Si una frase no se puede comprobar abriendo la
   pantalla en dev, no va.
4. **Un capítulo empieza por para qué sirve** (el `lead`) y no por dónde está el botón.
5. **Lo irreversible se avisa antes**:
   - Convertir en coche de flota.
   - Eliminar definitivamente.
   - Borrar datos de terceros.
   - Enviar correo.
   - Lo ya importado al detener una importación.

   «Dar de baja» **sí** tiene vuelta atrás: el coche se reactiva en Ajustes → Borrado
   definitivo (`vehicles.ts`, `confirmDeactivate`). Se dice así, para que nadie lo tema
   más de la cuenta.
6. **Sin URLs ni nombres técnicos** (`/conductores`, `km_overage`, `ResolveDispatcher`).
   Se habla de pantallas y botones.
7. **Las marcas de las capturas** siguen el orden de los pasos: el paso 2 es la marca 2.
8. **Inglés**: traducción del castellano, no reescritura. Mismos pasos, mismo orden y
   mismas capturas, pero las de `en/`.

---

## 7. Capturas

### 7.1 El script

`docs/tutoriales-capturas/capture-gestion.mjs`, sobre el mismo `cdp.mjs` (Edge, CDP), con:
- `APP_URL = http://localhost:5173` (gestión en dev, `vite --port 5173`) y el back en dev con el seed.
- Ventana de escritorio **1440×900 a 2x**: `Emulation.setDeviceMetricsOverride` con `mobile: false`.
- Una **lista de tareas** declarativa. Cada una tiene un nombre, la ruta, las acciones y el recorte:

```js
// node docs/tutoriales-capturas/capture-gestion.mjs <es|en> [nombre…]
const TASKS = [
  { name: 'vehiculos', path: '/vehiculos', clip: 'main' },
  { name: 'vehiculos-menu', path: '/vehiculos',
    act: async (b) => { await click(b, 'tr:first-child [aria-haspopup="menu"]') },
    clip: '[role="menu"]', pad: 120 },
  { name: 'estado-1', vehicle: 'showcase',
    act: async (b) => { await openPending(b); await clickTab(b, 0) }, clip: 'dialog' },
  // …
]
```

- Con nombres como argumento solo rehace esas capturas. Es lo normal cuando cambia una pantalla.
- Ayudantes comunes: `click(sel)`, `clickTab(i)`, `waitFor(sel)`, `openPending()` y
  `vehicleId('8888TRX')` (por la API, como hace el e2e con `findVehicle`).

### 7.2 Entrar sin escribir contraseñas

- Usar el **bloque de desarrollo del login**: el desplegable de usuarios de prueba y
  «Entrar sin contraseña», que solo existe en dev.
- Así el script **no lleva ninguna credencial** (regla de la organización) y vale para
  cualquier usuario del seed.
- **Usuarios del seed** (`back/fleet/services/seed.py`):

  | Usuario | Qué es | Para qué capturas |
  |---|---|---|
  | `admin` (Alicia) | superusuario con los cuatro roles (admin, supervisor, conductor, HSE) y dueña del escaparate `8888TRX` | casi todas, incluido «Eliminar definitivamente» y `/hse` |
  | `ana_hse` | admin + HSE, **no** superusuario | ver Borrado **sin** «Eliminar definitivamente» (la chapa del cap. 19) |
  | `hse` | HSE puro | la cabecera HSE sin menú (cap. 20) |

- Cada cambio de usuario es un inicio de sesión más (§7.4). Agrupar las tareas por usuario.

### 7.3 Idioma

- El idioma se guarda en `localStorage`, con la clave `gs_base_lang`
  (`front/src/i18n/language.ts`).
- El script lo fija **antes de cargar** la app, con
  `Page.addScriptToEvaluateOnNewDocument` y `localStorage.setItem('gs_base_lang', 'en')`.
  No hace falta pulsar el conmutador.
- Al empezar, comprobar que `document.documentElement.lang` es el pedido.
- Una ejecución por idioma.

### 7.4 Trampas conocidas

- **Límite de inicios de sesión** (`THROTTLE_ANON_RATE`, y el 429 del dev-login que ya
  sufre el e2e): una sola entrada por ejecución, todas las tareas detrás.
- Entrar como `admin` **cierra su otra sesión**. Si tienes gestión abierta como admin, te echa.
- Esperar **≥ 1,8 s** tras abrir un modal o cambiar de paso: el DS anima y el `Modal`
  tarda en montar.
- **Nunca guardar, enviar, resolver ni borrar**: abrir, rellenar y fotografiar. El script
  no pulsa ningún botón primario de pie de modal. Una lista de rótulos prohibidos lo
  comprueba antes de cada clic.
- El correo: en dev no debería salir, pero **no se llega a la vista previa con
  destinatarios reales**. Se usan los del seed.

### 7.5 Localizar sin depender del texto

- Las tareas tienen que funcionar en castellano y en inglés, así que se buscan por
  `role`, `aria-label`, la clase o el orden, no por «Guardar».
- Hoy **no hay ni un `data-tutorial` ni un `data-testid`** en gestión. Donde no haya
  asidero:
  - Añadir `data-tutorial="<nombre>"` en el componente. Es inocuo y estable.
  - Una línea en `CLAUDE.md` dice para qué sirve, para que nadie lo borre «por limpio».

### 7.6 Salida, recorte y peso

- **Originales PNG** en `tutoriales/administradores/capturas/{es,en}/`.
- Conversión a **WebP**, calidad ~82, a `front-gestion/src/assets/tutorial/{es,en}/`.
  - Adaptar `webp.mjs`: hoy lee `tutoriales/img`. Un argumento `origen destino` lo deja
    valiendo para los dos tutoriales.
  - **No borrar el PNG** en este caso, a diferencia de conductores: es el original.
- **Recortes**:
  - Los modales, al modal más un margen (`clip` del `getBoundingClientRect`).
  - Las pantallas enteras, a `main`.
  - Una captura de 2880 px de ancho para enseñar un botón no se lee: si el botón es
    pequeño, recorte de su zona.
- **Marcas numeradas**: no se pintan en la imagen. Se ponen encima en el componente
  (`Shot` recibe `marks: {n, x%, y%}[]`), y así no hay que rehacer la captura para
  moverlas.
- **Peso**: meta < 150 KB por captura y < 1,5 MB por capítulo.

### 7.7 Revisión

Un `check-gestion.mjs`, hermano de `check.mjs`:
- Abre `/ayuda/<id>` en dev y recoge errores de JS y capturas en «pendiente».
- Fotografía el capítulo para revisarlo a ojo en `docs/tutoriales-capturas/revision/`.

---

## 8. Vídeo de introducción (opcional, fase 6)

- Reutilizar `docs/tutoriales-capturas/video_promo.py`:
  - Sacar las escenas a un fichero (`scenes-gestion.json`) en vez de tenerlas en el código.
  - Plantilla horizontal de escritorio en vez del marco de móvil.
  - Ojo: sus rutas (`OUT`, `IMG`) y las de `video_reencode.mjs` apuntan todavía a
    `tutoriales/img` y `tutoriales/video`. Desde que el tutorial de conductores se movió a
    `tutoriales/conductores/` hay que **parametrizarlas** (argumento `--tutorial
    conductores|administradores`) antes de usarlas para nada.
- El vídeo (~6 MB) va en `front-gestion/public/tutorial/`, servido tal cual sin pasar por
  el bundle. Solo se pide al abrir la portada (`preload="metadata"`, `muted`,
  `playsinline`).
- Las mismas reglas que el de conductores:
  - Nada que el tutorial no diga.
  - Sin audio.
  - Una versión por idioma.
  - Una lista de escenas al lado para saltar.
- Cada escena va con su capítulo: pulsarla puede llevar a `/ayuda/<id>`.

---

## 9. Pruebas

### 9.1 Vitest (`pages/TutorialPage.test.tsx`, con `src/test/setup.ts`)

Montar como `AlertsPage.test.tsx`: `MemoryRouter` con `initialEntries` y
`LanguageProvider` de `../i18n.tsx`. Hace falta una `Routes` con `/ayuda` y
`/ayuda/:capitulo`, para que `useParams` funcione. No hay API que simular.

- **Inglés** en la prueba: `localStorage.setItem('gs_base_lang', 'en')` antes de montar, y
  `localStorage.clear()` en el `beforeEach`.
- **«Abrir esta pantalla»**: una ruta `/vehiculos` de mentira en el mismo `Routes`, que
  pinte un texto conocido.

```tsx
function renderAt(url: string) {
  return render(
    <LanguageProvider>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/ayuda" element={<TutorialPage />} />
          <Route path="/ayuda/:capitulo" element={<TutorialPage />} />
          <Route path="/vehiculos" element={<p>pantalla-vehiculos</p>} />
        </Routes>
      </MemoryRouter>
    </LanguageProvider>,
  )
}
```

Comprobar que:
- `/ayuda` pinta la portada y el índice agrupado (seis grupos);
- `/ayuda/vehiculos` pinta el `h2` del capítulo y «Abrir esta pantalla» navega a `/vehiculos`;
- `/ayuda/no-existe` cae en la portada;
- `/ayuda/solicitudes?paso=3` abre la tercera pestaña del recorrido, y «Continuar» cambia la URL;
- el buscador filtra: «bandeja» sin tilde encuentra Solicitudes y «solicitud documento» exige las dos palabras;
- cambiar el idioma cambia la copia;
- sin captura sale «Captura pendiente» y no un `<img>` roto;
- los capítulos con `audience` enseñan su chapa.

Recordatorio de las trampas del DS en pruebas: el `Modal` tarda ~0,2 s en desmontar
(`waitFor`).

### 9.2 Integridad del contenido (`tutorial/chapters.test.ts`)

Comprobar que:
- `CHAPTERS` tiene cada `ChapterId` una vez, y en el orden de `CHAPTER_IDS`;
- para cada capítulo y cada idioma, la longitud de `walk` en la copia es igual a `chapter.walk`;
- cada captura de `chapter.shots` existe en `assets/tutorial/es/` (`SHOT_NAMES`). La falta de la inglesa es **aviso**, no fallo, hasta la fase 4;
- cada captura tiene `alt` en los dos idiomas;
- cada `route` existe en el router:
  - exportar desde `App.tsx` una lista `APP_PATHS` con las rutas, y usarla también en el router para que no se desincronice;
  - o, si no se quiere tocar `App.tsx`, una lista en la prueba con un comentario que lo diga;
- cada `quick[].step` existe en `walk`;
- ninguna cadena de la copia tiene `TODO`, `XXX` ni la secuencia `«»`.

Las pruebas de copia se hacen con un componente de prueba que llama a `useTutorialCopy()`
en los dos idiomas, porque la copia es un hook.

### 9.3 e2e (Playwright, `e2e/tests/gestion/navegacion.spec.ts`)

- Añadir `['/ayuda', 'Ayuda']` a `PANTALLAS`. El h1 es siempre «Ayuda» (§0).
- En «el menú de la cabecera navega»: abrir el menú y pulsar el enlace «Ayuda».
- Una prueba nueva del atajo: `g` y luego `y` → `/ayuda`.
- Fase 5: «¿Cómo funciona?» desde Vehículos → `/ayuda/vehiculos`.
- Las trampas de la suite: el 429 del dev-login, y una suite cada vez.

### 9.4 En verde antes de cada PR

`typecheck`, `lint` y `test` de `front-gestion`. En esta máquina `npm` está roto, así que
van con `node node_modules/...`, y vitest con `--maxWorkers=2`.

---

## 10. Fases paso a paso

### Fase 1 — Esqueleto
1. `tutorial/chapters.ts` con los 21 ids y solo `panel` completo.
2. `translations/tutorial.ts` con `ui`, `groups`, `audience` y la copia de `panel` en es/en.
   - Los otros capítulos llevan solo `title` y `lead`.
   - Los demás campos son opcionales para que compile.
3. `pages/TutorialPage.tsx`: portada, índice y `ChapterView` con secciones (sin recorrido ni capturas).
4. Ruta en `App.tsx`, `shell.nav.help`, la entrada del menú, el atajo `g y` y la pista de la cabecera (§3.1-3.5).
5. `TutorialPage.test.tsx` con las cuatro primeras comprobaciones de §9.1.

**Hecho cuando**:
- `/ayuda` y `/ayuda/panel` cargan en dev;
- el menú y `g y` llevan allí;
- las pruebas están en verde.

### Fase 2 — Componentes
1. `Shot` con el visor y las marcas.
2. `Walk` con `?paso`.
3. `QuickGuide`.
4. `search.ts` y el buscador.
5. Los pies anterior/siguiente.
6. `chapters.test.ts` (§9.2).

**Hecho cuando**: el capítulo `panel` usa todo, con capturas provisionales o «pendiente».

### Fase 3 — Capturas
1. `capture-gestion.mjs` (§7) con las tareas de los capítulos 1-7.
2. `webp.mjs` parametrizado.
3. Los `data-tutorial` imprescindibles.
4. `check-gestion.mjs`.

**Hecho cuando**:
- las capturas de los capítulos 1-7 están en es y en;
- ninguna sale en «pendiente»;
- `check-gestion` termina limpio.

### Fase 4 — Contenido
Un capítulo detrás de otro, en el orden del índice. Por cada uno:
1. Abrir la pantalla en dev y releer su `translations/*.ts`.
2. Escribir la copia es desde el guion (§2), con rótulos por clave (§4.3).
3. Añadir sus tareas de captura y lanzarlas en es.
4. Revisarlo en la vista.
5. Traducir a en y lanzar las capturas en.
6. Pruebas en verde y un PR pequeño por capítulo o por grupo.

**Hecho cuando**:
- los 21 capítulos tienen texto y capturas en los dos idiomas;
- alguien de administración lo ha revisado.

### Fase 5 — Ayuda en contexto
1. `HelpLink` en el `actions` del `PageHeader` de cada pantalla del inventario.
2. «← Volver a…» en el capítulo.
3. El e2e (§9.3).

**Hecho cuando**: cada pantalla enlaza a su capítulo.

### Fase 6 — Opcional
- El vídeo (§8).
- El capítulo HSE enlazado desde la cabecera HSE (`HseHeader`, que no tiene menú: un
  icono de ayuda junto al idioma). Revisar si el HSE puro puede entrar a `/ayuda/hse` o
  si hace falta permitirle esa ruta en `HseOnlyRedirect`.

---

## 11. Mantenimiento

- **Al cambiar una pantalla** (en el mismo PR):
  - Si cambia un rótulo, nada que hacer, gracias a §4.3. Si desaparece, no compila, y se arregla el paso.
  - Si cambia la maquetación, rehacer sus capturas: `capture-gestion.mjs es <nombres>` y luego `en`.
  - Si cambia el comportamiento, corregir el paso, en los dos idiomas.
  - Si la pantalla es nueva, añadir su capítulo o sección y su línea al inventario (§1).
- **Una línea en `CLAUDE.md`** («Patrones transversales del front»). Dice:
  - dónde vive la ayuda;
  - que los rótulos van por clave;
  - que las capturas se rehacen con el script;
  - que `data-tutorial` no se borra.
- **Revisión trimestral**: pasar `check-gestion.mjs` por todos los capítulos y mirar las
  capturas contra la app.
- **Fecha en la portada**: «Revisado el …», que se actualiza a mano en la copia al
  revisar.

---

## 12. Riesgos y preguntas abiertas

| Riesgo / duda | Qué hacer |
|---|---|
| Las capturas envejecen antes que el texto | Script por nombre (§7.1) y revisión trimestral. Las marcas van en el componente, no en la imagen. |
| El chunk de la copia crece (21 capítulos × 2 idiomas) | Es texto: decenas de KB. Si pasa de ~150 KB, partir la copia por capítulo con `import()`. |
| `useTutorialCopy` llama a muchos hooks de copia | Son lecturas de un diccionario: coste despreciable. Si molesta, pasar solo los namespaces de cada capítulo. |
| ¿Ve la ayuda el HSE puro? | Decidir en la fase 6 (§10). Por defecto, no. |
| ¿Hay que enseñar datos de terceros o lesionados? | Solo del seed. Si el seed tiene nombres que parecen reales, cambiarlos antes de capturar (RGPD). |
| ¿Se mantiene el tutorial de conductores como HTML suelto? | Sí, por ahora: la PWA no tiene una vista equivalente. Si se integra allí, este plan es la plantilla. |
| La copia de Ajustes aún habla de «facturas» | Ver el anexo B. Arreglarlo antes de escribir el capítulo 19. |

---

## 13. Antes de dar por terminado

- [x] Ningún literal en el JSX; todo en `translations/tutorial.ts` (es/en).
- [x] Los rótulos de la app vienen de la copia de su pantalla (§4.3), no reescritos.
- [ ] Capturas reales y actuales; ninguna con datos personales que no sean del seed, ni
  con correos o teléfonos reales.
- [x] El script de capturas no lleva credenciales: entra por el bloque de desarrollo.
- [x] Las 21 entradas del inventario tienen capítulo, y no se explica nada oculto
  (Notificaciones, `/ui-kit`).
- [x] `chapters.test.ts`, `TutorialPage.test.tsx` y el e2e en verde.
- [ ] Revisado en castellano e inglés, y por alguien de administración.
- [ ] `CLAUDE.md` actualizado (§11) y este plan enlazado desde `docs/PLAN_TUTORIALES.md`.

---

## 14. Capítulo de muestra redactado (`vehiculos`)

Es el modelo para los otros veinte: la forma de la copia, el tono y cómo se citan los
rótulos. Todas las claves `ui.vehicles.*` existen en `translations/vehicles.ts` a esta
fecha.

```ts
// translations/tutorial.ts — dentro de es(ui).chapters
vehiculos: {
  title: ui.vehicles.title,                       // «Vehículos»
  lead: 'El inventario de la flota: encontrar un coche, sacar listados y actuar sobre él sin abrir su ficha.',
  quick: [
    { label: 'Encontrar un coche', step: 1 },
    { label: 'Ver los que tienen algo a punto de vencer', step: 2 },
    { label: 'Sacar un listado', step: 3 },
    { label: 'Hacer algo con un coche', step: 4 },
  ],
  walk: [
    { tab: 'Buscar', title: 'Encontrar un coche', steps: [
      `Elige «${ui.vehicles.tabFleet}» o «${ui.vehicles.tabSubstitute}». El número de cada pestaña es cuántos hay.`,
      `Abre «${ui.vehicles.toolsToggle}» y escribe en «${ui.vehicles.lblSearch}» la matrícula, la marca o el modelo.`,
      `Para afinar, usa «${ui.vehicles.lblState}», «${ui.vehicles.lblSupervisor}», «${ui.vehicles.lblDriver}» o «${ui.vehicles.lblCreated}».`,
      `Con «${ui.vehicles.stateHasSubstitute}» ves los coches que ahora mismo tienen uno de sustitución.`,
    ] },
    { tab: 'Vencimientos', title: 'Ver lo que está a punto de vencer', steps: [
      `Marca uno o varios cortes: «${ui.vehicles.dueItv}», «${ui.vehicles.dueInsurance}», «${ui.vehicles.dueMaint}» o «${ui.vehicles.kmOver}».`,
      'Si marcas varios, salen los coches que cumplen cualquiera de ellos.',
      `«${ui.vehicles.clearFilters}» lo deja todo como al entrar.`,
    ] },
    { tab: 'Listados', title: 'Sacar un listado', steps: [
      'Deja en la tabla solo lo que quieras: filtros, cortes y columnas.',
      `Pulsa «${ui.vehicles.exportCsv}». Se exporta lo que estás viendo, no toda la flota.`,
    ] },
    { tab: 'Acciones', title: 'Hacer algo con un coche', steps: [
      'Pulsa los tres puntos ⋮ al final de su fila.',
      'Desde ahí: correo, conductor, facturas, kilómetros, estado, accidente, ITV y mantenimiento, editar o dar de baja.',
      `«${ui.vehicles.deactivate}» no borra el coche: conserva su histórico y se puede reactivar en Ajustes.`,
    ] },
  ],
  shots: {
    vehiculos: 'La lista de vehículos con sus dos pestañas',
    'vehiculos-filtros': 'El panel de búsqueda y filtros abierto',
    'vehiculos-cortes': 'Los cortes de vencimientos marcados',
    'vehiculos-menu': 'El menú de acciones de un coche',
    'vehiculos-sustituto': 'Una fila desplegada con su coche de sustitución',
  },
  faq: [
    { q: '¿Por qué no encuentro un coche que he dado de baja?',
      a: `Las bajas no salen por defecto: marca «${ui.vehicles.showBajas}».` },
  ],
},
```

- **El inglés** (`en(ui).chapters.vehiculos`) tiene exactamente estas cuatro pestañas,
  estos pasos y estas capturas, traducidos.
- Los rótulos los pone `ui.vehicles` en inglés, porque es la copia `en` de la pantalla.
- `chapter.walk = 4` en `chapters.ts`; la prueba de integridad lo compara.

---

## 15. Esfuerzo orientativo

Es una estimación para planificar, no un compromiso. Se revisa al cerrar la fase 2, que
es cuando se sabe cuánto cuesta un capítulo de verdad.

| Fase | Persona-días | Nota |
|---|---|---|
| 1 · Esqueleto | 1-1,5 | ruta, menú, atajo, copia mínima, pruebas |
| 2 · Componentes | 2-3 | `Walk`, `Shot`, buscador, integridad |
| 3 · Script de capturas | 2-3 | lo más incierto: modales, esperas, `data-tutorial` |
| 4 · Contenido | 0,5-1 por capítulo, unos 10-15 en total | con capturas es/en y revisión |
| 5 · Ayuda en contexto | 1 | `HelpLink` en ~15 cabeceras + e2e |
| 6 · Vídeo y HSE | 2-3 | opcional |

---

## 16. Quién hace qué

| Papel | Qué hace |
|---|---|
| Desarrollo (front) | Fases 1-3 y 5. Mantiene las capturas cuando cambia una pantalla. |
| Redacción (puede ser la misma persona) | Fase 4: copia es y en a partir de §2. |
| Administración de la flota (usuario real) | Revisa cada grupo de capítulos: si se entiende y si es lo que hace en su día a día. Aporta las preguntas frecuentes reales. |
| Revisión de código | Además del código: que no haya literales, que los rótulos vayan por clave y que las capturas solo traigan datos del seed. |

La validación final del contenido la hace una persona de administración, no el
desarrollo. Es un manual de uso: decide quien lo usa.

---

## Anexo A. Glosario es/en (de la copia de la app)

| es | en |
|---|---|
| Vista general | Overview |
| Panel | Overview |
| Vehículos | Vehicles |
| Usuarios | Users |
| Kilometraje | Mileage |
| Alertas | Alerts |
| Accidentes | Accidents |
| Solicitudes | Requests |
| Documentos | Documents |
| Informes | Reports |
| Ajustes | Settings |
| Nuevo vehículo | New vehicle |
| Inicia sesión | Sign in |
| Catálogos | Catalogs |
| Borrado definitivo | Permanent deletion |
| Plantillas de correo | Email templates |
| Ayuda (nuevo) | Help |

Para cualquier otro término, manda la copia `en` de su pantalla. El tutorial no traduce
por su cuenta un rótulo que la app ya traduce.

## Anexo B. Hallazgos al preparar el plan

Cosas vistas en el código que conviene saber o arreglar aparte:
- **Subtítulo de Ajustes desfasado**: `translations/ajustes.ts` dice «Catálogos, borrado
  definitivo, plantillas de correo y facturas», pero las facturas ya viven en Informes
  (`/ajustes/facturas` redirige). La clave `tabs.invoices` sobra.
- **`shell.navGroups.requests`** («Solicitudes») está definido pero no se usa en el menú:
  Solicitudes cuelga de «Incidencias y alertas».
- **La pista de atajos** llama «ayuda» a la hoja de atajos (§3.5).
- **Catálogos**: existe el rótulo «Talleres e ITV» pero no su pestaña.
- **Borrado definitivo de un documento** (`DocumentsPanel`) no mira `is_superuser` en el
  cliente, al contrario que el de `ErratasPage`. Solo sale cuando falta el fichero en
  Drive; confirmar que el back lo limita.
- **El README de `ejemplos-importacion/`**:
  - Habla de «Conductores» (la pantalla ahora se llama Usuarios).
  - No lista `vehiculos-actualizacion.csv` en su tabla.
  - Conviene ponerlo al día antes de enlazarlo desde el capítulo 6.

## Anexo C. Mapa ruta → capítulo (para «¿Cómo funciona?»)

| Ruta de la app | Capítulo |
|---|---|
| `/` | `panel` |
| `/vehiculos` | `vehiculos` |
| `/vehiculos/nuevo`, `/vehiculos/:id/editar` | `alta` |
| `/vehiculos/:id` | `ficha` |
| `/incidencias` | `incidencias` |
| `/accidentes` | `accidentes` |
| `/kilometraje` | `kilometraje` |
| `/alertas` | `alertas` |
| `/solicitudes` | `solicitudes` |
| `/documentos` | `documentos` |
| `/conductores`, `/conductores/:id` | `usuarios` |
| `/informes` | `informes` |
| `/ajustes/:tab` | `ajustes` |
| `/hse` | `hse` (fase 6) |

Los capítulos que son **ventanas** y no pantallas no tienen ruta. Se enlazan desde el
capítulo de la pantalla que las abre, y, si se quiere, desde un «?» pequeño en la cabecera
de la propia ventana (fase 5, opcional):
- `importar`
- `estado`
- `resolver`
- `itv-mantenimiento`
- `correo`

## Anexo D. Plantilla de PR por capítulo

```md
## Ayuda · capítulo <id>

- [ ] Copia es y en (`translations/tutorial.ts`), con los rótulos por clave (§4.3)
- [ ] `chapters.ts`: capturas, `walk`, `route`, `audience`
- [ ] Capturas es y en (`capture-gestion.mjs <lang> <nombres>`), < 150 KB cada una
- [ ] Revisado en dev contra la pantalla real, en los dos idiomas
- [ ] Sin datos que no sean del seed en las capturas
- [ ] typecheck, lint y test de front-gestion en verde
- [ ] Revisado por: <persona de administración>
```

## Anexo E. Fuentes

| Fuente | Para qué |
|---|---|
| `front-gestion/src/translations/*.ts`, `i18n.tsx` | Rótulos exactos (siempre manda esto) |
| `front-gestion/src/App.tsx`, `components/AppHeader.tsx`, `components/Layout.tsx` | Rutas, menú, atajos |
| `front-gestion/src/components/useVehicleActions.tsx` | Menú ⋮ de cada coche |
| `CLAUDE.md` | Comportamiento y reglas de negocio |
| `back/fleet/services/seed.py` | Usuarios y datos de las capturas |
| `ejemplos-importacion/` | Ficheros de ejemplo del capítulo 6 |
| `docs/PLAN_TUTORIALES.md` y `tutoriales/conductores/` | Forma, componentes y lecciones del tutorial de conductores |
| `Gestión de flotas Visuales Administrador.pdf` (raíz del repo) | **Sin revisar** al escribir este plan. Leerlo antes de la fase 4 por si trae un recorrido o un vocabulario que administración ya conoce. Si contradice la app, manda la app. |
