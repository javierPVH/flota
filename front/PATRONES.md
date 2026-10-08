# Patrones transversales de los fronts

Detalle de lo que resume [CLAUDE.md](../CLAUDE.md) para las dos apps y el DS: temas, sesión, i18n y textos que llegan del back.

- **DS por subpath** (`@flota/ui/ui`, `@flota/ui/http`, `@flota/ui/i18n`…):
  el barrel raíz mete la librería entera en el grafo eager.
- **Dos temas en runtime, y flota va por el corporativo.** `:root` =
  corporativo (teal) y es el **de salida**; `:root[data-brand="vam"]` = VAM
  (vino, slate, radios grandes), que solo se enciende si el `index.html` de la
  app pone `<html data-brand="vam">`. Los de **flota no lo ponen**, así que
  esta rama del DS se ve como siempre; el atributo lo usa el otro producto que
  consume esta librería. Tokens en `front/src/styles/tokens.css`; lo solo-VAM,
  en bloques `+vam` (`_theme/_brand.sass`) de los `.module.sass`. **Regla:**
  diff visual cero en el corporativo: no cambies un literal por un token
  «parecido», recolorea en VAM. Los alias `app.$*-app` son `var(--…)`: nada de
  `rgba()`/`darken()`, usa `app.mix-alpha` / `app.mix-with`. Mayúsculas solo
  por CSS (`--text-transform-*`), nunca en i18n.
- **`src/api.ts` por app** con `@flota/ui/http` (`getJson`, `postJson`,
  `postForm`, `ApiError`); las páginas no usan `fetch`.
- **Sesión.** `src/auth.ts` (`createAuth`) + `bootstrap()` (CSRF → `/me`); si
  el rol no toca (`isAllowed`), 403 con logout (`AdminGate`, `AccessGate`), no
  login en bucle. **2 h y UNA por persona**, entre por donde entre: el back
  corta a 2 h del login (`SESSION_ABSOLUTE_AGE`,
  `SessionAbsoluteAgeMiddleware`) y a 2 h sin actividad
  (`SESSION_COOKIE_AGE`); el DS, en cliente (`ABSOLUTE_MS` = 2 h, 30 min
  inactivo). Al entrar, `accounts/sessions.py` (`user_logged_in`, tabla
  `UserSession`) cierra las demás sesiones; la vieja recibe 403
  `not_authenticated` y va al login (dos puestos chocaban en el bloqueo
  optimista).
- **i18n tipado**: shell en `src/i18n.tsx`, un módulo por página en
  `src/translations/<ns>.ts`; falta una clave en un idioma → no compila.
  - **Idioma por defecto del despliegue** (`default_language` de
    `/auth/config/`, docs/aus/11): `applyDefaultLanguage(lang)` de
    `@flota/ui/i18n`. Solo se aplica si el usuario no ha elegido
    (`hasStoredLanguage()`: hay algo en `gs_base_lang`), no cuenta como
    elección y se recuerda en `gs_base_lang_default` para arrancar ya en él.
    Por eso el `LanguageProvider` refleja el idioma al montar **sin
    guardarlo** (`applyLanguage(lang, { persist: false })`) y se sincroniza
    con el evento de cambio de idioma; `setLanguage` (el conmutador) sí
    guarda. Llamarlo desde el `bootstrap` de cada app, sin bloquear.
- **Los `*_display` no son traducción** (`type_display`, `state_display`,
  `status_display`, `level_display`…: `choices` en castellano). Se traducen
  por **código**, con el texto del back de reserva para valores nuevos;
  `_display` solo sirve de segundo término de búsqueda.
  - Conductores: `src/domainLabels.ts` (`useDomainLabels`, memorizado por
    diccionario: hay `useMemo` que lo usan) sobre `vehicle.docTypes`,
    `newIncident.types`, `priority` y el bloque `domain` (documento, alerta,
    incidencia, vehículo, nombres de campo y estados de petición **por
    bandeja**: `done` es «Aplicada» en ficha y «Atendida» en propuesta).
  - Gestión: `src/domainLabels.ts` sobre `src/translations/domain.ts` (propio,
    no el shell: lo leen varios chunks): documento, alerta, incidencia,
    vehículo, registro (`event_type`), petición, plaza del parte y correo.
    `translations/vehicles.ts` toma de ahí `stateLabel` y las plazas. A
    `incidentOption`, `eventOption`, `alertOption` (`panels.ts`) se les pasa
    el `*_display` ya traducido; a la línea de tiempo, `eventTypeLabel`.
  - Sin traducir: `event_display`/`alert_display` de un documento (llegan
    compuestos, «ITV · 2026-03-01») y los **datos** (empresa, sede, CECO,
    marca, nombre del propuesto). Para las bandejas el back manda
    `document_type` e `incident_type`.
- **La frase de una alerta viaja como dato**: `message` + `message_code` +
  `message_args`, compuestos solo en `back/fleet/services/alert_messages.py`
  (`compose()`: una fuente, no pueden contar cosas distintas). Nueve
  plantillas: cuatro vencimientos de ITV y seguro, lectura de km, sin
  conductor, exceso proyectado, mantenimiento y recordatorio manual.
  - `message` sigue: lo leen correo y Excel, y es la reserva de los fronts
    ante alertas antiguas o códigos desconocidos.
  - La compone `alertMessage` de `@flota/ui/domain` (contrato del back, lo
    pintan las dos apps); la copia, la tabla `alertMessage` de cada app (como
    `tireReportSummary`: el dominio no sabe de i18n).
  - Mantenimiento: sus tramos km/fecha viajan sueltos y el front los ordena
    según idioma. El nombre del plan y la nota manual no se traducen.
  - El correo de exceso de km lee `message_args` (`mailer._context_for`),
    nunca la frase.
  - Pendiente: errores de DRF en castellano; usar el `code` de cada error.
