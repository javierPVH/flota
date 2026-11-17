# Plan: los capítulos del vehículo en la Ayuda de gestión

Estado a 16-11-2026. Continúa [PLAN_VISTA_TUTORIAL.md](PLAN_VISTA_TUTORIAL.md) (la vista
`/ayuda` ya existe). Este plan cubre, **en este orden**, cuatro capítulos que van juntos
porque cuentan la vida de un coche en la app:

| Paso | Capítulo (id) | Estado (16-11-2026, implementado) |
|---|---|---|
| 0 | Enlaces `[[id]]` / `[[id#paso]]` | hecho: `RichText`, búsqueda, prueba de enlaces |
| 1 | **Vehículos** (`vehiculos`), ampliarlo | hecho: 6 pestañas, atajos, 2 dudas más; capturas nuevas `vehiculos-columnas`, `-exportar`, `-sustitucion` |
| 2 | **La ficha del vehículo** (`ficha`) | hecho: 5 pestañas y 5 capturas |
| 3 | **Alta y edición de un vehículo** (`alta`) | hecho: 6 pestañas y 6 capturas (los campos por pestaña, comprobados en `VehicleForm.tsx`) |
| 4 | **Cambiar el estado y el coche de sustitución** (`estado`) | hecho: 6 pestañas y 6 capturas |

Cambios frente al plan, al implementarlo:
- `vehiculos-sustituto` (fila desplegada) y `vehiculos-baja` no se hicieron: la pestaña de sustitución y el ⋮ ya lo enseñan.
- `editar-revisar` tampoco: hacerla obligaba a cambiar un campo de un coche real.
- Las capturas se hacen como `ana_hse`, no como `admin`: el back deja una sola sesión por usuario y el script echaba a quien tuviera gestión abierta como admin.

Antes del paso 1 hay un **paso 0** pequeño de infraestructura (enlaces entre capítulos), que
los cuatro necesitan.

---

## Reglas que valen para los cuatro

Son las del plan general; se repiten porque son las que se olvidan:

1. **Rótulos por clave**: cada botón, pestaña u opción que el usuario tenga que buscar se
   escribe con la clave de su copia (`v.exportCsv`, `vd.…`, `vf.…`), nunca a mano.
   - Si una clave tiene parámetros (`editTitle(plate)`), se usa con un ejemplo neutro o
     `withN`.
   - Si una pantalla aún no tiene su copia en `Ui` (`translations/tutorial.ts`), se añade
     su hook a `Ui` y a `useTutorialCopy`.
2. **Nada que no haga la app**: cada frase se comprueba abriendo la pantalla en dev con el
   seed (usuario `admin`, coche escaparate `8888TRX`).
3. **Español e inglés con la misma forma**: los mismos pasos, la misma `quick` y las
   mismas capturas. `chapters.test.ts` lo comprueba.
4. **Capturas** con `docs/tutoriales-capturas/capture-gestion.mjs`, una tarea por captura.
   - **Nunca** se guarda, se envía ni se confirma nada: se abre, se rellena y se cierra.
   - Una carga por pantalla (`ensure`): el límite por usuario echa a la app al login.
   - Se lanza una vez por idioma: `node docs/tutoriales-capturas/capture-gestion.mjs es <nombres>`.
5. **`walk` en `chapters.ts`** = número de pestañas del recorrido. Si no cuadra, la prueba falla.
6. **Revisión**: tests en verde (`tsc`, vitest de `src/tutorial` y `TutorialPage`) y un
   vistazo en `/ayuda/<id>` en los dos idiomas.

---

## Paso 0 · Enlaces entre capítulos

Estos cuatro capítulos se remiten unos a otros todo el rato. Por ejemplo, Vehículos dice
«⋮ → Alertas e incidencias, ver Cambiar el estado». Hoy eso solo se puede escribir como
texto.

**Qué hacer**:

1. En `tutorial/RichText.tsx`, reconocer una marca `[[id]]` o `[[id#paso]]` y pintarla como
   enlace a `/ayuda/<id>` (con `?paso=N`). El texto del enlace es el título del capítulo,
   que se pasa a `RichText` como prop `titles`.
2. En la copia: `'Para pararlo, sigue [[estado]].'`
3. En `chapters.test.ts`, comprobar que cada `[[id]]` de la copia es un `ChapterId` que
   existe.
4. En `search.ts`, quitar las marcas `[[…]]` antes de buscar (o sustituirlas por el título).

**Hecho cuando**: un paso con `[[ficha]]` pinta «La ficha del vehículo» como enlace, y un id
mal escrito rompe la prueba.

---

## Paso 1 · Ampliar «Vehículos» (`vehiculos`)

Fuente: `translations/vehicles.ts` (`useVehiclesCopy`), `pages/VehiclesPage.tsx`,
`components/useVehicleActions.tsx` (el menú ⋮).

### Lo que ya hay

| Pestaña | Contenido | Captura |
|---|---|---|
| Buscar | pestañas flota/sustitución, buscador y filtros | `vehiculos-filtros` |
| Vencimientos | los cortes (ITV, seguro, mantenimiento, km) | `vehiculos-cortes` |
| Listados | filtrar y «Exportar CSV» | `vehiculos` |
| Acciones | menú ⋮ y «Dar de baja» | `vehiculos-menu` |

### Qué se añade

**Recorrido** (pasa de 4 a 6 pestañas):

1. **Buscar** (sin cambios).
2. **Leer la tabla** (nueva):
   - qué dice cada columna;
   - la celda de km avisa del tiempo sin lectura («Sin lecturas», «N días sin lectura») con un
     color;
   - las fechas en ámbar o rojo son vencimientos cercanos o pasados;
   - «Columnas» (`v.lblColumns`, `v.columnsBtn`) elige y ordena las columnas, con «Subir» y
     «Bajar».
   - Captura: `vehiculos-columnas`, con el desplegable de columnas abierto.
3. **Vencimientos** (sin cambios).
4. **Listados**: el modal «Exportar a CSV» no está contado hoy. Hay que ver en la pantalla qué
   deja elegir (registros y columnas) y contarlo.
   - Captura nueva: `vehiculos-exportar`, con el modal abierto y sin exportar.
5. **Sustitución** (nueva):
   - la pestaña «Vehículos de sustitución» (`v.tabSubstitute`);
   - «Libre» y «Ocupado» (`v.free`, `v.busy`);
   - la fila de un coche cubierto se despliega: «Coche de sustitución · Cubre desde …»
     (`v.subRow`, `v.subRowSince`);
   - «Convertir en coche de flota»: solo en sustitutos libres, avisa tres veces y no tiene
     vuelta atrás.
   - Capturas: `vehiculos-sustitucion` (la pestaña) y `vehiculos-sustituto` (una fila
     desplegada; en el seed, `2010NSV` o `2006JHF` tienen la flecha).
6. **Acciones**: el menú ⋮ completo, con un enlace por acción a su capítulo:

   | Acción | Enlace |
   |---|---|
   | Enviar correo | `[[correo]]` |
   | Cambiar conductor / supervisor | — |
   | Gestionar facturas | `[[informes#2]]` |
   | Kilómetros y combustible | `[[kilometraje]]` |
   | Alertas e incidencias | `[[estado]]` y `[[resolver]]` |
   | Accidente | `[[accidentes]]` |
   | Programar ITV y mantenimiento | `[[itv-mantenimiento]]` |
   | Editar | `[[alta#…]]` |
   | Dar de baja | se reactiva en Ajustes → Borrado definitivo (`v.confirmDeactivate`) |

   - «Dar de baja» abre una confirmación; se puede capturar y luego **Cancelar**:
     `vehiculos-baja`.

**Guía rápida**: añadir «Ver los coches de sustitución» (paso 5) y «Elegir las columnas»
(paso 2).

**Al final del capítulo**, una sección «Atajos», con lo que verifica `Layout.tsx`:
- «/» lleva al buscador;
- «n» abre «Nuevo vehículo»;
- «g v» vuelve a Vehículos.

**Dudas frecuentes** (añadir, comprobando cada una):
- «¿Por qué un coche sale en ámbar?» (vencimiento cercano).
- «¿Dónde están los coches de sustitución?» (su pestaña).
- «¿Cómo elijo qué columnas se ven?»

### Capturas nuevas (tareas en `capture-gestion.mjs`)

Todas en una sola carga de `/vehiculos` (`ensure`):

| Nombre | Qué hace la tarea |
|---|---|
| `vehiculos-columnas` | abre el desplegable «Columnas»; recorte a `.cols-menu` y su botón |
| `vehiculos-exportar` | abre «Exportar CSV»; recorte al `[role=dialog]`; lo cierra |
| `vehiculos-sustitucion` | pulsa la 2.ª `.veh-tab`; cabecera, pestañas y tabla |
| `vehiculos-sustituto` | vuelve a flota y despliega la primera fila con flecha; recorte a esa fila y la siguiente |
| `vehiculos-baja` | ⋮ de un coche → «Dar de baja»; recorte al diálogo; **Cancelar** |

**Hecho cuando**:
- `walk: 6` en `chapters.ts`;
- 5 capturas nuevas en es y en;
- pruebas en verde;
- el capítulo, leído en `/ayuda/vehiculos`, explica todo lo que hay en la pantalla.

---

## Paso 2 · «La ficha del vehículo» (`ficha`)

Fuente: `translations/vehicleDetail.ts` (añadir su hook a `Ui`), `pages/VehicleDetailPage.tsx`,
`translations/resolve.ts` (tarjeta de alertas), `translations/panels.ts` (Conductor y
reparto, Documentos).

**Cómo se llega**: pulsando la matrícula en Vehículos o en la vista general. El
`PageHeader` lleva el botón «← Volver» (o «← Vehículos» / «← Vista general»).

**Recorrido** (5 pestañas):

1. **Arriba**:
   - el `h1` es la matrícula y las chapas dan el estado;
   - «Expandir todo» y «Plegar todo»;
   - «Coste mensual» y «Fin de contrato» son indicadores que se pulsan y abren su ventana;
   - la fila de botones: «Enviar correo», «Editar ficha» y el aviso «Estado».
   - Captura: `ficha`.
2. **Los indicadores**. Cada uno abre su ventana:
   - «Vencimiento del seguro»;
   - «Próxima ITV» y «Próximo mantenimiento», que llevan a programar (`[[itv-mantenimiento]]`);
   - «Alertas e incidencias» (`[[estado]]`, `[[resolver]]`);
   - «Kilometraje» y «Consumo medio», que llevan a kilómetros y combustible.
   - Captura: `ficha-indicadores`.
3. **Las tarjetas**: Datos técnicos, Contrato, Facturas, Alertas e incidencias (pestañas
   Incidencias/Alertas × Abiertas/Cerradas), Accidentes, Kilómetros contratados (Anual /
   Contrato completo), Conductor y reparto, y Documentos.
   - Captura: `ficha-tarjetas` (dos o tres tarjetas desplegadas).
4. **El histórico**:
   - cada cambio del coche, con su origen y su autor;
   - el filtro «Origen» y «Ver histórico completo (n)»;
   - la gráfica por días, que solo ve la administración; al pulsar un día salen sus cambios.
   - Captura: `ficha-historico`.
5. **Deshacer un cambio**:
   - «Revertir» sale solo en los cambios que se pueden deshacer;
   - pide confirmar: «Revertir este cambio» → «Sí, revertir»;
   - la captura llega hasta la confirmación y se **cancela**.
   - Captura: `ficha-revertir`.

**Guía rápida**: «Ver todo de un coche» (1), «Saber cuándo vence algo» (2), «Ver quién
cambió qué» (4) y «Deshacer un cambio» (5).

**Avisos**:
- «Revertir» no sale en todos los cambios, solo en los reversibles. Hay que decirlo, para
  que nadie lo busque donde no está.
- La ficha no tiene ruta fija para «Abrir esta pantalla». `chapters.ts` ya la manda a
  `/vehiculos`; añadir una línea «Abre cualquier coche de la lista».

**Capturas**: sobre `8888TRX` (el escaparate del seed, que lo tiene todo):
- la tarea busca su `id` por la API (`/api/v1/vehicles/?search=8888TRX`) con el `fetch` de
  la página, que ya lleva la sesión;
- después abre `/vehiculos/<id>` una sola vez.

| Nombre | Recorte |
|---|---|
| `ficha` | `header` + la fila de botones |
| `ficha-indicadores` | la fila `.detail-kpis` |
| `ficha-tarjetas` | dos tarjetas desplegadas (Datos técnicos, Conductor y reparto) |
| `ficha-historico` | la tarjeta Histórico desplegada |
| `ficha-revertir` | el diálogo de confirmación; **Cancelar** |

**Hecho cuando**:
- `walk: 5` en `chapters.ts`;
- 5 capturas en es y en;
- el índice ya no marca «Pronto»;
- el capítulo se lee en los dos idiomas.

---

## Paso 3 · «Alta y edición de un vehículo» (`alta`)

Fuente: `translations/vehicleForm.ts` (añadir su hook a `Ui`), `pages/VehicleFormPage.tsx`,
`components/VehicleForm.tsx`.

**Cómo se llega**:
- «Nuevo vehículo» en Vehículos, la tecla «n», o «Añadir vehículo» en la vista general;
- para editar: «Editar» en el menú ⋮ o «Editar ficha» en la ficha.

**Recorrido** (6 pestañas):

1. **Qué coche es**:
   - «Tipo de vehículo»: «Flota» o «Sustitución»;
   - un coche de sustitución no tiene la pestaña «Uso y asignación»;
   - la caja «Datos del vehículo» va fija arriba: Matrícula, Bastidor y Matriculación.
   - Captura: `alta-tipo`.
2. **Identificación** (pestaña 1 del formulario).
   - Captura: `alta-1`.
3. **Características técnicas** (pestaña 2).
   - Captura: `alta-2`.
4. **Uso y asignación** (pestaña 3): uso, conductor y supervisor.
   - Captura: `alta-3`.
5. **Propiedad y contrato** (pestaña 4); en la última, «Crear vehículo».
   - El pie fijo: «Cancelar», el aviso «Hay cambios sin guardar.» y «Atrás» / «Siguiente».
   - Captura: `alta-4` (sin pulsar crear).
6. **Editar un coche que ya existe**:
   - el **candado** («Bloqueado» / «Editable») protege los datos sensibles;
   - desbloquear avisa: «Vas a modificar datos sensibles del vehículo» → «Entiendo, quiero
     editarlos»;
   - «Revisar cambios…» enseña lo que vas a guardar, con «Confirmar cambios», «Seguir
     editando» y «Guardar cambios».
   - Capturas: `editar-candado` y `editar-revisar` (sin guardar).

**Antes de escribir los pasos 2 a 5**: abrir cada pestaña en dev y anotar sus campos de
verdad (`vehicleForm.ts`). Este plan no los lista porque no están revisados uno a uno.
Contar solo los obligatorios y los que confunden; no hace falta un paso por campo.

**Guía rápida**: «Dar de alta un coche de flota» (1), «Dar de alta un coche de sustitución»
(1), «Cambiar un dato» (6) y «Cambiar la matrícula o el bastidor» (6).

**Avisos**:
- Para muchos coches de golpe, mejor `[[importar]]`.
- El candado está para que no se cambie la matrícula o el bastidor por descuido.

**Capturas**:
- el alta, en `/vehiculos/nuevo`, rellenando solo lo justo para pasar de pestaña, con datos
  inventados claros (matrícula `0000TUT`), y **sin «Crear vehículo»**;
- la edición, en `/vehiculos/<id de 8888TRX>/editar`: desbloquear el candado, cambiar un
  campo inofensivo, abrir «Revisar cambios…» y **Seguir editando** / Cancelar.

**Hecho cuando**:
- `walk: 6` en `chapters.ts`;
- 8 capturas en es y en;
- comprobado en dev que ninguna tarea crea ni guarda.

---

## Paso 4 · «Cambiar el estado y el coche de sustitución» (`estado`)

Fuente: `translations/vehicles.ts` (bloque `ops`), `components/VehicleStateModal.tsx`,
`components/CreateSubstituteButton.tsx`, `translations/resolve.ts` (`pending.tabNewState`).

**Cómo se llega**: menú ⋮ → «Alertas e incidencias» → pestaña «Nuevo estado». Allí:
«Nuevo estado» / «Estados abiertos».

**Recorrido** (6 pestañas, las del asistente):

1. **«Estado del vehículo»**. El desplegable agrupa:
   - Mantenimiento: «Mantenimiento puntual» y «Cambio de neumáticos»;
   - Avería: «Vehículo averiado»;
   - Otras: «Petición general».
   - Captura: `estado-1`.
2. **«Disponibilidad»**. Las opciones dependen de cómo está el coche:
   - activo: «No activo · se le asigna un coche de sustitución», «No activo · sale sin coche
     de sustitución» o «Activo · el coche sigue en servicio»;
   - parado: «No activo · el coche sigue fuera de servicio» o «Activo · el coche vuelve al
     servicio».
   - Captura: `estado-2`.
3. **El coche de sustitución** (dentro de Disponibilidad, al elegir la primera opción):
   - «Vehículo de sustitución», fechas de inicio y fin, y «Motivo de la sustitución»;
   - «Crear coche de sustitución» lo da de alta sin salir;
   - si ya hay uno: «Sustituto activo» y «Cerrar vínculo (fin hoy)».
   - Captura: `estado-sustituto`.
4. **«Datos del cambio de neumáticos»**: solo aparece con esa opción. El recorrido lo dice
   para que nadie lo busque.
   - Captura: `estado-neumaticos`.
5. **«Gestión · ubicación»** y **«Archivos del estado»**.
   - Captura: `estado-gestion`.
6. **«Comunicado por email»** y **«Guardar»**:
   - el pie: «Anterior» / «Siguiente»;
   - los pasos bloqueados explican por qué al pasar el ratón.
   - Captura: `estado-email` (sin guardar).

**Guía rápida**: «Mandar un coche al taller» (1), «Darle un coche de sustitución» (3),
«Cambiar los neumáticos» (4) y «Devolverlo al servicio» (2, y `[[resolver]]`).

**Avisos**:
- Al resolver la incidencia, el coche puede volver a «Activo» solo, con la casilla
  «Devolver el coche a Activo al resolver» y, si lo hay, dejando libre el sustituto. Se
  explica en `[[resolver]]`; aquí basta con enlazarlo.
- «Crear coche de sustitución» crea un coche de verdad.

**Capturas**:
- sobre un coche **activo** del seed sin estado abierto (comprobarlo antes);
- abrir ⋮ → «Alertas e incidencias» → «Nuevo estado» e ir paso a paso eligiendo opciones;
- **sin «Guardar»** y sin «Crear coche de sustitución»;
- para `estado-neumaticos`, elegir «Cambio de neumáticos» en el paso 1;
- todas las tareas van en un solo modal abierto, y se cierra al final.

**Hecho cuando**:
- `walk: 6` en `chapters.ts`;
- 6 capturas en es y en;
- comprobado en dev que el coche queda igual que estaba.

---

## Orden de trabajo y PRs

| PR | Contenido | Prueba de que está |
|---|---|---|
| 0 | Enlaces `[[id]]` (RichText, búsqueda y prueba) | test de enlaces en verde |
| 1 | Vehículos ampliado + 5 capturas es/en | `/ayuda/vehiculos` con 6 pestañas |
| 2 | La ficha + 5 capturas | sin «Pronto» en el índice |
| 3 | Alta y edición + 8 capturas | sin «Pronto»; nada creado en dev |
| 4 | Cambiar estado + 6 capturas | sin «Pronto»; el coche intacto |

Cada PR lleva la plantilla del anexo D del plan general. Al terminar los cuatro,
actualizar el «Estado» de [PLAN_VISTA_TUTORIAL.md](PLAN_VISTA_TUTORIAL.md).

## Riesgos

| Riesgo | Qué hacer |
|---|---|
| Las capturas del asistente de estado o del alta guardan algo por error | Tareas sin botones primarios del pie; comprobar el coche antes y después |
| El límite de peticiones echa la sesión a mitad | Una carga por pantalla; si pasa, el script para y se repite solo lo que falte |
| Un rótulo del plan ya no coincide con la app | Manda la copia (`translations/*.ts`): el plan se corrige, el tutorial cita la clave |
| Datos del seed que parezcan personales en las capturas | Solo el seed; nombres ficticios. Nada de cuentas reales (el login se fotografía vacío) |
