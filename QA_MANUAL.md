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
- [ ] Resolver/reabrir una alerta.

### Incidencias, propuestas, solicitudes, facturas, informes
- [ ] Crear una incidencia y cambiarle el estado.
- [ ] Aprobar o rechazar una propuesta de km.
- [ ] Ver una solicitud y su estado; facturas: abrir una y ver el reparto.
- [ ] Informes: generar/descargar uno.

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
- [ ] Crear una incidencia con foto.
- [ ] Subir un documento.
- [ ] Gráfica de km con overlay (A11: el shim re-exporta los tipos — si compila y pinta, OK).
- [ ] Conmutador de idioma ES/EN: pasada rápida por todas las pantallas en EN.

### Portones de acceso
- [ ] `david` (sin coche): pantalla clara de "sin vehículo asignado", sin errores.
- [ ] `sara` (supervisora): ve su vista de supervisión, no la de conductor.

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
