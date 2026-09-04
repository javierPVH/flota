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
- [ ] **Desgloses «ITV próximas y vencidas», «Seguros» y «Mantenimiento anual»**: el modal sale **más ancho (xl)** y la tabla se ve entera, con columna **Acciones** al final. Por fila: en ITV → **«Registrar ITV»** (el mismo modal que Alertas, con el vehículo preseleccionado; al guardar, la lista se recarga y el vencimiento desaparece); en Seguros → **«Enviar correo»** (abre el correo del vehículo ya en «Aviso de seguro», con la renting premarcada); en Mantenimiento → **«Registrar servicio»** (fecha/km/coste/nota; reancla el plan y cierra sus alertas; las filas «sin plan» no tienen botón — hay que crear el plan en la ficha).
- [ ] **Línea temporal de cambios** (A10): pasar el ratón por una muesca → tooltip con "Click para ver el detalle"; click → modal "Cambios del AAAA-MM-DD" con badges "Evento"/"Auditoría".

### Vehículos (la tabla grande, TableWithPanel)
- [ ] Ordenar por columna (asc/desc/quitar), buscar, filtrar por fechas, "Últimos 30 días".
- [ ] Paginación: cambiar tamaño de página, primera/última.
- [ ] Panel de opciones: mostrar/ocultar columnas, reordenar (subir/bajar), redimensionar arrastrando el borde de una cabecera.
- [ ] Fila expandible: desplegar, ver el contenido, plegar (no pierde el estado).
- [ ] Exportar a Excel y abrir el fichero.
- [ ] **Modal «Estado · matrícula»**: dos pestañas — **«Nuevo estado»** y **«Estados abiertos»** (con contador). En «Nuevo estado», cada sección va en su **caja con borde de color** y funciona como **acordeón** (la cabecera pliega/despliega sin perder lo escrito). Abre en **«— Sin cambios —»** con todo desactivado y Guardar apagado (no existe la fila «-- Ignorar --»). El selector va **agrupado**: Disponibilidad (Activo / No activo), Mantenimiento (En mantenimiento / Cambio de neumáticos), Avería (Averiado) e ITV (En ITV) — **sin «Accidentado»** (el accidente se comunica con su parte, menú ⋮). Elegir **«Activo»** solo activa la descripción; un estado **no activo** enciende descripción, gestión, sustitución, archivos y comunicado. Las secciones que no aplican se ven **atenuadas**.
- [ ] **Sección «Gestión · taller y cita»**: se enciende cuando el guardado abre una petición (neumáticos o un estado con parte: mantenimiento, ITV, avería, accidente). El **taller sale del catálogo** (Ajustes → Catálogos → Talleres e ITV); con «En ITV» solo ofrece **estaciones de ITV** (y «Taller + ITV»), con el resto solo talleres. Al guardar con taller/cita/coste, la petición queda **En curso**.
- [ ] **«— Otro taller (escribir) —»** (en la sección Gestión y en el modal Gestión de «Estados abiertos»): abre el campo **Nombre del taller** y el check **«Añadir este taller al catálogo»**. Al guardar, la gestión guarda el nombre escrito y, con el check, el taller **entra en el catálogo** (tipo «Taller»; «Estación ITV» si venía de una ITV) y aparece ya en los selectores. Si el alta falla (p. ej. ya existe), la gestión **no se pierde** y se avisa.
- [ ] **Cambiar a un estado con parte** (p. ej. «Averiado») **abre además su petición** (incidencia del tipo equivalente) y la pantalla de éxito lo dice («Petición abierta: …»). El contador de «Estados abiertos» sube.
- [ ] **Pestaña «Estados abiertos»**: lista **solo las peticiones sin resolver** (abiertas/en curso) del vehículo, con fecha, estado y la gestión guardada (taller · cita). Cada línea tiene tres botones que abren su modal: **Modificar** (fecha, kilometraje, CP, descripción), **Gestión** (taller del catálogo + cita + coste → «En curso») y **Resolver** (sobrecoste, observaciones, días parado — todo opcional → **cierra** y desaparece de la lista).
- [ ] **«Cambio de neumáticos»** en el mismo selector: **habilita todo** — su parte guiado como el de la PWA (kilometraje, CP del taller, fecha y hora de preferencia, motivo desgaste/pinchazo con sus ruedas y medidas), la descripción (hace de comentario del parte), gestión, archivos (tipo sugerido «Fotos de daños») y comunicado; la sustitución solo si el coche NO está activo ahora (el back rechaza sustituto de un coche activo). Al guardar se crea una **incidencia de neumáticos** (el estado del coche no cambia) y se ve en Incidencias y en «Estados abiertos».
- [ ] **Menú ⋮ → «Comunicar accidente»** (junto a «Estado, sustitución y comunicado», en Vehículos y en el Panel): el parte guiado de la PWA — calle/número/CP/localidad/provincia, fecha y hora (no futura), teléfono, CP del taller, **descripción de los daños**, **terceros implicados** y **lesionados** con «+ Añadir»/quitar, referencia del atestado y archivo del parte (opcionales). La casilla **«Marcar el vehículo como “Accidentado”»** viene marcada (no aparece si ya lo está). Al enviar: se abre la **petición de accidente** (visible en «Estados abiertos» e Incidencias), el estado cambia si la casilla sigue marcada, y en el **admin → Partes de accidente** están las tablas con terceros y lesionados materializados.

### Detalle de vehículo
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
- [ ] Las de seguro (~12) mezclan los tres niveles: **vencidas (críticas)**, a <15 días y a <30 — comprobar que el nivel/color acompaña al mensaje.
- [ ] Pestañas de estado: solo **Abiertas / Resueltas / Todas**. No existe "Descartadas" ni botón de descartar: resolver es el único cierre.
- [ ] Columnas de **Conductor** y **Responsable** en todas las pestañas, con enlace a su ficha (o "—" si el coche no tiene a nadie).
- [ ] Acciones de la fila (solo en Abiertas y Todas): el botón de **correo** (sobre) abre el mismo modal que Vehículos, ya en el tipo de aviso de la alerta (ITV → aviso de ITV, lectura pendiente → reclamar lectura).
- [ ] Todas las fechas de la tabla con el mismo formato ("31 ago 2026"), incluida **Fecha límite** — nunca el ISO crudo.
- [ ] En **Resueltas**: el histórico va **agrupado DENTRO de la tabla en dos niveles plegables** — una fila para el **año** y, debajo, una por cada **mes**, ambas ocupando todas las columnas y con su chevron. Lo más reciente arriba. **No hay columna de Acciones**.
- [ ] Plegar un **mes** esconde solo sus filas; plegar un **año** esconde también sus meses. El recuento del año suma el de sus meses.
- [ ] **Conductor** y **Responsable** se ven también en Resueltas (junto a las dos columnas del cierre).
- [ ] En **Resueltas**: columnas **Resuelta el** y **Resuelta por**. El seed deja una de cada caso:
  - en **verde** la que cerró el responsable del propio vehículo;
  - en **rojo con triángulo** la que cerró `admin`, ajeno al coche — al pasar el ratón (o tabular hasta el icono) sale el bocadillo diciendo quién sí era el conductor y el responsable. **Debe verse entero, sin recortarse por la celda ni salir a la vez que el tooltip del navegador**;
  - las cerradas por el sistema al registrar ITV/póliza/lectura salen como *Cierre automático* (gris), no en rojo.
- [ ] Resolver una alerta abierta: pasa a Resueltas con la fecha de hoy y tu nombre, en el grupo del mes en curso.
- [ ] **Resolver abre la actuación de cada tipo** (la fila ya no lleva botón propio de «Registrar ITV»):
  - **ITV** → directamente el modal de **Registrar ITV** con el vehículo del aviso ya elegido y un campo de **coste** opcional; al registrarla favorable el aviso se cierra solo (*Cierre automático*).
  - **Lectura de km pendiente** → pide fecha y **lectura** («Registrar lectura y resolver»): crea la lectura y resuelve a tu nombre con la nota.
  - **Exceso de km proyectado** → enseña la **media mensual del coche** y un select de **candidatos** ordenados por su media (los «sin coche» primero); al elegir uno, «Cambiar conductor y resolver» hace el cambio atómico y, sin nota escrita, guarda «Cambio de conductor: X → Y».
  - **Mantenimiento** → el **plan** del vehículo preseleccionado + fecha, km y **coste** del servicio («Registrar mantenimiento y resolver»): reancla el plan, deja el coste como **incidencia de mantenimiento cerrada** y resuelve con la nota.
  - **Seguro** → botón «**Mandar correo a la renting**» que abre el modal de correo ya en el aviso de seguro con la **empresa de renting premarcada** como destinataria.
- [ ] En **Resueltas** hay columna **Nota de cierre** con lo anotado al resolver.
- [ ] **Un coche por conductor a la vez**: asignar a alguien que ya lleva otro
      coche (cambiar conductor en la ficha, aceptar una propuesta o conceder una
      solicitud) devuelve 400 con «El conductor ya lleva el ‹matrícula›…» y no
      toca nada (atómico). La única convivencia permitida es su coche **más el
      de sustitución** mientras el suyo está parado (`lucia` viene así en el
      seed: `5678BCD` + Leaf `4567JKL`). En el modal de exceso de km, los
      candidatos «sin coche» entran directos; uno ocupado da ese mismo aviso.

### Incidencias, facturas, informes
- [ ] Crear una incidencia y cambiarle el estado.
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
- [ ] Asignar una firma y ver que la previsualización la incluye.
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
- [ ] Ficha del vehículo → tarjeta **Consumo de combustible** (plegada): la serie
      mensual con litros, importe y origen. Añadir un mes ya existente → error de
      campo (no un 500); desactivar la cifra mala libera el mes. `1234KLM` trae
      6 meses sembrados.
- [ ] **KPI «Combustible (mes)»** en la ficha (div informativo, junto a coste y
      kilometraje): litros del mes en curso y, debajo, el importe (o «Sin gasto
      este mes» / «Sin importe registrado»). Es **clicable** como el de
      kilometraje: abre la tarjeta de la serie con el formulario de alta del
      mes ya desplegado. En `7890NPQ` marca **58,40 l · 79,90 €** (lo que el
      seed apunta como gasto de campo del mes).
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
- [ ] Ficha → tarjeta **Mantenimiento programado**: `1234KLM` trae una revisión
      anual VENCIDA (alerta crítica en la bandeja) y «Cambio de aceite y
      filtros» a ~500 km del objetivo (aviso). El plan exige al menos un ciclo
      y su ancla.
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
