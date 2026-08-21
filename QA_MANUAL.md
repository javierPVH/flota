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
- [ ] **Línea temporal de cambios** (A10): pasar el ratón por una muesca → tooltip con "Click para ver el detalle"; click → modal "Cambios del AAAA-MM-DD" con badges "Evento"/"Auditoría".

### Vehículos (la tabla grande, TableWithPanel)
- [ ] Ordenar por columna (asc/desc/quitar), buscar, filtrar por fechas, "Últimos 30 días".
- [ ] Paginación: cambiar tamaño de página, primera/última.
- [ ] Panel de opciones: mostrar/ocultar columnas, reordenar (subir/bajar), redimensionar arrastrando el borde de una cabecera.
- [ ] Fila expandible: desplegar, ver el contenido, plegar (no pierde el estado).
- [ ] Exportar a Excel y abrir el fichero.

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
