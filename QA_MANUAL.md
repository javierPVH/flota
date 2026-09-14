# QA manual — flota

> Guion de prueba humana tras la auditoría v2 (A1–A12). Cubre lo que ninguna
> suite automática ve: aspecto, idioma, flujos completos con el ratón y la PWA
> en condiciones reales. Tiempo estimado: **60–90 min**.
>
> Marca cada casilla; apunta cualquier rareza en la tabla del final aunque
> parezca menor (un texto sin traducir, un salto de layout, un foco perdido).

## 0. Preparación (5 min)

```bash
# Back con datos frescos de prueba (⚠️ FLEET_SEED_DATA borra y resiembra — SOLO dev)
cd back && FLEET_SEED_DATA=1 .venv/bin/python manage.py runserver  # :8000

# En otras dos terminales:
npm run dev --workspace front-gestion       # :5173
npm run dev --workspace front-conductores   # :5175
```

- ⚠️ El puerto **5174 es de Mercurio (docker), no tocarlo**.
- Usuarios (contraseña `flota-dev-2026`):

| Usuario | Rol | Para qué sirve en este QA |
|---------|-----|---------------------------|
| `admin` | Administración (superusuario) | Todo gestión + purga en erratas |
| `sara`  | Supervisora | Probar el 403 de gestión (AdminGate) y la vista de supervisión en campo |
| `carlos`, `lucia` | Conductores con coche | Flujos normales de la PWA |
| `david` | Conductor **sin coche** | Portón "sin vehículo" de la PWA |
| `nuevo` | Usuario recién dado de alta | Primer acceso |

El seed además deja preparado (no requiere montarlo a mano): **12 alertas de
seguro** en los tres niveles, lecturas de km **estimadas** (1 de cada 5
vehículos de volumen), el **espacio de erratas poblado** (incidencia, lectura,
marca "Saab", firma "Firma antigua (2024)" y el usuario inactivo `expedro` —
que NO sale en el selector de login, a propósito), y **4 envíos de correo** de
traza (2 enviados, 1 fallido, 1 omitido) + 1 suscripción push de `carlos`.

---

## 1. Gestión en castellano (`http://localhost:5173`, entrar como `admin`)

### Login y shell
- [ ] El fondo del login (wallpaper) se ve nítido y carga al instante — **A1: ahora es WebP de 204 kB; si se ve pixelado o tarda, apúntalo**.
- [ ] Entrar con `admin`. Al navegar por primera vez a cualquier página se ve "Cargando…" (no un flash en inglés ni pantalla en blanco).
- [ ] Footer: marca y contacto correctos (**A10: ahora salen del diccionario**).
- [ ] Atajos: `/` enfoca la búsqueda, `n` va a nuevo vehículo, `?` abre la ayuda de atajos.
- [ ] Campana de notificaciones: abre el panel de alertas y "Ver todas" navega.

### Panel (dashboard)
- [ ] Tarjetas con cifras coherentes con el seed (vehículos, alertas…).
- [ ] **Altas rápidas en la cabecera**: a la derecha del título hay **«Añadir vehículo»** y **«Añadir conductor»**. Pulsar cualquiera **no crea nada aquí**: sale un aviso —«Vas a salir de la vista general»— que dice a qué pantalla lleva y qué formulario abrirá. **Cancelar** deja el panel como estaba; **«Ir y crear»** navega a Vehículos o a Conductores **con el modal de alta ya abierto**. Cerrar ese modal deja la pantalla de destino normal (no devuelve al panel), y recargar ahí no vuelve a abrirlo: la intención viaja en el estado de la navegación, no en la URL.
- [ ] **Tiras de atención** (bajo los KPIs): **«Alertas que requieren atención»** con chips por tipo — **ITV programada** (la ÚNICA «ITV» de los paneles), Seguro, Kilómetros, **Mantenimiento programado** y Sin conductor — y cada chip abre el modal filtrado a ese tipo. **«Incidencias abiertas»** con el catálogo de peticiones — **Averías · Averías de neumáticos · Mantenimiento puntual · Accidentes · Peticiones generales** — **sin chip de ITV**: las peticiones internas «En ITV» no cuentan ni salen en esta tira (siguen en la bandeja de Incidencias —su filtro de tipo sí ofrece «ITV», pero el alta manual no— y en la tarjeta de la ficha del coche). Los dos modales, **«Gestión de alertas» y «Gestión de incidencias», salen con el MISMO ancho (xl)**.
- [ ] **Desgloses «ITV próximas y vencidas», «Seguros» y «Mantenimiento anual»**: el modal sale **más ancho (xl)** y la tabla se ve entera, con columna **Acciones** al final. Por fila: en ITV → **«Registrar ITV»** (el mismo modal que Alertas, con el vehículo preseleccionado; al guardar, la lista se recarga y el vencimiento desaparece); en Seguros → **«Enviar correo»** (abre el correo del vehículo ya en «Aviso de seguro», con la renting premarcada); en Mantenimiento → **«Registrar servicio»** (fecha/km/coste/nota; reancla el plan y cierra sus alertas; las filas «sin plan» no tienen botón — hay que crear el plan en la ficha).
- [ ] **Línea temporal de cambios** (A10): pasar el ratón por una muesca → tooltip con "Click para ver el detalle"; click → modal "Cambios del AAAA-MM-DD" con badges "Evento"/"Auditoría".

### Vehículos (la tabla grande, TableWithPanel)
- [ ] Ordenar por columna (asc/desc/quitar), buscar, filtrar por fechas, "Últimos 30 días".
- [ ] Paginación: cambiar tamaño de página, primera/última.
- [ ] Panel de opciones: mostrar/ocultar columnas, reordenar (subir/bajar), redimensionar arrastrando el borde de una cabecera.
- [ ] Fila expandible: desplegar, ver el contenido, plegar (no pierde el estado).
- [ ] Exportar a Excel y abrir el fichero.
- [ ] **Tarjeta «Conductor y reparto» → «Gestión»**: modal con dos pestañas, **Conductores** y **Supervisores**. Arriba dice quién lo lleva **hoy** y desde cuándo; debajo, una fila por periodo con **inicio y fin editables** (el botón «Guardar» solo aparece en la fila tocada) y una papelera que lo retira (N7: **no borra el histórico**, el registro pasa a erratas y se puede restaurar — la tabla lo advierte). El alta va aparte: botón **«Añadir conductor por periodo»** / **«Añadir supervisor por periodo»** abajo a la izquierda, que abre su propio modal con persona, inicio y fin opcional. La regla: **un coche, un conductor y un supervisor a la vez** — al elegir unas fechas ocupadas sale en rojo **«Esas fechas ya las cubre Fulano (del … al …)»** y el botón se apaga; un tramo que **termina justo cuando empieza** el siguiente es un relevo válido y sí deja. Las **propuestas** de asignación no salen aquí (no son periodos). Comprobar que cerrar hoy el periodo del supervisor deja el coche **sin supervisor** en la cabecera, y que abrir uno que cubre hoy lo pone: el vigente y el histórico van juntos.
- [ ] **«Cambiar conductor» es el mismo modal en todas partes**: desde la ficha → tarjeta **«Conductor y reparto»** sale el mismo que desde el ⋮ del inventario y del panel — **«Conductor y supervisor · matrícula»**, con **«Nuevo conductor»** en «— Sin cambios —», **fecha de inicio** (apagada hasta que se elige a alguien), **Supervisor** y la **papelera** para dejar el puesto vacío. Guardar recarga la tarjeta (conductor actual e histórico) sin recargar la página, y si la ficha cambió por otro lado avisa del conflicto en vez de pisarlo.
- [ ] **Tarjeta «Accidentes»** (ficha, justo debajo de «Alertas e incidencias»): misma forma que ella, con **solo los accidentes** del coche —abiertos y cerrados, con su «Resolver»— y **«Comunicar accidente»** en la cabecera, que abre el parte guiado. Ese botón **ya no está** en la tarjeta de alertas (allí queda «Nueva incidencia»). Un accidente sale en las dos listas: en la general como una incidencia más y aquí a solas. Arriba **no hay pestañas «Incidencias / Alertas»** (aquí solo hay una lista) y **«Abiertas» lleva el número** de accidentes abiertos; en la tarjeta de alertas, en cambio, esas pestañas siguen y el contador sigue en ellas.
- [ ] **La tabla del panel: cómo va el coche y quién lo cubre**. En la vista general, la tabla de flota trae dos columnas nuevas: **«Kilómetros»** (arriba el odómetro; debajo, en gris/ámbar/rojo, los días que lleva sin lectura — «Sin lecturas» si nunca se le hizo) y **«Combustible (mes)»** (litros y, si lo hay, el importe). Un coche **con coche de sustitución vigente** muestra una **flecha a la izquierda de la matrícula**: al pulsarla se despliega debajo una fila **morada** con el sustituto (matrícula que enlaza a su ficha, modelo, estado, conductor, km, combustible, ITV, seguro y «Cubre desde …»). Los coches sin sustituto **no tienen flecha**. La de **Combustible (mes)** también lleva dos líneas: los litros del mes y, debajo, el tipo de combustible. Ordenar por «Kilómetros» ordena por el odómetro, y por «Combustible» por los litros. Hay además columna de **Supervisor**. El combustible son **solo litros**: ni aquí, ni en el inventario, ni en el parte de repostaje de la PWA (que ya no pide el importe) aparece el gasto.
- [ ] **Buscar y exportar (panel)**: **«Exportar CSV» se ve sin desplegar** la barra y exporta la pestaña que se esté mirando. Al abrirla hay dos selectores nuevos, **Conductor** y **Supervisor** (con «Sin conductor» / «Sin supervisor»), y un desplegable **«Cortes»** con cinco casillas combinables —ITV próximas, Seguros próximos, Mantenimientos próximos, Km sobrepasados y Mostrar bajas— cuyo resumen dice cuántas hay puestas. «Km sobrepasados» deja los coches con alerta de exceso abierta; «Mantenimientos próximos», los que vencen en 30 días o ya vencieron. «Limpiar filtros» los quita todos.
- [ ] **El inventario se lee como el panel**: en Vehículos, la barra de filtros está **siempre a la vista** con registros, columnas, búsqueda, estado, supervisor, **conductor** y fecha de alta, y abajo, en su fila con filete, las **casillas** de ITV próximas, Seguros próximos, Mantenimientos próximos, Km sobrepasados y Mostrar bajas, más **«Limpiar filtros»** a la derecha cuando haya algo puesto. **«Exportar CSV»** está en la cabecera de la página y abre el modal de exportación de siempre. Al **volver de una ficha** con filtros puestos, la barra los conserva. La tabla trae **Kilómetros** y **Combustible (mes)** en dos líneas y **Próx. mantenimiento**; el coche de sustitución **ya no sale en la celda de Estado**: cuelga de la fila, con su flecha. Lo exportado respeta los filtros del modal, incluidos los cortes nuevos.
- [ ] **Las dos tiras del panel abren la lista de siempre**: en la vista general, «Alertas que requieren atención» y «Incidencias abiertas» (y cualquiera de sus chips) abren **«Alertas e incidencias de la flota»**, que es la MISMA lista de la ficha —pestañas «Incidencias / Alertas», «Abiertas / Cerradas», filtros de tipo, prioridad y orden, ✓ «Resolver» y sobre— pero de toda la flota, cada fila con su **matrícula**. Entra por la pestaña de la tira pulsada y, si se pulsó un chip, con ese **tipo ya filtrado** (el de «Kilómetros» abre sin filtro: agrupa dos tipos). Comprobar: el ✓ abre el modal del tipo (ITV → «Registrar ITV») y al cerrar la fila desaparece; el sobre abre el correo **del coche de esa fila**; «Cerradas» enseña lo último cerrado con su aviso de que el histórico completo está en la bandeja; una incidencia **«En ITV» no sale** (la única ITV del panel es su alerta); y abajo siguen «Filtrar en la tabla» (solo en alertas) y «Ver todas…», que **no se pierden de vista**: el modal tiene alto fijo y lo único que hace scroll es la lista de filas (con 80 alertas, las pestañas y los filtros de arriba también se quedan quietos).
- [ ] **Los indicadores de la ficha llevan a donde se opera**: **«Próxima ITV»** abre **«Programar ITV y mantenimiento · matrícula»** en la pestaña **ITV** (y «Próximo mantenimiento», en la suya); **«Kilometraje»** abre **«Kilómetros y combustible · matrícula»** en la pestaña **Kilómetros** (y «Combustible (mes)», en la suya). Coste, fin de contrato y seguro siguen abriendo su detalle con el histórico.
- [ ] **El detalle del seguro pide la renovación**: «Vencimiento del seguro» → en el modal, bajo las cifras, **«Mandar correo a la renting»**. Al pulsarlo se cierra el detalle y se abre **«Enviar correo · matrícula»** ya en el aviso de **vencimiento de seguro**, con la renting marcada como destinataria. El botón de la barra de acciones sigue abriendo ese mismo modal **sin plantilla fijada**.
- [ ] **Contrato pasado de fecha** (un coche cuyo fin previsto ya pasó y sigue de alta): el indicador **«Fin de contrato» sale en rojo**, al abrirlo el modal encabeza con **«El contrato terminó el … »** y la fecha va en rojo, y la ficha aparece **enmarcada** con el rótulo **«Contrato finalizado»** sobre el borde, igual que un coche de sustitución. Si además es sustituto, el borde es el morado de sustitución (manda la identidad) pero **salen los dos rótulos**. En un coche **devuelto (baja)** no se marca nada.
- [ ] **Caja «Tipo de vehículo» (editando)**: junto al título, la **chapa con el estado actual** del coche, con su color; al lado del tipo, **solo «Cambiar estado» y «Devolver»**. Cambiar el estado desde ahí **actualiza la chapa** sin cerrar la edición. «Dar de baja» ya no está en esa barra: se hace desde el ⋮ de la fila (inventario y panel).
- [ ] **«Cambiar estado» con sustituto (ficha)**: al elegir un estado **no activo** sale la casilla **«Sale con coche de sustitución»**; al marcarla, el bloque del sustituto **se despliega con animación** (vehículo, motivo —ya precargado según el estado: Mantenimiento → Mantenimiento, Averiado → Avería, ITV → ITV, Accidentado → Accidente— y fecha de inicio), con su botón de crear uno. **Guardar hace las dos cosas**: el coche queda en el estado nuevo **y** con el vínculo montado (se ve en la cabecera de la ficha y en la tarjeta de sustitución). Marcar la casilla y **no** elegir vehículo **no guarda nada** y lo dice. Con «Activo» la casilla no aparece. Y el desplegable de estado **ya no ofrece «-- Ignorar --»**.
- [ ] **Crear el coche de sustitución desde donde se elige**: en «Nuevo estado» → **Disponibilidad** → «se le asigna un coche de sustitución», y en el modal **«Sustitución»** de la ficha, **«Crear coche de sustitución»** está en el **pie**, a la izquierda de «Cancelar» y «Vincular» (en el modal de la ficha, donde además **Motivo e Inicio van en la misma línea**). Abre el **alta completa** del vehículo con el tipo ya en **«🔁 Sustitución»** (y ese interruptor no se cambia después: es el de siempre). Al guardarlo, el modal se cierra, el coche nuevo **aparece en el desplegable y queda elegido**, y lo que hubiera escrito en el formulario de detrás **sigue ahí**. Cancelar no deja rastro.
- [ ] **Un coche de sustitución no tiene «Uso y asignación»**: al marcar el tipo **«🔁 Sustitución»** esa pestaña desaparece (y si se estaba en ella, el formulario vuelve a «Identificación»); «Siguiente» pasa de «Características técnicas» directo a «Propiedad y contrato». Con «Flota» vuelve a estar.
- [ ] **El pie no flota**: en una pestaña corta (p. ej. «Identificación» recién abierta) los botones siguen **abajo del todo del modal**, no pegados al último campo.
- [ ] **El alta de vehículo se recorre**: el pie queda **pegado abajo** (no se va con el scroll, y deja aire bajo los botones) con **«Cancelar» a la izquierda del todo** y, al borde derecho, **«Atrás» · «Siguiente»**, que pasan de pestaña en pestaña («Atrás» apagado en la primera). En la última («Propiedad y contrato») **«Siguiente» se apaga** y **aparece «Crear vehículo» a la izquierda de «Atrás»**, con la animación de entrada — el botón bajo el cursor no cambia de función. Dar a **Intro** en un campo antes de la última pestaña **avanza**, no crea. **Editando** es distinto: no hay «Siguiente» y «Guardar cambios» está siempre.
- [ ] **Barra de acciones de la ficha**, en este orden: **Enviar correo · Cambiar conductor / supervisor · Gestionar facturas · Editar · Cambiar estado · Devolver** (con el coche de baja quedan solo los cuatro primeros). Los tres primeros abren **los mismos modales** que el ⋮ del inventario. Comprobar que lo que se ha ido de la barra sigue estando: los **km**, en el indicador «Kilometraje» —que ahora es el que se apaga, con su porqué en el tooltip, cuando el coche está cubierto por un sustituto—, y **Sustitución**, **Dar de baja** y **Convertir en flota** (solo sustitutos) dentro de **«Editar»**, en la caja «Tipo de vehículo».
- [ ] **Tarjeta «Conductor y reparto» → «Reparto de uso»**: arriba, la **barra** de cómo queda el reparto (un trozo por persona, con su color; **a rayas** lo que falta por repartir) y debajo una fila por persona con el mismo punto de color. Comprobar: sale con el **conductor de hoy al 100%** (o con el reparto vigente); «Añadir persona» entra con **lo que quede** por repartir; una persona ya elegida **no se ofrece** en las demás filas; «Repartir a partes iguales» deja la suma en 100 (el pico, a las primeras); la pastilla del pie dice **«Falta repartir N%»** / **«Te pasas N%»** / **«✓ El reparto cuadra (100%)»**; y **«Guardar reparto»** solo se enciende con 100 exacto y **ninguna fila sin persona** (si falta, lo dice). La papelera de cada fila la quita, y con una sola fila está apagada.
- [ ] **La tarjeta ya no tiene «Retirar»**: para dejar el coche sin conductor se usa la **papelera** de «Cambiar conductor» (el modal compartido), que es el único sitio donde se hace.
- [ ] **Los estados del coche dicen por qué está parado**: el filtro **«Filtrar por estado»** (panel e inventario) ofrece los **seis** — **Activo · No activo - Mantenimiento · No activo - ITV · No activo - Averiado · No activo - Accidentado · No activo** —, siempre los mismos y en ese orden, estén o no en la página que se está viendo; la baja va aparte, con el interruptor **«Mostrar bajas»**, y donde aparece se llama **«Devuelto (baja)»** (badges, tablas, exportaciones y la auditoría de la ficha). En «Nuevo estado», al decir en **Disponibilidad** que el coche **no sigue activo**, el estado en que queda lo decide la **incidencia elegida**: mantenimiento puntual y **cambio de neumáticos → «No activo - Mantenimiento»**, avería → «No activo - Averiado», y **petición general → «No activo»** a secas (no tiene estado propio). Comprobarlo en el **resumen** y en la ficha. Ojo con los neumáticos: el estado es mantenimiento, pero si sale con coche de sustitución el **motivo del vínculo sigue siendo «Neumáticos»**.
- [ ] **Pestaña «Nuevo estado»** (dentro de «Alertas e incidencias»; ya no es una acción propia del menú): el formulario de estado, sustitución y comunicado. La vieja pestaña **«Estados abiertos» sigue oculta** (interruptor `SHOW_OPEN_TAB`) y no se pide al servidor. Va **por pasos**, en sub-pestañas numeradas con el color de cada sección: **1 Estado del vehículo · Disponibilidad · (Datos del cambio de neumáticos) · Gestión · Archivos · Comunicado** — el **coche de sustitución ya no es un paso**: vive dentro de Disponibilidad. Caben todos en la barra **sin scroll** (el modal es más ancho) y, si la ventana no da, bajan de línea. Solo el primero está disponible al abrir; **los demás se encienden con lo elegido** (la gestión solo si la petición va a un taller, archivos y comunicado con cualquier incidencia). Los pasos **no se pulsan**: son un indicador de por dónde vas (el activo, en verde; los que no aplican, atenuados), y se recorren **solo** con los botones del pie. Lo escrito en un paso **no se pierde** al ir a otro, y si un obligatorio vacío bloquea el envío desde otro paso, **el formulario salta a él** y enseña el aviso en el campo. Abre en **«— Sin cambios —»** con todo desactivado (no existe la fila «-- Ignorar --»). El selector es el **catálogo de incidencias que se abren a mano**, y solo eso, **agrupado**: Mantenimiento (**Mantenimiento puntual** / Cambio de neumáticos), Avería (**Vehículo averiado**) y Otras (**Petición general**) — los nombres son los mismos que en el catálogo de Incidencias. **No están** (cada una porque se opera en otro sitio): la **disponibilidad** —su paso, y el estado suelto en la ficha—, el **mantenimiento programado** —va sobre su plan: ⋮ → «Programar ITV y mantenimiento», y se cierra con «Ya se pasó la revisión»—, el **accidente** —⋮ → «Accidente», con su parte— y la **ITV**, que es una alerta. Cualquier incidencia enciende descripción, disponibilidad, gestión, sustitución, archivos y comunicado (la **petición general** no pide taller: puede no tener ni que ver con el coche). Los pasos que no aplican se ven **desactivados** (con su porqué en el `title`) y volver a «— Sin cambios —» devuelve al primero.
- [ ] **«Enviar correo» va por pasos, igual que «Nuevo estado»** (mismo asistente): **1 Tipo de correo** (tipo, el dato del que avisa y la incidencia sin cerrar) · **2 Contenido** (plantilla, idioma y mensaje adicional) · **3 Destinatarios** (administrador, conductor, supervisor, renting y correo suelto) · **4 Vista previa**. La **incidencia sin cerrar** solo se ofrece en el **comunicado de estado** —los demás correos avisan de su vencimiento, no de lo que el coche tenga abierto—, y al cambiar de tipo se retira con su texto. En el selector, además de cada una, cabe **«Todas · N sin cerrar»** (si hay más de una): mete las descripciones de todas en el mensaje, una por línea, y se pueden editar. Se recorre con el pie —**Cancelar** a la izquierda; **Anterior** y **Siguiente** a la derecha— y **«Enviar correo» aparece** (animado, a la izquierda de «Anterior») solo en el último paso, donde «Siguiente» queda apagado. Sin plantilla y sin texto, el paso 2 no deja pasar; sin ningún destinatario, tampoco el 3.
- [ ] **Pie fijo con «Cancelar» · «Guardar» · «Anterior» · «Siguiente»**: los botones viven abajo del todo y **no se van con el scroll**; Cancelar a la izquierda y la navegación a la derecha. **«Anterior»** está apagado en el primer paso. **«Siguiente»** pasa al paso habilitado que viene y, en el **último**, se queda **apagado**: no se transforma. Lo que ocurre ahí es que **aparece «Guardar»** —con una pequeña animación de entrada, a la **izquierda de «Anterior»**—, apagado si no hay nada que guardar. Con «— Sin cambios —» y el coche activo solo hay un paso, así que «Guardar» se ve desde el principio.
- [ ] **Cada paso pide lo suyo antes de dejarte salir**: «Siguiente» comprueba los obligatorios de ESE paso —los del navegador (`required`, el patrón de 5 dígitos del código postal) y los propios de la disponibilidad— y, si falta algo, **se queda ahí** y lo señala (el aviso del navegador en el campo, o el mensaje en rojo del formulario). Los obligatorios se **ven**: llevan el distintivo **«Obligatorio»** junto a la etiqueta —kilometraje y datos del parte de neumáticos, coche de sustitución y motivo de la sustitución—. **No** lo son (y se pasa de largo sin rellenarlos) el **código postal de la ubicación** ni el **motivo de salir sin sustituto**: si se escriben, cuentan; si no, la petición se abre igual. Un paso **sin obligatorios** —Archivos, Comunicado— deja pasar sin escribir nada.
- [ ] **El paso «Disponibilidad» es el ÚNICO sitio donde se decide si el coche está en la calle**, y las opciones dependen de dónde esté. Con el **coche en servicio** (y una incidencia elegida): **«No activo · se le asigna un coche de sustitución»**, **«No activo · sale sin coche de sustitución»** (con el **motivo**) y **«Activo · el coche sigue en servicio»**, **marcada por defecto** — con ella el guardado **solo registra la incidencia**: el estado no se toca y no hay sustitución que asignar. Decir que lleva sustituto y no elegirlo sí bloquea (Guardar y «Siguiente» avisan y **saltan al paso** que falta); el motivo de salir sin él es **opcional** y, si se escribe, se guarda en la **nota del cambio de estado** (histórico), no en la descripción de la petición. Las tres van como **tarjetas** (título + para qué sirve), no como casillas sueltas, y el **borde izquierdo** de la caja es **verde** mientras el coche quede en servicio y **rojo** en cuanto quede fuera. **Solo** con «se le asigna un coche de sustitución» aparece **debajo, en el mismo paso**, el bloque del **coche de sustitución** (vehículo del catálogo de sustitutos, inicio y fin, y el motivo del vínculo deducido del estado o preguntado). El vínculo **vigente** se ve siempre ahí, con su botón de cerrarlo. A un coche que **ya es sustituto** no se le ofrece esa opción.
- [ ] **Volver a Activo no es un decreto** (mismo paso, con el **coche parado**, y disponible **aunque no se elija ninguna incidencia** — es lo único que hace falta para reactivarlo): **«No activo · sigue fuera de servicio»** (por defecto) y **«Activo · vuelve al servicio»**. Con una petición sin resolver reteniéndolo (avería, mantenimiento, ITV o accidente), la segunda está **deshabilitada** y el paso lo dice, mandando a la pestaña **Incidencias** — es al **resolverla** donde se decide si vuelve (casilla «Devolver el vehículo a Activo»). Si no se marcó allí, o si el coche se paró a mano desde su ficha sin abrir ninguna petición, la opción **sí está viva** con su aviso, y Guardar se enciende solo al marcarla.
- [ ] **Al guardar, un resumen — y se acabó**: el formulario se sustituye por el **resumen de lo hecho** (petición abierta y su tipo, prioridad, fecha, descripción, ubicación para el taller, disponibilidad resultante, estado del vehículo, coche de sustitución, archivos y comunicado). La petición **ya aparece** en la pestaña **«Incidencias»** del mismo modal, con su contador al día. **No se vuelve al formulario** cambiando de pestaña y volviendo a «Nuevo estado»: el resumen sigue ahí. El pie del resumen es el mismo que el del formulario —los botones **miden y caen igual** que «Anterior» y «Siguiente»— y tiene dos: **«Nuevo estado»**, que retira el resumen y devuelve el formulario **en blanco** por el primer paso (para abrir otra petición a conciencia), y **«Cerrar»**. Al reabrir, el formulario ve el vehículo **recién recargado**: su estado de ahora, no el de cuando se abrió el modal.
- [ ] **Sección «Gestión · taller y cita»**: se enciende con las peticiones que van a un taller (neumáticos, mantenimiento puntual, avería, accidente); la **petición general** no. El **taller sale del catálogo** (Ajustes → Catálogos → Talleres e ITV); con «En ITV» solo ofrece **estaciones de ITV** (y «Taller + ITV»), con el resto solo talleres. Al guardar con taller/cita/coste, la petición queda **En curso**.
- [ ] **El parte de neumáticos no puede ir hacia atrás**: el campo **Kilometraje actual** tiene por mínimo la **última lectura registrada** del coche, y lo dice debajo («La última lectura registrada es N km…»). Por debajo de eso, «Siguiente» no pasa.
- [ ] **«Motivo de la sustitución» viene precargado** con lo elegido en el primer paso (Avería → Avería, Mantenimiento puntual → Mantenimiento, Cambio de neumáticos → Neumáticos) y se puede cambiar: es el mismo dato, así que no se pregunta dos veces.
- [ ] **«Mantenimiento puntual»** abre su petición, que se resuelve desde la tarjeta de la ficha; si además se marca «No activo», el coche pasa a «En mantenimiento». El **programado ya no se opera desde este modal**: vive en su **plan** (⋮ → «Programar ITV y mantenimiento») y se cierra con **«Ya se pasó la revisión»**, que reancla el ciclo y devuelve el coche a Activo.
- [ ] **«— Otro taller (escribir) —»** (en la sección Gestión): abre el campo **Nombre del taller** y el check **«Añadir este taller al catálogo»**. Al guardar, la gestión guarda el nombre escrito y, con el check, el taller **entra en el catálogo** (tipo «Taller»; «Estación ITV» si venía de una ITV) y aparece ya en los selectores. Si el alta falla (p. ej. ya existe), la gestión **no se pierde** y se avisa.
- [ ] **«Cambiar estado» empieza recomendando la incidencia**: el modal abre con un aviso —cambiarlo a mano no abre ninguna petición— y un botón **«Abrir una incidencia»** que **cierra el modal de estado y abre el asistente** de «Nueva incidencia» del coche (el mismo de la tarjeta de alertas e incidencias, no una copia). Lo de siempre —estado, motivo y salir con sustituto— sigue debajo, para los cambios que no tienen parte detrás.
- [ ] **Cambiar a un estado con parte** (p. ej. «Averiado») **abre además su petición** (incidencia del tipo equivalente) y la pantalla de éxito lo dice («Petición abierta: …»). La petición aparece en la tarjeta de la ficha (Incidencias · Abiertas) y en la bandeja de Incidencias.
- [ ] **Menú ⋮ → «Alertas e incidencias»** (una sola acción: **se fusionó con «Estado, sustitución y comunicado»**, que ya no está en el menú): modal «Alertas e incidencias · matrícula» con **tres pestañas** — **Nuevo estado** (la de salida; el formulario por pasos del punto de arriba), **Alertas** e **Incidencias**, estas dos con el número de abiertas en su píldora y dentro sus **Abiertas / Cerradas**, sus filas con el ✓ **Resolver** y el **sobre**, y sus filtros. El modal tiene **tamaño fijo**: cambiar de pestaña no lo hace crecer ni encoger. Ya **no hay resumen** («N alertas · M incidencias»): los números están en las píldoras de las pestañas. «Nueva incidencia» y «Parte de accidente» tampoco salen aquí (nueva incidencia es la primera pestaña, y el parte tiene su propia acción en el ⋮). Resolver, avisar o guardar un estado **recarga el listado** de la pantalla. Está en el menú del **inventario** y del **panel**, y cada apertura trae los datos frescos.
- [ ] **Filtrar y ordenar la lista** (en el modal y en la tarjeta de la ficha, y en las cuatro pestañas): **Tipo** —solo ofrece los tipos que hay de verdad en esa lista—, **Prioridad** —solo en Alertas, con los niveles presentes— y **Ordenar**: en alertas **Prioridad** (el de salida), **Fecha más próxima**, **Fecha más lejana** y **Tipo**; en incidencias, **Fecha más próxima** (el de salida), **Fecha más lejana** y **Tipo**. «Próxima» es la **cercanía a hoy** —vale igual para un vencimiento por llegar que para un parte del mes pasado— y las filas **sin fecha van al final** en cualquier orden. Un filtro que no deja nada lo dice («Nada con este filtro»), y **cambiar de pestaña vacía los filtros** (los tipos de una lista no son los de la otra); el orden elegido, en cambio, se recuerda por pestaña.
- [ ] **«Estados abiertos» ya no está**: en el modal de estado no hay ni pestaña ni contador, y lo que quedó abierto se ve en ese modal del menú ⋮ o en la **ficha del vehículo** → tarjeta «Alertas e incidencias», donde el ✓ **Resolver** abre el **modal específico del tipo** (km, coste, observaciones, justificante y casilla «Devolver el vehículo a Activo» cuando el coche está en el estado ligado). **Ningún modal de resolver pregunta ya el taller**: era la dinámica antigua — el taller se decide en la **gestión**, con el CP de la ubicación preferente (comprobar también en Registrar ITV, que ya no pide «Estación ITV»). El ciclo **Modificar / Gestión** de una petición vivía solo en esa pestaña y **queda fuera de la interfaz** mientras esté oculta (código y tests siguen: `OpenIncidentsPanel`).
- [ ] **«Cambio de neumáticos»** en el mismo selector: **habilita todo** — su parte guiado como el de la PWA (kilometraje, CP del taller, fecha y hora de preferencia, motivo desgaste/pinchazo con sus ruedas y medidas), la descripción (hace de comentario del parte), gestión, archivos (tipo sugerido «Fotos de daños») y comunicado; la sustitución solo si el coche NO está activo ahora (el back rechaza sustituto de un coche activo). Al guardar se crea una **incidencia de neumáticos** (el estado del coche no cambia) y se ve en Incidencias y en la tarjeta de la ficha.
- [ ] **Menú ⋮ → «Cambiar conductor / supervisor»**: el select de conductor solo **pone** a alguien (el vigente sale marcado como «(actual)»); **quitarlo ya no es una opción del select** — para eso está la papelera de la barra. El de supervisor sigue ofreciendo **«— Sin supervisor —»**, que además es su valor cuando el coche no tiene ninguno.
- [ ] **Papelera de la barra (conductor y supervisor)**: a la derecha de «Conductor actual · Supervisor» hay un botón de **papelera** que abre un **aviso** («El vehículo se queda sin esa persona…»). Ahí se elige **a quién** se quita —Conductor · nombre / Supervisor · nombre, solo los que existan; viene propuesto el conductor si lo hay— y **«Quitar»** lo hace en una sola llamada (la misma atómica que el cambio: cierra la asignación vigente y deja su evento en el histórico). No borra a nadie del sistema. Con el coche **sin conductor y sin supervisor**, la papelera está **apagada**.
- [ ] **Menú ⋮ → «Kilómetros y combustible»**: modal con dos pestañas. **Kilómetros**: enseña la última lectura (con «(estimada)» si lo es), y debajo **lectura de km y fecha en la misma línea** (fecha tope hoy; la del mes cierra su aviso de lectura pendiente) más un **histórico con las 5 últimas lecturas** (fecha · km, con su «(estimada)»). **Combustible** (GAP-2): en la misma línea **primero los litros y después la fecha**, que se elige **con día** (sin campo de importe: eso va por la ficha), y el histórico con los **10 últimos** meses. Ojo: la fila de consumo sigue siendo **mensual** —el back normaliza la fecha al día 1—, así que guardar dos veces dentro del mismo mes **actualiza** esa fila (solo litros: el importe guardado no se pisa) en vez de duplicarla.
- [ ] **Editar un vehículo** (⋮ → «Editar», y el mismo botón de la ficha): arriba, **«Tipo de vehículo»** en una sola caja — a la izquierda flota o sustitución (no se cambia); a la derecha las **acciones**: «Cambiar estado», «Sustitución» (solo desde la ficha), «Devolver» y «Dar de baja», que **no salen al dar de alta**; y debajo **matrícula, bastidor y fecha de matriculación**, siempre a la vista pero **bloqueados**, con un **candado cerrado**. Pulsarlo saca un aviso; al **aceptarlo** los tres se pueden editar y el candado queda abierto («Editable»), y al pulsarlo de nuevo vuelven a bloquearse sin preguntar. Y debajo, **cuatro pestañas**: Identificación (marca, modelo, versión, año) · Características técnicas · Uso y asignación · Propiedad y contrato. Lo escrito **no se pierde** al cambiar de pestaña y, si falta un obligatorio de otra (p. ej. la marca estando en «Propiedad»), al guardar **salta a su pestaña** y enseña el aviso en el campo. El pie sigue siendo uno: «Cancelar» y «Revisar cambios…».
- [ ] **Menú ⋮ → «Accidente»** (en Vehículos y en el Panel): modal de **tamaño fijo** con **dos pestañas**.
  - **«Comunicar accidente»**: el parte guiado de la PWA, ahora **por pasos** como «Nuevo estado» — **1 Dónde y cuándo** (calle/número/CP/localidad/provincia, fecha y hora no futura, teléfono; los obligatorios llevan su «Obligatorio»), **2 Daños** (la **descripción es obligatoria** y lo dice con su marca, aunque sea un textarea y no un campo del DS; CP del taller y prioridad), **3 Implicados** (dos **sub-pestañas** con su contador —**Terceros implicados** y **Lesionados**—; se puede dejar vacío, pero cada ficha que se añada tiene sus obligatorios: del **tercero**, nombre y matrícula; del **lesionado**, nombre. Cada ficha es un **acordeón**: al añadir una se abre ella y **se encoge la que estuviera abierta**, y plegada enseña el nombre; «Siguiente» no deja salir del paso con una ficha incompleta —**abre la que falla**, en su sub-pestaña, y lo dice en rojo—) y **4 Atestado y archivo** (referencia, archivo del parte y la casilla **«Marcar el vehículo como “Accidentado”»**, marcada de salida y ausente si ya lo está). Los pasos **no se pulsan**: se recorren con **«Anterior» / «Siguiente»** del pie, «Siguiente» no deja salir de un paso con obligatorios vacíos y **«Enviar reporte» solo aparece en el último**. Al enviar: se abre la **petición de accidente** (visible en la tarjeta de la ficha y en Incidencias), el estado cambia si la casilla sigue marcada, y en el **admin → Partes de accidente** están las tablas con terceros y lesionados materializados. Del acuse ya no se vuelve al formulario.
  - **«Gestionar accidentes»**: la **misma** lista que «Alertas e incidencias» pero solo con accidentes — **Abiertas / Cerradas**, orden, el **✓ «Resolver»** (que abre el mismo modal que el Panel) y el **sobre «Avisar por correo»**. No hay filtro por tipo (solo hay uno) ni pestaña de alertas, y lo que se acaba de comunicar **ya sale aquí** al cambiar de pestaña.
- [ ] **Menú ⋮ → «Programar ITV y mantenimiento»**: dos **pestañas con la MISMA forma** — arriba lo citado (etiqueta, fecha en grande, plazo en su píldora y sus datos) con **«Modificar»** y **el botón de resolver**, en medio el formulario (abierto de salida si no hay nada citado) y **abajo del todo el histórico de las 5 últimas realizadas**, que sale de los eventos del vehículo.
  - **ITV**: un coche **sin cita** (p. ej. uno de volumen cuya última ITV volvió «no favorable») sale con el formulario abierto (fecha + **CP preferente**); con cita (el sustituto `4567JKL`, a ~45 días con CP 28100) la **enseña** (fecha, plazo, CP y origen) y solo ofrece **«Modificar la cita»** — no hay forma de crear una segunda. El botón **«Registrar ITV»** abre el mismo formulario que resuelve su alerta; al volver, la cita se relee.
  - **Mantenimiento**: el ciclo NO se teclea aquí, sale del **catálogo común de programas** (`1234KLM` y `7890NPQ` van con «Revisión general», el resto de la flota con «Revisión anual»). El select los lista con su ciclo y, **si solo hay uno, va elegido**. **«+ Nuevo programa»** abre su propio modal, que avisa de que el programa vale para toda la flota, de que se puede ciclar por km, por meses o por los dos y de que **los km mandan** (si llega al límite de km antes que al de meses, toca igual); sin ningún ciclo no deja guardar. El ancla se cuenta **desde hoy** por defecto —la fecha de creación del registro— y el **próximo mantenimiento se ve antes de guardar** (y el objetivo por km, si lo hay). Solo puede haber **uno programado a la vez**: un segundo lo rechaza el back (`vehicle`). **«Ya se pasó la revisión»** reancla el ciclo desde aquí mismo.
- [ ] La cita puesta a mano **aguanta el paso de los jobs**: `python manage.py refresh_next_itv` no la borra (antes la fecha solo salía del histórico de ITV y el job la dejaba a nulo). Registrar luego una **ITV real** de ese coche vuelve a poner la fecha del informe y el bloque pasa a decir «Sale de la última inspección registrada».
- [ ] **Menú ⋮ → «Editar»**: abre el **formulario del vehículo en un modal** (el mismo de la ficha y del alta), sin salir del listado; al guardar, el modal se cierra y la fila se refresca con el cambio. Antes navegaba a otra pantalla y se perdían el filtro y la posición.

### Adjuntar archivos (en todas las pantallas)
- [ ] **Ningún formulario enseña ya el «Seleccionar archivo · Ningún archivo seleccionado» del navegador.** En gestión, todos los adjuntos usan el mismo campo del DS: botón **«Elegir archivo…»** con su clip, al lado el **nombre** de lo elegido (o «Sin archivo elegido» en gris) y una **✕** para quitarlo; con varios archivos dice «N archivos elegidos». Comprobarlo en: justificante de los modales de resolver, póliza de «Renovar seguro», archivo del parte en «Accidente» → «Comunicar accidente», «Archivos del estado» del modal de estado (permite varios), Documentos del vehículo, informe de Documentos e importación de catálogos.
- [ ] En la **PWA** todos los adjuntos son la **caja grande de siempre** (borde punteado, icono y el nombre del archivo al elegirlo, que se pone en color de marca): subir documento (vista y modal), parte de accidente y fotos del alta de incidencia. Sigue abriendo cámara o galería en el móvil.

### Detalle de vehículo
- [ ] La primera tarjeta es **«Alertas e incidencias»**, desplegada y en **dos niveles de pestañas**: arriba **Incidencias** y **Alertas** (cada una con el número de abiertas en su píldora) y dentro **Abiertas** / **Cerradas**, estas dos **en la misma línea que los filtros**. Abre en Incidencias · Abiertas. Las alertas abiertas salen graves primero y con su plazo; las incidencias sin cerrar, las más próximas a hoy primero y con Abierta/En curso. Bajo las pestañas, **una sola línea**: en **dos grupos** dentro de una misma caja — a la izquierda las pastillas **Abiertas / Cerradas** y, separado por un filete y pegado a la derecha, **Tipo / Prioridad / Ordenar** (ver el punto de filtros en Vehículos). En pantalla estrecha los filtros bajan solos a la línea siguiente. Cada fila abierta lleva el ✓ **Resolver**, que abre el **mismo modal por tipo** que en Alertas/Panel. En la cabecera, los botones **Nueva incidencia** (el modal de estado del inventario) y **Parte de accidente**; el resumen «N alertas · M incidencias» **ya no está** (los números viven en las píldoras de las pestañas). Cada pestaña vacía lo dice («Sin incidencias abiertas», «Todavía no hay alertas resueltas»…).
- [ ] **Orden de lectura de cada fila**: primero la **fecha**, después el **título** (tipo de incidencia o de alerta) y al final la **descripción**; las píldoras (plazo, estado) cierran la fila por la derecha.
- [ ] **Sobre a la derecha de cada fila abierta** (solo ahí: lo cerrado no se avisa): abre el mismo **Enviar correo** que Vehículos/Alertas, ya en el aviso que toca —la alerta de ITV en «Aviso de ITV», la de lectura en «Reclamar lectura de km», lo demás en «Comunicado de estado»— con el **responsable premarcado** (el conductor vigente y, si el coche no tiene, su supervisor). Desde una **incidencia**, además viene elegida en «Incidencia sin cerrar» y su descripción ya en el mensaje. La lógica de envío es la de siempre (plantilla 10b, vista previa, `EmailLog`).
- [ ] **«Cerradas»** es el histórico y **se pide solo al abrirla** (antes la tarjeta solo traía lo abierto): las incidencias cerradas salen con la **fecha de la solución** y las alertas resueltas con la fecha y **quién las resolvió**, ya sin ✓ (no hay nada que cerrar). Al resolver algo, la fila desaparece de «Abiertas» y aparece en «Cerradas».
- [ ] En un coche **Averiado** con avería abierta: Resolver → coste, km, factura y casilla Activo marcada (sin taller) → al cerrar, el coche pasa a **Activo**, la factura aparece en Documentos ligada a la incidencia y la tarjeta se vacía.
- [ ] Un **accidente** con «Siniestro total» marcado: el botón pasa a «**Resolver y dar de baja**»; tras cerrar la incidencia se abre el modal de **baja** (fecha + motivo) y el coche queda en Baja sin 409.
- [ ] Un coche en **Baja** se sigue pudiendo abrir por URL (no «No Vehicle matches»).
- [ ] Acordeones abren/cierran con animación; datos, contrato, asignaciones.
- [ ] Gráfica de km: tooltip, línea de "hoy", lecturas estimadas distinguibles.
- [ ] Buscar un vehículo con lectura **estimada** (1 de cada 5 de volumen; p. ej. `2002DXP`, `2007KRW`…): en el histórico de lecturas luce el badge "Estimada" y en la gráfica se distingue del dato real (N8b).
- [ ] Documentos: subir un PDF/foto local; descargarlo después (pasa por sesión).
- [ ] Editar el vehículo y guardar; el cambio aparece en la línea temporal del panel.

### Kilometraje (A9)
- [ ] La columna/aviso "pendiente este mes" es coherente: un vehículo con lectura de ESTE mes no aparece como pendiente. *(El bug corregido solo se manifestaba la madrugada del día 1; basta comprobar coherencia.)*
- [ ] Registrar una lectura manual y ver que la fila se actualiza.

### Alertas
- [ ] Hay alertas de ITV, **seguro (A6/N2)**, km y "sin conductor" sembradas.
- [ ] Las de seguro (~12) reparten urgencias: **vencidas**, a <15 días y a <30 — comprobar que el **plazo** bajo «Fecha límite» («Vencido hace N días» / «Vence en N días») acompaña al mensaje.
- [ ] **Una alerta NO lleva nivel**: no hay columna «Nivel» ni filtro de nivel, y las filas de la campana, del Panel, de la ficha y del modal de resolver **ya no pintan la chapa Crítica/Aviso/Informativa**. La urgencia la marca la FECHA LÍMITE (el motor la recalcula según se acerque o se aleje), y lo urgente sigue saliendo primero. La prioridad ELEGIDA es cosa de las incidencias.
- [ ] **«Fecha límite» lleva el semáforo de la vista general** (`dueClass`, el mismo de ITV, seguro y mantenimiento en las tablas): **rojo** si ya pasó, **ámbar** si quedan 30 días o menos, sin color más allá — para **todos** los tipos, no solo la ITV. El plazo en lenguaje natural de debajo («Vencido hace 6 días») acompaña al color en vez de quedarse gris. La fila entera sigue resaltándose solo con la **ITV vencida**.
- [ ] **Las dos bandejas se recorren seguidas**: la cabecera de **Alertas** lleva **«Ver incidencias»** y la de **Incidencias**, **«Ver alertas»** (con el icono de su menú). Ir y volver no arrastra filtros: cada bandeja tiene los suyos.
- [ ] **La tabla se lee como la de Incidencias**: **Vehículo** estrecho (una matrícula mide lo que mide) y **Mensaje** ancho, con el **texto a la vista** en una línea con puntos suspensivos —pulsarlo abre el mensaje completo—. En **Acciones**, tres **iconos** del mismo tamaño: **✓ Resolver** (solo en las abiertas; ya no es un botón con texto), **✉ Mandar correo** y **📄 Documentos**, que lleva a la ficha del coche (apagado si la alerta no tiene vehículo). En **Resueltas** no hay columna de acciones.
- [ ] Pestañas de estado: solo **Abiertas / Resueltas** — **«Todas» ya no está** (mezclarlas obligaba a mirar dos veces cada fila para saber cuál era cuál; una URL vieja con `?status=all` cae en Abiertas). No existe "Descartadas" ni botón de descartar: resolver es el único cierre.
- [ ] **La franja corta por plazo y por persona**: un select **«Plazo»** con un corte **por cada color del semáforo** —**Vencidas**, **Próximas (30 días o menos)**, **Lejanas (más de 30 días)**— más **«Sin fecha límite»** (las que no vencen, que no llevan color y si no serían inalcanzables); y dos selects, **Conductor** y **Supervisor**, con la gente que sale en lo cargado y su «Sin conductor» / «Sin supervisor». Lo que se filtra aquí es lo que se exporta.
- [ ] **La franja va en DOS filas**: arriba lo que recorta la lista (Registros · Buscar · Tipo · Plazo · Conductor · Supervisor) y abajo, tras el filete, cómo se lee la tabla y lo que se hace con ella (**Exportar CSV** y **Registrar ITV**, al otro extremo).
- [ ] **Orden y agrupado**, en esa segunda fila: el botón **«Antes la más próxima» / «Antes la más lejana»** invierte el orden (de salida, lo que antes vence: es lo que hay que atender), la casilla **«Agrupar por mes de vencimiento»** mete las filas en **acordeones de año y mes** dentro de la propia tabla y **«Agrupar por tipo»** las agrupa por el tipo de aviso, en un solo nivel y alfabético. **Se pueden marcar las dos**: entonces una queda **dentro** de la otra y fuera va **la que se marcó primero** (con el mes fuera: «agosto de 2026» y, dentro, sus tipos; al revés: cada tipo y, dentro, sus meses). Quitar la de fuera deja mandando a la que queda, así que volver a marcarla la mete dentro. En **Resueltas**, el histórico sigue agrupándose por el mes en que se cerró y con lo más reciente arriba; el botón de orden aparece allí solo si se marca la casilla (si no, no ordenaría nada).
- [ ] **«Acciones» es estrecha**: sus tres iconos y nada más.
- [ ] Columnas de **Conductor** y **Supervisor** (antes «Responsable») en todas las pestañas, con enlace a su ficha (o "—" si el coche no tiene a nadie).
- [ ] Acciones de la fila (solo en Abiertas y Todas): el botón de **correo** (sobre) abre el mismo modal que Vehículos, ya en el tipo de aviso de la alerta (ITV → aviso de ITV, lectura pendiente → reclamar lectura).
- [ ] Todas las fechas de la tabla con el mismo formato ("31 ago 2026"), incluida **Fecha límite** — nunca el ISO crudo.
- [ ] En **Resueltas**: el histórico va **agrupado DENTRO de la tabla en dos niveles plegables** — una fila para el **año** y, debajo, una por cada **mes**, ambas ocupando todas las columnas y con su chevron. Lo más reciente arriba. **No hay columna de Acciones**.
- [ ] Plegar un **mes** esconde solo sus filas; plegar un **año** esconde también sus meses. El recuento del año suma el de sus meses.
- [ ] **Conductor** y **Supervisor** se ven también en Resueltas (junto a las dos columnas del cierre).
- [ ] En **Resueltas**: columnas **Resuelta el** y **Resuelta por**. El seed deja una de cada caso:
  - en **verde** la que cerró el responsable del propio vehículo;
  - en **rojo con triángulo** la que cerró `admin`, ajeno al coche — al pasar el ratón (o tabular hasta el icono) sale el bocadillo diciendo quién sí era el conductor y el responsable. **Debe verse entero, sin recortarse por la celda ni salir a la vez que el tooltip del navegador**;
  - las cerradas por el sistema al registrar ITV/póliza/lectura salen como *Cierre automático* (gris), no en rojo.
- [ ] Resolver una alerta abierta: pasa a Resueltas con la fecha de hoy y tu nombre, en el grupo del mes en curso.
- [ ] **Resolver abre la actuación de cada tipo** (la fila ya no lleva botón propio de «Registrar ITV»). El mismo modal sale en el Panel y en la ficha:
  - **ITV** → directamente el modal de **Registrar ITV** con el vehículo del aviso ya elegido: resultado, próxima fecha, **estación ITV** (solo las del catálogo de tipo ITV), **km**, coste, **informe** adjunto y, si el coche está «En ITV» y la ITV es favorable, la casilla «Devolver el vehículo a Activo» **marcada**. Al registrarla favorable el aviso pasa a Resueltas **a tu nombre** (ya no *Cierre automático*), la incidencia «En ITV» se cierra y el coche vuelve a Activo.
  - **Lectura de km pendiente** → pide fecha y **lectura** («Registrar lectura y resolver»): crea la lectura y resuelve a tu nombre con la nota.
  - **Exceso de km proyectado** → enseña la **media mensual del coche** y un select de **candidatos** ordenados por su media (los «sin coche» primero); al elegir uno, «Cambiar conductor y resolver» hace el cambio atómico y, sin nota escrita, guarda «Cambio de conductor: X → Y».
  - **Sin conductor** → select «Asignar conductor» (o «Sin asignar ahora»): asigna y resuelve; sin nota, guarda «Conductor asignado: X».
  - **Mantenimiento** → «Registrar mantenimiento · matrícula»: el **plan de la alerta** preseleccionado + fecha del servicio, taller, km, coste, observaciones, factura y casilla Activo si el coche está «En mantenimiento» («Registrar mantenimiento y resolver»). Reancla el plan, deja **una incidencia de mantenimiento cerrada** como registro, cierra **solo las alertas de ese plan** (las de otro plan siguen abiertas) y emite el evento «Mantenimiento realizado» en la línea temporal. Sin planes, resuelve solo con la nota.
  - **Seguro** → «Renovar seguro · matrícula»: **nueva fecha de vencimiento** propuesta un año después (no puede adelantar la vigente), notas y **póliza** adjunta; botón «**Mandar correo a la renting**» que abre el modal de correo con la **empresa de renting premarcada**. Al renovar: la ficha muestra la fecha nueva, evento «Renovación de seguro» y el aviso pasa a Resueltas a tu nombre. Repetir con la misma fecha no duplica el evento.
- [ ] En **Resueltas** hay columna **Nota de cierre** con lo anotado al resolver.
- [ ] **Un coche por conductor a la vez**: asignar a alguien que ya lleva otro
      coche (cambiar conductor en la ficha, aceptar una propuesta o conceder una
      solicitud) devuelve 400 con «El conductor ya lleva el ‹matrícula›…» y no
      toca nada (atómico). La única convivencia permitida es su coche **más el
      de sustitución** mientras el suyo está parado (`lucia` viene así en el
      seed: `5678BCD` + Leaf `4567JKL`). En el modal de exceso de km, los
      candidatos «sin coche» entran directos; uno ocupado da ese mismo aviso.

### Incidencias, facturas, informes
- [ ] **La bandeja tiene DOS pestañas**: **«Abiertas»** —que agrupa *abierta* **y** *en curso*: lo que sigue pendiente— y **«Cerradas»**. No hay «Todas» ni «En curso» sueltas, y se entra por «Abiertas», que es la lista de trabajo. La columna **Estado** sigue distinguiendo las tres etiquetas dentro de la pestaña.
- [ ] **La tabla empieza por la FECHA** (Fecha · Vehículo · Tipo · Prioridad · Estado · Estado del vehículo · Coste · Descripción · Acciones, y el CSV igual). **Prioridad** y **Estado** van estrechas —son chapas cortas— y lo que sobra se lo queda **Descripción**, que ahora **se lee en la propia fila** (una línea con puntos suspensivos; pulsarla sigue abriendo el texto completo en su modal). En **Acciones**, **«Documentos» es un icono** más, como Resolver y Editar, y lleva a la ficha del coche.
- [ ] **Columna «Estado del vehículo»** (entre Estado y Coste): dice si esa incidencia deja el coche parado o no, con la misma chapa y las mismas etiquetas que el inventario («Activo», «No activo - Averiado»…). En una **cerrada** enseña cómo está el coche **hoy** (no se guarda una foto por incidencia). Sale también en el CSV exportado.
- [ ] **Toda incidencia lleva su «CP preferente»**: el formulario de «Nueva incidencia» lo pide (5 cifras; es la ubicación desde la que un tercero busca el taller más cercano) y al editar una existente aparece relleno. Comprobar que también está en los otros caminos de alta: sección «Gestión» del modal de estado, el parte de «Accidente» y, en la PWA, alta de incidencia, parte de accidente y modal del vehículo.
- [ ] Crear una incidencia y cambiarle el estado: el select de **Estado** ya **no ofrece «Cerrada»** (cerrar es Resolver); solo reabrir una cerrada.
- [ ] Cada fila **no cerrada** lleva el botón ✓ **Resolver**, que abre el modal de su tipo: avería/petición general (reparación), **neumáticos** (medida y posiciones prellenadas desde el parte, marca, cantidad; sin casilla Activo), **mantenimiento puntual** (sin plan de mantenimiento: no hay ciclo que reanclar — el plan solo se pide en la alerta «Mantenimiento programado» y en «Registrar servicio» del plan), **accidente** (nº de expediente, quién asume el coste — con importe si es franquicia —, siniestro total), **ITV** (Registrar ITV). Tras resolver, la fila pasa a Cerrada y en el informe de incidencias salen Taller, Fecha solución, Días parado, Resuelta el/por.
- [ ] El tipo **«Petición general»** (el que manda la PWA por defecto) existe en el filtro y en el alta.
- [ ] **La ITV no está en Incidencias**: el subtítulo no la menciona, el filtro **Tipo** ofrece solo **Avería · Avería de neumáticos · Mantenimiento puntual · Accidente · Petición general** (ni en el alta), y las peticiones internas «En ITV» que abre el cambio de estado **no se listan aquí** — se siguen en la tarjeta de la ficha del coche y su cita, en la alerta **«ITV programada»**.
- [ ] **Prioridad de la petición** (la elige quien la abre, de más a menos urgente: **Crítica · Moderada · Funcional · Informativa**):
  - columna **Prioridad** con su chapa de color en la tabla, y **filtro** propio en la franja (el seed reparte las cuatro);
  - **select en TODOS los modales que abren una incidencia**: alta de la bandeja, «Alertas e incidencias» → Nuevo estado (paso Gestión, junto al CP), el parte de «Accidente» del ⋮ y, en la PWA, avería/incidencia del tablero, alta unificada y parte de accidente;
  - por defecto **Moderada** (lo que se abre sin pensarlo no entra como crítico); reajustarla se hacía desde «Modificar» de «Estados abiertos», que está oculto — hoy se cambia editando la incidencia en su bandeja;
  - la chapa se ve también en el panel de incidencias del Panel.
- [ ] Facturas: abrir una y ver el reparto.
- [ ] Informes: generar/descargar uno.
- [ ] **Propuestas y solicitudes están ocultas**: no aparecen en el menú ni en la
      navegación, y los atajos `g p` / `g s` ya no llevan a ninguna parte. La PWA
      tampoco permite ya enviar propuestas de fechas, así que no se acumulan sin
      resolver.

### Catálogos y usuarios
- [ ] Crear una marca o sociedad; el validador de email/URL del formulario avisa con valores malos.
- [ ] Borrar la que acabas de crear → confirma → desaparece.
- [ ] **Talleres e ITV** (catálogo nuevo): el seed trae 3 de ejemplo («Taller Centro», «Neumáticos Sur», «Estación ITV Norte»). Crear uno con tipo **Estación ITV**, dirección, CP y teléfono; la columna Tipo enseña la etiqueta («Taller», «Estación ITV», «Taller + ITV»), y un nombre repetido con otras mayúsculas se rechaza (o, si lo ocupa uno desactivado, ofrece **restaurarlo**).
- [ ] Usuarios: abrir el detalle de `carlos`, ver sus asignaciones.
- [ ] `expedro` figura como inactivo (o no figura en el listado activo), pero SÍ en Erratas.

### Erratas (N7/A2 — el seed ya la deja poblada)
- [ ] La página muestra TODOS los grupos sembrados: incidencia ("Duplicada…"), lectura de km ("Error de tecleo…"), marca **Saab**, firma **"Firma antigua (2024)"**, usuario **expedro** y los vehículos en baja — cada uno con quién/cuándo/motivo.
- [ ] **Restaurar** la firma antigua → aparece de nuevo en Plantillas de correo (A2). Restaurar también la marca Saab → vuelve a Catálogos.
- [ ] **Purgar** (solo `admin`) la lectura de km desactivada: desaparece de verdad tras la doble confirmación.
- [ ] Extra: borrar tú una plantilla desde Plantillas de correo y verificar el ciclo completo borrar → erratas → restaurar.

### Plantillas de correo (N10)
- [ ] Editar una plantilla (asunto y cuerpo), previsualizar, guardar.
- [ ] **Las variables están a la vista y se pegan solas**: entre el asunto y el editor hay una tira con las seis de la allowlist (`mailer.ALLOWED_VARIABLES`) —**Matrícula, Conductor, Renting, Fecha de vencimiento, Km de exceso, Mensaje**—, cada una con su `{{nombre}}` debajo y, en el `title`, qué trae. Pulsar una la pega **donde estabas escribiendo**: con el cursor en el **asunto** cae ahí (y el cursor se queda detrás), y en el **cuerpo**, en el punto del texto. La chapa de la cabecera dice a cuál de los dos irá. El viejo desplegable «Insertar variable…» de la barra del editor ya no está (solo servía para el cuerpo).
- [ ] Asignar una firma y ver que la previsualización la incluye.
- [ ] **Un envío puede ir a VARIOS destinatarios**: el comunicado del vehículo deja **una fila por destinatario** (cada una con su estado: enviado / fallido / omitido), y los informes programados dejan **una fila con la lista** separada por comas (el seed siembra una: «Informe mensual de flota»). En esa fila, la columna **Destinatarios** tiene ancho fijo: enseña **uno** y, a su lado, un botón **«+N»** que abre el modal con **todos**.
- [ ] **La barra de «Últimos envíos»**: el buscador admite **varios términos separados por comas** y busca a la vez en **destinatarios, tipo, asunto y estado** (basta con que case uno: «marta, ITV» trae los de Marta y los de ITV). Buscando un destinatario concreto, en las filas con varios **sale el primero y en verde**, también dentro del modal. Al lado: el botón **«Antes lo más reciente» / «Antes lo más antiguo»** (orden por fecha de envío) y las casillas **«Agrupar por fecha de envío»** y **«Agrupar por estado»**, que se pueden marcar **las dos** —fuera queda la que se marcó primero—.
- [ ] **Últimos envíos** (traza EmailLog sembrada): se ven los 4 estados — 2 enviados, 1 **fallido con su error SMTP** legible y 1 omitido ("sin email de contacto"). Los enviados enlazan/citan su alerta.

---

## 2. Gestión en inglés (el idioma es lo MÁS nuevo — pasada completa)

- [ ] Cambiar a EN con el conmutador de la cabecera. **Recorre TODAS las páginas** del punto 1 en rápido y caza castellano suelto: títulos, botones, cabeceras de tabla, estados vacíos, confirmaciones, errores de formulario, tooltips.
- [ ] Puntos calientes recién traducidos (A10):
  - [ ] Fallback "Loading…" al navegar.
  - [ ] Línea temporal: tooltip, "… and N more", modal "Changes on …", badges "Event"/"Audit".
  - [ ] Footer "Fleet Management Console".
  - [ ] En la tabla: inspeccionar con el lector/inspector los `aria-label` ("Expand row", "Column tools", "Close", "Clear search").
- [ ] Recargar la página: el idioma **persiste**.
- [ ] Selector de hoja de Excel (al importar): título y botón de cierre en el idioma activo.

### AdminGate (A10 — requiere salir de admin)
- [ ] Cerrar sesión y entrar en gestión como **`sara`** → pantalla "Sin acceso" (ES) sobre el wallpaper, con el botón "Cerrar sesión" funcional (no un login en bucle).
- [ ] Repetir con el idioma en EN → "No access" / "Log out".

---

## 3. PWA de conductores (`http://localhost:5175`)

### Flujos base (como `carlos`)
- [ ] Login → resumen del vehículo: matrícula, km, próxima ITV, estado del seguro.
- [ ] Aviso "lectura de este mes pendiente" coherente (A9, mismo criterio que en gestión).
- [ ] Registrar una lectura de km (dentro de la ventana; fuera de ventana debe explicarse, no fallar en silencio).
- [ ] **Ventana de km (N8a, día 20 → fin de mes)**: fuera de plazo el formulario sale
      deshabilitado con el aviso; dentro, guarda. `FLEET_KM_WINDOW_START=0` en
      `back/.env` la desactiva si necesitas registrar a cualquier día.
- [ ] **Avisos del inicio**: aparecen SOLO cuando queda poco — km (≤5 días para que
      cierre la ventana, o ≤3 para que abra), ITV y seguro (≤30 días; rojo a ≤7 o ya
      vencido). Sin nada urgente, la tira no existe. Cada aviso enlaza a su destino.
- [ ] Crear una incidencia con foto.
- [ ] Subir un documento.
- [ ] **Resolver con modal personalizado por tipo (solo supervisor)**: el botón
      **Resolver** de una alerta ya no cierra a ciegas — abre un modal según el
      tipo. En **lectura de km pendiente** sale el **formulario de registrar
      km** (la vista de registro, en modal): guardar la lectura resuelve la
      alerta y deja la traza «Lectura registrada: N km» en la resuelta; además,
      para el supervisor **desaparece el botón suelto de «Registrar km»** de esa
      alerta (el conductor lo conserva, él no tiene Resolver). En el resto de
      tipos, el modal pide **observaciones opcionales** que quedan visibles en
      la bandeja de resueltas.
- [ ] **Clasificador global de la bandeja**: al inicio, sobre los acordeones, un
      **select** («Todas (N)» por defecto + una opción por tipo abierto con su
      recuento global) clasifica toda la bandeja. Elegir un tipo deja **solo las
      alertas de ese tipo**: los coches sin él desaparecen y los que quedan
      pierden su select interno y sus secciones (lista plana). Con un solo tipo
      abierto el select no se pinta; volver a «Todas» restaura la bandeja
      completa con sus clasificadores por coche.
- [ ] **Clasificador por tipo en cada acordeón**: desplegado un coche, arriba de
      sus alertas hay un **select** (mismo estilo que el de grupos de la flota)
      con **«Todas (N)» por defecto** y una opción por tipo presente con su
      recuento («Lectura de km pendiente (1)», «ITV próxima (1)»…). Elegir un
      tipo recorta la lista de ESE coche (la cabecera no cambia); con un solo
      tipo el select no se pinta. Cada acordeón recuerda su propia selección.
      **En «Todas»** las alertas del coche van **seccionadas por tipo**: una
      **línea horizontal** divide los grupos y cada uno lleva su **título
      plegable** («Lectura de km pendiente ×1» con chevrón) que abre/cierra solo
      su grupo. Los subgrupos nacen **encogidos**: al abrir el coche se ve el
      índice de tipos y se despliega el que interese; dentro de la sección, la
      tarjeta ya no repite el tipo.
- [ ] **Alertas agrupadas por coche**: la bandeja es un **acordeón por vehículo,
      plegado por defecto** (las de flota, sin coche, van juntas en el suyo). La
      cabecera resume: matrícula, chapa con el **total** («N alertas», con el color
      del peor nivel) y el **desglose por tipo** («Lectura de km pendiente ×2 ·
      ITV próxima ×1»). El orden es por urgencia (crítica primero). Desplegado,
      cada alerta lleva una **franja izquierda con el color de su nivel** (rojo
      crítica, ámbar aviso), el tipo como título con su chapa, y el pie con las
      fechas (el **vencimiento ya pasado sale en rojo**) y las acciones ligeras a
      la derecha (**Registrar km** en las de lectura; **Resolver** si eres
      supervisor). **«Ver ficha» sale UNA vez por coche**, al pie del acordeón —
      no repetido en cada alerta — y dentro no se repite la matrícula. Con «Ver
      cerradas», las cerradas siguen saliendo en lista plana.
- [ ] **Sin buscador**: como conductor, "Mis vehículos" NO tiene caja de búsqueda
      (aunque lleve varios coches).
- [ ] **Campos obligatorios marcados**: en TODOS los formularios de la app de
      campo (partes de avería/neumáticos/accidente, registrar km/ITV,
      mantenimiento realizado, solucionar incidencia, resolver por km, subir
      documento, reparto de uso), cada campo obligatorio lleva la pastilla
      ámbar **«Obligatorio»** junto a su etiqueta — la misma del DS
      (`requiredVisual`) también en los inputs artesanales (`.req-badge`). Los
      opcionales (observaciones, notas, adjuntos, caducidad) van sin marca; en
      **Registrar ITV**, la «Próxima ITV (opcional)» lo dice en la etiqueta
      (2026-08-31): se puede registrar la favorable sin fecha — el aviso se
      cierra igual, el coche queda sin cita y la próxima fecha la fija el
      siguiente registro que la traiga (el informe puede no estar a mano en
      campo). El login no se marca (sus dos campos son obligatorios por
      definición).
- [ ] **Ficha de campo (`/vehiculos/:id`) → «Alertas e incidencias»**: UNA sola
      tarjeta junta las alertas del coche y sus incidencias abiertas, y todo se
      puede resolver desde ahí. **Resolver va por TIPO**, igual que en la
      bandeja y que los botones del nav: la alerta de **ITV** abre el MISMO
      modal de «Registrar ITV», la de **lectura pendiente** el de «Registrar
      km» y la de **mantenimiento** el de «Actualizar mantenimiento» (el
      registro real es lo que cierra la alerta); solo las que no tienen
      registro propio (seguro…) van al modal genérico de observaciones. Las
      incidencias llevan **Solucionar** (solo supervisor): fecha de solución,
      tiempo parado calculado y observaciones; al cerrar, desaparece de la
      tarjeta. El conductor las ve sin botón. Vacía, la tarjeta dice «Sin
      alertas ni incidencias abiertas». Ya no existe la tarjeta aparte de
      «Incidencias abiertas».
- [ ] **Modo supervisor (`sara`)** — bajo el header hay un **switch** con dos vistas
      (se recuerda por dispositivo y girarlo te planta en su inicio):
  - [ ] **Mi vehículo**: la home es el **TABLERO de SU coche** (el que conduce
        — `sara` lleva el `7890NPQ`, que NO supervisa ella: los ámbitos por rol
        se suman y su coche entra igualmente), **sin título por encima**, sin
        lista del grupo, sin buscador y **sin ningún botón en la página**
        (cada acción vive en el nav). El tablero, en divs a **todo el ancho**:
        la **ficha** (matrícula grande, estado, marca/modelo/año y enlace
        «Ver ficha»), los **km** (el MISMO div que en la ficha de campo:
        «Km actual», última lectura, **«Mejor día para registrar los km: el
        N»** — el último de la ventana N8a; sin ventana configurada la línea
        no sale — y píldora de «lectura pendiente desde…» si falta la del
        mes) y las **Próximas citas** — el MISMO div que en la ficha: la
        **lectura de km** (solo si falta la del mes: «el día N · en X días»,
        con el fin de la ventana), la **próxima ITV** y el **próximo
        mantenimiento**, cada una en su línea con la fecha, el semáforo
        rojo/ámbar y **cuántos días faltan** («· en N días» / «· venció hace
        N días»). Son citas **próximas de verdad**: solo entran las que caen a
        **≤ 30 días** (el mismo umbral del semáforo y de los avisos del back);
        una recién realizada, con el ciclo reanclado a un año, **desaparece** de
        la tarjeta, y si no queda ninguna cita cerca la tarjeta entera no se
        pinta. Lo **vencido** no se esconde nunca. Más dos
        **acordeones plegados**: **Averías** (SOLO lo relacionado con averías:
        partes de avería, neumáticos y accidente **sin cerrar**, con recuento
        en la cabecera. Cada fila lleva su **observación**; las de
        **neumáticos** añaden encima el dato del parte —
        «Desgaste · Las 4 ruedas · 205/55 R16», «Pinchazo · Delantera
        izquierda · 205/55 R16» —, porque ahí el comentario es opcional y la
        fila se quedaba sin nada que decir. Igual en la sección Averías del
        modal de mantenimiento y en la tarjeta de la ficha. Las incidencias de
        mantenimiento/ITV no salen aquí —
        van por su vía — y las alertas viven en la bandeja del modo Flota) y
        **Documentos** (recuento, estado y enlace a Drive). El seed deja el
        `7890NPQ` como escaparate: **2 averías sin cerrar** (avería abierta y
        neumáticos en curso; la incidencia de mantenimiento sembrada NO debe
        aparecer en el acordeón), las filas de **ITV y mantenimiento en
        Próximas citas** con su semáforo (la de lectura de km NO sale: el
        Tesla va con km ilimitados y X2 no reclama lectura sin cupo que
        vigilar), **5 documentos** (póliza vigente + la anterior caducada,
        ficha técnica, permiso, acta de entrega y unas fotos **pendientes de
        archivar**) y **4 alertas abiertas**, de las que en la bandeja del modo
        Flota se ven **3** (ITV a 12 días, revisión anual a ~14 días y la
        revisión de frenos por km **vencida**, esta última crítica, en rojo) —
        la de **seguro a 15 días existe pero NO sale en campo**: X1 la reserva
        a administración (solo en gestión). Abrir **«Ver ficha»** tampoco repite las
        acciones: la ficha del **coche operativo** va **sin botones** (viven en
        el nav inferior); la del principal **bloqueado** de la pareja y las
        fichas en modo Flota conservan los suyos (ahí el nav no los lleva).
  - [ ] **Mi vehículo con sustitución**: el tablero que se ve es el del
        **sustituto**, con su ficha marcada (franja, chapa **🔁 Sustitución** y
        «Cubriendo a ‹matrícula› · motivo») y una **flecha a la izquierda de la
        matrícula** que desliza al **coche propio**, cuyo tablero sale
        **🔒 Bloqueado** (atenuado, borde discontinuo y el motivo); su flecha
        devuelve al sustituto. Debe quedar claro de un vistazo cuál está
        bloqueado y cuál es el de sustitución.
  - [ ] El nav inferior de Mi vehículo es: **Inicio · Km · Combustible · ITV ·
        Mantenimiento · Avería · Subir documento** (etiquetas cortas; los modales conservan sus
        títulos completos) — Inicio primero, y las pestañas se ven IGUAL que
        las del nav de Flota (mismo estilo, sin cromo de botón). En este modo TODO va **sobre su coche o el
        de su sustitución**: los modales abren con el coche operativo de la
        pareja preseleccionado; la bandeja de alertas se acota a ella (el grupo
        entero se ve en modo Flota). Si no condujera ninguno: aviso en la home
        con botón que gira el switch a Flota, y las seis acciones del nav
        aparecen **desactivadas** (apagadas, sin enlace, con "Sin vehículo
        asignado" al mantenerlas pulsadas); Inicio sigue activo.
  - [ ] **Combustible (nav)** — el modal «Gasto de combustible» funciona como el
        de km: arriba, en un panel, **lo que ya lleva el mes** («Este mes ya
        llevas 58,40 l · 79,90 €» en el `7890NPQ` sembrado; «Sin gasto
        registrado este mes.» si no hay), y debajo **Litros repostados**
        (obligatorio) e **Importe (€)** (opcional: hay tickets que no se
        guardan). Acepta coma o punto decimal (teclado del móvil). Al guardar,
        el repostaje **se SUMA al total del mes** —la serie de consumo es
        mensual, una fila por coche y mes— y el panel del modal, al reabrirlo,
        ya enseña el total nuevo. Sin red entra en la **cola offline** (el punto
        de la pestaña) y se envía al reconectar; un rechazo del servidor (litros
        negativos) se muestra sin cerrar el modal. La supervisora lo tiene
        además en la **ficha de campo** (misma barra de acciones que km/ITV).
  - [ ] **ITV (nav)** — el modal «Registrar ITV» abre con un **aviso azul** que
        dice de qué cita es el registro: «Próx. ITV ‹fecha› · en N días»
        (en rojo si ya venció, con «venció hace N días»), que **se puede
        registrar antes o después de esa fecha** y que al hacerlo los avisos de
        ITV del coche se cierran solos — al elegir **Desfavorable** esa última
        frase cambia: la cita sigue pendiente y no se cierra nada. La **«Próxima ITV (opcional)»** es
        opcional de verdad: registrando **favorable sin fecha**, el aviso se
        cierra Y el coche se queda **sin cita** (la ficha deja de pintar la
        fecha vieja en ámbar/rojo y no vuelve a saltar por ella); la nueva cita
        entra cuando se registre otra ITV con la fecha del informe. Sin cita
        previa, el aviso solo explica el cierre automático (no inventa fecha).
  - [ ] **Guardar desde el nav refresca la pantalla, sin recargar la app**: al
        registrar la ITV, la cita **desaparece de «Próximas citas»** de la home
        en el momento (ya se ha realizado); lo mismo al marcar el
        **mantenimiento realizado** (el ciclo se reancla a 12 meses y la cita
        sale del horizonte de 30 días); igual con los km (se actualiza el
        div de km y se apaga el punto de la pestaña), el mantenimiento, la
        avería (aparece en su acordeón) y el documento subido. Los modales del
        nav viven fuera de la página, así que esto es lo que antes obligaba a
        recargar a mano. La bandeja de alertas y la ficha de campo también se
        releen si es donde estabas.
  - [ ] **Mantenimiento (nav)** — el modal «Actualizar mantenimiento» enseña
        los planes del coche y, debajo, una sección **Averías** con las MISMAS
        del acordeón del tablero (partes de avería, neumáticos y accidente sin
        cerrar; mantenimiento/ITV no salen). El **supervisor** tiene botón
        **Solucionar** en cada una → submodal con la fecha de solución (hoy por
        defecto; ni anterior a la avería ni futura), el **tiempo parado
        calculado** y observaciones; «Cerrar incidencia» la quita de la lista
        (y del acordeón al recargar) y avisa. El conductor las **ve sin
        botón**: cerrar incidencias es de gestión (el back lo exige).
  - [ ] **Flota**: la home es la lista a cargo, **separada por grupos de estado que
        funcionan como pestañas** (Todos · Activo · En taller · …), cada una con su
        recuento; el buscador vive aquí y las pestañas se recalculan sobre lo buscado.
        El espacio de Flota enseña **solo los coches que se supervisan**, aunque se
        acumulen más roles (los ámbitos por rol se suman: sin el filtro, un
        supervisor+conductor vería además su coche y un supervisor+admin la flota
        entera): si el coche que conduce `sara` lo supervisa otra persona, NO sale en
        Flota (sí en «Mi vehículo»). Aplica igual a la proyección (`/grupo`) y a los
        selectores de coche de registrar km / incidencia / documento abiertos en modo
        Flota.
        Cada tarjeta añade los **datos de gestión**: conductor, **última lectura**
        (o "Sin lectura", en apagado) y **proyección** (chapa "NN% · nivel"; sin
        contrato no hay fila, con km ilimitados dice "∞"). Si el coche tiene un plan
        de mantenimiento anclado, sale **Próx. mantenimiento** con el mismo semáforo
        de cercanía que la ITV (también en la ficha hero y para el conductor), y al
        pie de cada tarjeta hay botones **Avería** / **Incidencia** que abren su
        **modal** con ese coche ya decidido (el principal bloqueado por sustitución
        no los ofrece: se registra sobre el sustituto).
  - [ ] **Incidencia (botón de cada tarjeta)**: modal con un **selector de tipo** —
        **Cambio de neumáticos · General · Mantenimiento** — y, elegido uno, su
        **div informativo**: neumáticos (desgaste o pinchazo; taller y cita se
        concretan en la gestión) — con el **«Kilometraje actual» ya puesto**: la
        última lectura conocida del coche, con la pista «Última lectura
        conocida: N km» debajo para poder corregirla si ha rodado más; sin
        lectura, el campo sale vacío —, **General** (solicitudes que quizá no tienen que
        ver con el vehículo: documentación, tarjetas, dudas…) y **Mantenimiento**
        (cosas rotas o cambios necesarios que **no impiden conducir**; sin
        urgencia). Debajo, fecha, descripción y la caja punteada de adjuntar
        documento o foto (opcional). Sin tipo o sin descripción no deja comunicar.
        La incidencia entra en el mismo ciclo (gestión → solución) y sube la marca
        🔧 de la tarjeta.
  - [ ] **Recordatorio (✉ en cada tarjeta, solo supervisor)**: abre un modal con el
        motivo (**Lectura de km sin registrar · ITV · Mantenimiento**, cada uno con
        su dato debajo) y dos canales — **enviar correo** al conductor y **crear
        alerta en la app** (con push). Repetir el mismo día no duplica la alerta
        ("la alerta de hoy ya estaba abierta"); sin conductor o sin email el modal
        lo avisa y el correo queda omitido con su motivo. La píldora ámbar de
        lectura pendiente es ahora compacta (tamaño `sm`).
  - [ ] **Actualizar datos (📋 en cada tarjeta, solo supervisor)**: modal con tres
        pestañas — **Km** (registrar la lectura de hoy), **Mantenimiento** (los
        planes del coche con su ciclo y último realizado; "Realizado hoy" reancla
        el ciclo y **resuelve las alertas de mantenimiento abiertas**) y
        **Averías / Incidencias** con el **ciclo en tres fases**. Sobre las
        tres pestañas hay un **aviso fijo**: la responsabilidad de estos registros
        es del conductor, no del responsable — esto se usa en su lugar y queda a
        nombre de quien lo hace. El aviso sale **solo en modo Flota** (en «Mi
        vehículo» el supervisor actúa sobre SU coche y no se pinta, en ningún
        modal). Tras guardar, la lista de la flota se refresca.
  - [ ] **Ciclo de toda incidencia (avería, mantenimiento, neumáticos…), en 3 fases**:
    - [ ] **Lanzar**: el botón **Avería** de la tarjeta (y de la ficha) abre un
          **modal en dos pasos**. Primero los datos: **coche fijado (selector
          deshabilitado)**, fecha, descripción y la caja punteada **"📷 Adjuntar
          foto (opcional)"** (al elegir foto se marca con el nombre). Aquí no se
          comunica nada: **Continuar** pasa **con una animación de deslizamiento**
          al paso de **Gestión**, con los **mismos campos que la gestión del
          ciclo**: el **taller de averías** del catálogo (las estaciones solo-ITV
          no salen; "Atrás" vuelve sin perder lo escrito) **o especificado a
          mano** ("Otro taller…" abre el campo de nombre), **día y hora**,
          **coste** y **adjuntar documento o foto** — y **todo es opcional**: la
          avería **se puede comunicar sin taller** (el desplegable abre en "— Sin
          taller —") y completarse después en el 📋. Lo rellenado queda ya en la
          gestión de la incidencia (taller y cita precargados, coste guardado).
          Al comunicarla, la tarjeta luce la **marca 🔧 N** de incidencias
          abiertas (tooltip con el recuento).
    - [ ] **Gestión** (pestaña Averías/Incidencias del 📋): elegida la incidencia
          se ve el **hilo de fases** (Lanzada ✓ · Gestión · Solución) con su fecha
          y descripción; el **taller se elige del catálogo o se especifica otro**
          (desplegable; para una incidencia de ITV salen las estaciones, para el
          resto los talleres; "Otro taller…" abre el campo de nombre y un taller ya
          guardado que no esté en el catálogo se conserva como opción) y
          se rellena **día y hora, coste** y se puede **adjuntar documento o
          foto**; "Guardar gestión" la deja **En curso**. Reabrir el modal precarga
          lo ya guardado.
    - [ ] **Solución**: **sobrecoste** (opcional), **observaciones** y **tiempo
          parado (días)**; "Cerrar incidencia" la cierra, desaparece de la lista
          de abiertas y la marca 🔧 de la tarjeta baja (o se va). No hay botón a `/grupo`:
        el acceso a la proyección es solo el del nav inferior, que queda en
        **Inicio · Alertas · Proyección km**. "Inicio" vuelve siempre a la home de
        la vista activa según el switch.
  - [ ] El conductor no tiene switch ni pestaña "Inicio": su nav sigue siendo
        Vehículos · Registrar km · Alertas, y conserva los accesos rápidos de la home.
- [ ] **Proyección de km (`sara`, `/grupo` desde el nav en modo Flota)**:
  - [ ] Cabecera con recuento (**Vehículos · A vigilar · En riesgo**) y, si hay más de
        un nivel, **pestañas de filtro** (Todos · Riesgo exceso · A vigilar · Dentro ·
        Sin proyección) con su recuento.
  - [ ] Tarjetas **ordenadas por urgencia** (exceso primero), con franja lateral del
        color del nivel y el **% consumido en grande** a la derecha.
  - [ ] La barra lleva una **marca vertical con el avance temporal del contrato**
        (tooltip al mantenerla pulsada); debajo, "X de Y contratados" y "Contrato al
        N%". Cifras en rejilla: media mensual (con el ritmo contratado), proyección a
        fin (con la fecha de fin) y km restantes. Si hay exceso, aviso rojo con los km
        y la penalización estimada. "Ver evolución" es un **botón de solo icono** junto
        al % (despliega la gráfica en la propia tarjeta); el **reparto de uso ya no
        está aquí** — se gestiona desde el front de gestión (panel de asignaciones).
- [ ] **Par de sustitución (N9), como `lucia`** — lleva el Leaf `4567JKL` que cubre a
      su `5678BCD`, en taller:
  - [ ] El sustituto se ve **marcado** (chapa "🔁 Sustitución", franja lateral y la
        nota "Cubriendo a 5678BCD · Mantenimiento") y **ocupa la fila entera**, también
        en tablet, donde el resto va a dos columnas.
  - [ ] El principal **no se ve en la lista**: solo hay una tarjeta para la pareja.
  - [ ] **A la izquierda de la matrícula** del sustituto, un botón (chevron): al pulsarlo
        la tarjeta **se desliza a la derecha, como un reel, y el original asoma desde la
        izquierda** — atenuado con candado 🔒 y el motivo ("sustituido por 4567JKL.
        Registra los km y documentos sobre el sustituto").
  - [ ] En el original hay el botón simétrico junto a su matrícula, que desliza de
        vuelta al sustituto. Con "reducir movimiento" activado en el sistema no hay
        animación (cambia en seco).
  - [ ] Tocar la tarjeta visible abre SU ficha; el coche oculto no captura toques ni
        tabulador.
  - [ ] Si el otro coche de la pareja no es de los tuyos, la marca sigue pero **no hay
        reel ni botón** (no hay carta que asomar).
  - [ ] Al **abrir la ficha del principal**, arriba de todo un panel de aviso
        "🔒 Bloqueado por sustitución" con enlace al sustituto; en la ficha del
        sustituto, el panel "🔁 Coche de sustitución" diciendo a quién cubre.
- [ ] **Ficha del vehículo, al día**:
  - [ ] La cabecera lleva las mismas chapas que las tarjetas: estado, "🔁 Sustitución"
        si toca y "🔒 Bloqueado" si está cubierto.
  - [ ] Tres tarjetas de datos: km, próxima ITV y **Próx. mantenimiento** (GAP-8,
        solo si hay plan anclado), las tres con su semáforo.
  - [ ] Como `sara` (supervisora): cuadro de **Proyección** compacto (chapa de nivel,
        % grande, barra y "X de Y contratados") y una segunda fila de acciones con
        **Actualizar datos** y **Enviar recordatorio** — los mismos modales de las
        tarjetas; al guardar desde "Actualizar datos" la ficha refresca sus cifras.
        Como conductor no aparecen ni el cuadro ni esas herramientas.
  - [ ] En el **principal bloqueado**: Registrar km, Subir documento y Avería van
        **apagados** (con "Bloqueado por sustitución…" al mantener pulsado);
        **Registrar ITV sigue activo** — la ITV es del coche físico.
  - [ ] **Registrar ITV abre aunque la tarjeta de Documentos esté plegada** (antes el
        modal vivía dentro de esa tarjeta y, plegada, el botón no hacía nada).
- [ ] **Ya no se proponen fechas**: en la ficha del vehículo no hay acción "Proponer
      fechas" ni tarjeta de propuestas propias. Se retiró junto con su bandeja de
      confirmación en gestión, para no dejar al conductor esperando una respuesta que
      nadie podía dar. (El seed sigue sembrando asignaciones `proposed`: es normal que
      existan en la BD sin pantalla donde verse.)
- [ ] Gráfica de km con overlay (A11: el shim re-exporta los tipos — si compila y pinta, OK).
- [ ] Conmutador de idioma ES/EN: pasada rápida por todas las pantallas en EN.

### Catálogos (Ajustes → Catálogos)
- [ ] **«Programas de mantenimiento»** es una pestaña más (la última): lista el catálogo común con **Nombre · Cada (km) · Cada (meses) · Notas**, y se crea, edita y da de baja como los demás (N7: la baja va a erratas). Los dos ciclos se teclean como números y **uno puede quedar vacío** —viaja como «no aplica»—, pero **no los dos**: el back lo rechaza («Indica al menos un ciclo»). Lo que se dé de alta aquí sale en el selector de «Programar ITV y mantenimiento», y al revés: lo creado desde ese modal aparece en esta pestaña.
- [ ] Crear una entrada en **cada** catálogo (país, unidad de negocio, proyecto, CECO,
      renting, marca, modelo, sociedad): las ocho altas deben funcionar.
- [ ] **Duplicado por mayúsculas**: con "Seat" creada, intentar "SEAT" o "seat" → lo
      rechaza indicando el campo. Antes convivían las tres.
- [ ] **Duplicado exacto** en país, unidad de negocio, proyecto, CECO o renting → lo
      rechaza. Antes esos cinco no tenían ninguna restricción.
- [ ] **Nombre ocupado por un registro desactivado**: desactivar la marca "Seat" (pasa a
      erratas y desaparece del listado) e intentar crearla otra vez → sale el aviso de
      que existe pero está desactivada y el botón **«Restaurar el existente»**; al
      pulsarlo, la marca vuelve al catálogo. Igual con sociedad (código) y modelo.
- [ ] Crear un CECO y, sin recargar la página, ir a Proyectos: el select de centro de
      coste ya lo ofrece.

### GAP-1…8: catálogos HSE, consumo, devolución y mantenimiento
- [ ] **Catálogos** tiene dos pestañas nuevas: **Combustibles** (con factor CO₂
      opcional) y **Sedes**. El seed trae ~14 combustibles y 3 oficinas; en
      Erratas hay un combustible («Queroseno de Aviación») y una sede
      («Oficina Valencia») desactivados y restaurables.
- [ ] En el alta/edición del vehículo, **Combustible** es un desplegable del
      catálogo; en una ficha legada sin catálogo se avisa del texto guardado.
      Hay casilla **Tarjeta de combustible** y desplegable **Sede**.
- [ ] Cambiar la **sede** de un vehículo deja un evento «Cambio de ubicación»
      en su histórico con la sede anterior y la nueva.
- [ ] La ficha técnica muestra **Tarjeta de combustible** (Sí/No) y **Sede**.
- [ ] **La ficha, de arriba abajo**: a la derecha de la matrícula, **Coste mensual** y **Fin de contrato**, los dos **en una fila y a la misma altura** (apilados solo en ventana estrecha). Justo **bajo el subtítulo** y pegadas a él, las marcas del coche: **estado**, sustitución y km ilimitados si aplican, **conductor** y **supervisor** —los dos salen siempre, con «Sin conductor» / «Sin supervisor» cuando no los tiene— y el **coche vinculado** («🔁 Sustituido por 1234ABC») cuando lo hay; a su derecha, tras un **filete vertical**, **«Desplegar todo»** y **«Plegar todo»**, que ya no están sueltos sobre las tarjetas. Al entrar, **solo «Alertas e incidencias» está desplegada**: características técnicas, contrato, facturas y el resto salen plegadas. Después, **los botones en su propia barra** (Registrar km · Editar · Cambiar estado · Sustitución · Devolver · Dar de baja) y, bajo ella, **una sola línea** de indicadores con un **filete vertical** en medio: **Vencimiento del seguro · Próxima ITV · Próximo mantenimiento │ Alertas e incidencias · Kilometraje · Combustible (mes)** — los seis **miden lo mismo**. El de **Alertas e incidencias** enseña solo los números («2 alertas · 1 incidencias», verde si están a cero) y el desglose por tipos en el **tooltip**; al pulsarlo **despliega y baja** a la tarjeta de lo pendiente, y sus números tienen que **cuadrar con las píldoras** de esa tarjeta. Debajo, las tarjetas en este orden: **Características técnicas · Contrato · Facturas**, y después alertas e incidencias, km contratados, conductor y reparto, documentos e histórico.
- [ ] **Consumo y mantenimiento ya no son tarjetas de la ficha**: no hay «Consumo de combustible» ni «Mantenimiento programado» entre sus bloques. El gasto del mes se lee en su indicador y **se registra pulsándolo** (abre «Kilómetros y combustible» por la pestaña **Combustible**); el mantenimiento se lee en el suyo y **se gestiona pulsándolo** (abre «Programar ITV y mantenimiento» por la pestaña **Mantenimiento**). La serie mensual completa de `1234KLM` (6 meses sembrados) sigue viéndose en ese modal.
- [ ] **Indicador «Combustible (mes)»** en la ficha: litros del mes en curso y, debajo, el importe (o «Sin gasto este mes» / «Sin importe registrado»). En `7890NPQ` marca **58,40 l · 79,90 €** (lo que el seed apunta como gasto de campo del mes).
- [ ] **Columna «Combustible (mes)»** en Vehículos (oculta por defecto, se
      activa en el gestor de columnas): «58,40 l · 79,90 €» alineado a la
      derecha, «—» sin gasto. **Ordena por importe** (y por litros cuando no
      hay importe) y entra en el CSV/Excel como el resto de columnas. El
      repostaje que apunta el conductor desde la PWA aparece aquí.
- [ ] Informes → Descargas permite elegir **Vehículos** o **Personas**. Vehículos
      genera un único Excel multihoja con ficha, contratos, asignaciones, reparto,
      sustituciones, km, consumo, eventos, incidencias, solicitudes, documentos,
      alertas, facturas, imputaciones, costes y mantenimiento. Comprobar los filtros
      de marca/modelo, activo/baja y flota/sustitución. Personas filtra por
      activo/desactivado y rol. Ajustes → Notificaciones mantiene los informes
      programables individuales, incluido consumo de combustible.
- [ ] Incidencias (gestión y app de conductores) ofrecen el tipo **Neumáticos**.
      Regla de dominio: los neumáticos SIEMPRE son una avería (incidencia),
      nunca un plan de mantenimiento.
- [ ] Ficha → tarjeta **Mantenimiento programado**: `1234KLM` trae SU único
      mantenimiento («Revisión general», del catálogo común), que avisa por las
      dos vías a la vez — VENCIDO por fecha (alerta crítica en la bandeja) y a
      ~500 km del objetivo (aviso). La tarjeta ya no da de alta nada por su
      cuenta: el botón abre «Programar ITV y mantenimiento» en su pestaña, y
      aquí solo queda **retirar** el plan (con motivo, N7).
- [ ] Ficha → botón **Devolver** (junto a «Dar de baja»): pide km, fecha y motivo,
      estima el exceso sobre lo contratado en vivo y, al confirmar, muestra el
      resumen (asignaciones finalizadas, contrato cerrado, penalización estimada).
      El vehículo queda de BAJA con su lectura final y su evento; unos km por
      debajo de la última lectura se rechazan sin dejar nada a medias.

### Ajustes → Notificaciones
- [ ] La pestaña **Notificaciones** aparece en Ajustes y lista los envíos sembrados
      (resumen diario de `admin`, informe semanal con Drive, y el mensual de `sara`
      en pausa — este último solo lo ve ella: cada usuario ve **solo los suyos**).
- [ ] El formulario sale en **cuatro bloques numerados** (qué se envía, cuándo, a quién
      y cómo se llama) y en el pie, junto a los botones, una línea de **resumen** que
      cambia al vuelo: «Flota (CSV) · cada lunes a las 07:30 · a 2 destinatarios».
- [ ] Crear un envío de cada frecuencia: diaria, semanal (pide día de la semana) y
      mensual (pide día del mes, 1–28). El formulario oculta lo que no aplica, y
      frecuencia + día + hora van en una fila.
- [ ] Elegir **Resumen de la flota**: desaparecen los filtros y la opción de Drive (no
      genera adjunto, y se explica por qué). Elegir un informe: reaparecen.
- [ ] El desplegable ofrece **los mismos 7 informes que Informes** (Flota, Kilometraje,
      Documentos, Alertas, Facturas, Costes, Conductores) y, al elegir uno, salen **sus
      filtros**: marca y estado en Flota, vehículo en Kilometraje, vehículo/tipo/estado
      en Documentos, estado y nivel en Alertas, rol en Conductores…
- [ ] Programar «Flota» filtrado por una marca y usar **Enviar ahora**: el fichero trae
      solo esa marca, igual que la descarga a mano desde Informes.
- [ ] Casillas **Añadir la fecha / Añadir la hora**: la línea de ejemplo bajo el nombre
      cambia al marcarlas, y el correo llega con ese asunto y ese nombre de fichero (la
      hora va con guion, no con dos puntos: es un nombre de fichero).
- [ ] El campo **Destinatarios** aparece con el correo del usuario ya puesto al crear un
      envío nuevo, y admite varias direcciones separadas por comas.
- [ ] **Cambiar el destinatario por otro** (quitando el propio) y usar «Enviar ahora»: el
      correo llega **solo** a esa dirección; al usuario que lo configuró no le llega nada.
      Dejar el campo vacío con «Enviar por correo» marcado → el formulario lo rechaza.
- [ ] No hay selector de formato: los informes se adjuntan **en CSV** y así se indica.
- [ ] **Enviar ahora** en uno con correo: llega el mensaje. Con un informe, llega con el
      adjunto en `.csv` (con el nombre del envío); con el resumen, los datos van en el
      cuerpo.
- [ ] **Pausar** un envío: la fila se atenúa, la columna «Próximo envío» pasa a «—» y
      deja de despacharse.
- [ ] Validaciones: semanal sin día, sin ningún destino, correo sin destinatarios, Drive
      sin carpeta, o un destinatario que no sea un correo → el formulario lo rechaza
      explicando qué falla (el mensaje sale en el pie, junto a los botones).
- [ ] Con `sara` (supervisora), un informe programado trae **solo sus vehículos**: el
      ámbito es el del dueño del envío, no el del job que lo manda.
- [ ] Eliminar un envío: se borra de verdad y **no** aparece en Borrado definitivo (es
      configuración personal, no un registro de negocio).

### Portones de acceso
- [ ] `david` (sin coche): pantalla clara de "sin vehículo asignado", sin errores.
- [ ] Usuario **sin rol** (`nuevo`): el portón ofrece un **enlace a Jira** para abrir
      la solicitud (se abre en pestaña nueva) y explica que la activación la hace la
      administración a mano. No hay formulario ni clave de ticket: Jira no se gestiona
      desde la aplicación. Sin `FLEET_JIRA_REQUEST_URL` configurada debe salir el aviso
      de "no configurada", nunca un enlace roto.
- [ ] `sara` (supervisora): ve su vista de supervisión, no la de conductor.
- [ ] `sara` **también** está sujeta a la ventana de km (es campo): fuera de plazo se
      le bloquea igual que a `carlos`. Solo el `admin` queda exento.

### Robustez PWA (BG5–BG7 — con DevTools)
- [ ] **Offline**: DevTools → Network → Offline. La app sigue mostrando el shell; registrar una lectura → queda **encolada** con aviso. Volver online → se envía sola y desaparece de la cola.
- [ ] **Actualización del SW**: con la app abierta, hacer un rebuild (`npm run build --workspace front-conductores` servido con `preview`) → aparece el aviso de nueva versión y al aceptarlo recarga con la nueva.
- [ ] Instalable: el navegador ofrece "Instalar app" (manifest OK).
- [ ] Push (N9): solo comprobable con claves VAPID configuradas; sin ellas la app **no debe** romperse ni pedir permiso a ciegas. (En `/admin` del back hay una suscripción sembrada de `carlos` con endpoint ficticio — es normal que no reciba nada.)

---

## 4. Checks técnicos post-auditoría (10 min, con Docker)

```bash
docker compose up -d --build
# A3: cabeceras en CADA ruta (repite con el puerto de gestión):
for p in / /index.html /sw.js /assets/ /healthz; do
  echo "== $p"; curl -sI "http://localhost:<puerto-conductores>$p" \
    | grep -iE "x-content-type|x-frame|referrer|content-security|cache-control"
done
```

- [ ] Conductores: TODAS las rutas devuelven `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy` y **CSP**; `/`, `index.html` y `sw.js` con `Cache-Control: no-cache`; `/assets/` con `immutable`.
- [ ] Gestión: mismas cabeceras **sin** CSP (a propósito, por Google Picker); `index.html` y `/` con `no-cache`.
- [ ] La app funciona ENTERA bajo la CSP de conductores: consola del navegador sin errores `Content-Security-Policy` (wallpaper, SW, manifest incluidos).
- [ ] `/media/...` sin sesión → redirige/401, nunca el fichero directo (SEC3).
- [ ] `docker compose exec back python manage.py check_insurance` → "N alertas nuevas", idempotente a la segunda.
- [ ] `reset_erratas` y `reset_comms` (con `FLEET_SEED_DATA=1`) re-ejecutan sin error dos veces seguidas.
- [ ] Peso: `ls -lh front/dist/**/*.css` (o el dist de cada app) — el CSS grande ronda **~400 kB**, no 4 MB (A1).

---

## 5. Registro de resultados

| # | Pantalla / paso | Qué pasó | Gravedad (🔴/🟠/🟡) |
|---|-----------------|----------|--------------------|
| 1 | | | |
| 2 | | | |

Al terminar: pásale la tabla a Claude ("resultados del QA: …") y se convierte en
la siguiente tanda de arreglos.
