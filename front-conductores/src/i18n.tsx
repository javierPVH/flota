/**
 * i18n de la app de campo (M9): `createI18n` del DS con diccionarios es/en.
 *
 * Cubre TODA la app (mejora 🟡 "i18n completo"): shell, login, portones,
 * mis vehículos, ficha de campo, registro de km, alertas y modo supervisor.
 * El diccionario es tipado: si falta una clave en un idioma, no compila.
 */

import { createI18n } from '@flota/ui/i18n'

const es = {
  shell: {
    brand: 'Flota',
    tabs: {
      home: 'Inicio',
      vehicles: 'Vehículos',
      registerKm: 'Registrar km',
      alerts: 'Alertas',
      breakdown: 'Incidencia',
      incident: 'Incidencia',
      projection: 'Proyección km',
      /* Etiquetas CORTAS de las acciones del nav de "Mi vehículo". */
      km: 'Km',
      itv: 'ITV',
      maintenance: 'Mantenimiento',
      fuel: 'Combustible',
      accident: 'Accidente',
    },
    // Switch del supervisor: o estás en tu coche o estás en la flota.
    mode: {
      label: 'Cambiar de vista',
      vehicle: 'Mi vehículo',
      fleet: 'Flota',
      profile: 'Mi perfil',
    },
    /** Modo "Mi vehículo" sin coche propio: las acciones van desactivadas. */
    noVehicle: 'Sin vehículo asignado',
    logout: 'Salir',
    navLabel: 'Navegación principal',
    offlinePending: (n: number) =>
      `${n} registro${n === 1 ? '' : 's'} sin enviar — toca para reintentar`,
    offlineSending: 'Enviando pendientes…',
    offlineSent: (n: number) =>
      `${n} registro${n === 1 ? '' : 's'} pendiente${n === 1 ? '' : 's'} enviado${n === 1 ? '' : 's'}.`,
    offlineRejected: (detail: string) => `Rechazados por el servidor: ${detail}`,
    updateAvailable: 'Hay una versión nueva — toca para recargar',
    dismissNotice: 'Descartar el aviso',
  },
  common: {
    loading: 'Cargando…',
    cancel: 'Cancelar',
    logout: 'Cerrar sesión',
    seeCard: 'Ver ficha',
    registerKm: 'Registrar km',
    /** Marca de campo OBLIGATORIO en los inputs artesanales — la misma
     * pastilla que pone `requiredVisual` en los campos del DS. */
    required: 'Obligatorio',
    yes: 'Sí',
    no: 'No',
    /** Barra de buscar y filtrar de las listas largas (`ListFilter`). */
    search: 'Buscar',
    noMatches: 'Nada coincide con lo que buscas.',
    /** R3-31: la lista no cabe en una página — se dice, no se recorta en silencio. */
    truncated: (shown: number, total: number) =>
      `Lista recortada: se muestran ${shown} de ${total} registros.`,
  },
  /** Prioridad de la petición (la elige quien la abre; una alerta, en cambio,
   * saca su urgencia de la fecha). De más a menos urgente. La comparten los
   * tres formularios que abren peticiones: avería/incidencia y accidente. */
  priority: {
    label: 'Prioridad',
    hint: 'Marca la urgencia con la que hay que atenderla.',
    critical: 'Crítica',
    moderate: 'Moderada',
    functional: 'Funcional',
    informative: 'Informativa',
  },
  login: {
    brand: 'Flota',
    heading: 'Inicia sesión',
    subtitle: 'App de campo — conductores y supervisores.',
    userLabel: 'Usuario o email',
    passwordLabel: 'Contraseña',
    submit: 'Entrar',
    submitting: 'Entrando…',
    security: 'Acceso seguro con tu cuenta corporativa.',
    devTitle: 'Desarrollo · entra como usuario de prueba',
    devUserLabel: 'Usuario de prueba',
    devSubmit: 'Entrar sin contraseña',
    devNoRole: 'sin rol',
    errorLogin: 'No se pudo iniciar sesión.',
    sessionExpired: 'Tu sesión ha caducado. Vuelve a iniciar sesión.',
    errorDev: 'No se pudo entrar como usuario de prueba.',
    // Entrada solo con Google (aún sin activar).
    googleSubtitle: 'Entra con tu cuenta de Google de la empresa.',
    googleSecurity: 'Tu identidad la pone Google; aquí no se guarda ninguna contraseña.',
    googleUnavailable: 'El acceso con Google no está configurado. Avisa a Sistemas.',
    errorGoogle: 'No se pudo entrar con Google.',
    errorGoogleScript: 'No se pudo cargar el botón de Google. Comprueba tu conexión.',
  },
  home: {
    myVehicles: 'Mis vehículos',
    searchPlaceholder: 'Buscar por matrícula o modelo…',
    searchLabel: 'Buscar vehículo',
    empty: 'Sin resultados.',
    km: 'Km',
    pendingReading: 'lectura pendiente',
    /** Con última lectura conocida, la píldora dice desde cuándo falta. */
    pendingSince: (d: string) => `lectura pendiente desde el ${d}`,
    /** «Próximas citas» (home + ficha): lectura, ITV y mantenimiento con
     * fecha, semáforo y cuántos días faltan. */
    upcomingTitle: 'Próximas citas',
    kmDateLabel: 'Lectura de km',
    kmDateDay: (d: number) => `el día ${d}`,
    nextItv: 'Próx. ITV',
    nextMaintenance: 'Próx. mantenimiento',
    /** Acordeón del tablero: SOLO las incidencias (avería, neumáticos,
     * mantenimiento puntual, petición general y accidentes abiertos; el
     * mantenimiento programado y la ITV, no). */
    breakdownsTitle: 'Incidencias',
    noBreakdowns: 'Sin incidencias abiertas.',
    driver: 'Conductor',
    /* Datos de gestión de la tarjeta (solo supervisor). */
    lastReading: 'Última lectura',
    noReading: 'Sin lectura',
    projection: 'Proyección',
    openIncidents: (n: number) =>
      n === 1 ? '1 incidencia abierta' : `${n} incidencias abiertas`,
    substitute: '🔁 sustitución',
    blocked: 'Bloqueado',
    blockedNote: (reason: string, plate: string) =>
      `${reason} — sustituido por ${plate}. Registra los km y documentos sobre el sustituto.`,
    // N9: el par sustituto ↔ principal en la lista de campo.
    substituteTag: '🔁 Sustitución',
    // Marca del coche que conduce el propio supervisor dentro de su flota.
    ownTag: 'Tu coche',
    ownTitle: 'Este coche lo conduces tú',
    covering: (plate: string, reason: string) => `Cubriendo a ${plate} · ${reason}`,
    /** Reel de la pareja: el sustituto se desliza y asoma el original. */
    showOriginal: (plate: string) => `Ver el coche sustituido ${plate}`,
    backToSubstitute: (plate: string) => `Volver al coche de sustitución ${plate}`,
    statVehicles: 'Vehículos',
    statPending: 'Lecturas pendientes',
    ownEmpty: 'No conduces ningún vehículo ahora mismo.',
    ownEmptyCta: 'Ver la flota a cargo',
    quickRegister: 'Registrar km',
    quickUpload: 'Subir documento',
    quickBreakdown: 'Incidencia',
    loadError: 'No se pudieron cargar tus vehículos.',
    // Acordeón de advertencias del inicio: solo sale cuando queda poco.
    // X1: del seguro, nada — es asunto de administración.
    deadlines: {
      title: 'Te queda poco',
      count: (n: number) => (n === 1 ? '1 aviso' : `${n} avisos`),
      km: (plate: string) => `Kilómetros de ${plate}`,
      itv: (plate: string) => `ITV de ${plate}`,
      maintenance: (plate: string) => `Mantenimiento de ${plate}`,
      fuel: (plate: string) => `Combustible de ${plate}`,
      // Cuenta atrás en lenguaje natural (evita "en 1 días").
      inDays: (days: number) =>
        days <= 0 ? 'hoy es el último día' : days === 1 ? 'mañana es el último día' : `quedan ${days} días`,
      dueIn: (days: number) => (days === 0 ? 'hoy' : days === 1 ? 'mañana' : `en ${days} días`),
      overdue: (days: number) => (days === 1 ? 'venció ayer' : `venció hace ${days} días`),
      kmUntil: (lastDay: number) => `hasta el día ${lastDay}`,
      /** Antes de la ventana esto es un CONSEJO, no una cuenta atrás: se lee a
       * principios de mes, cuando la lectura aún no toca, y «se abre en 2 días»
       * sonaba a puerta cerrada en vez de a cuándo conviene darla. */
      kmOpens: (startDay: number) => `recomendable del ${startDay} a fin de mes`,
      /** Sin ventana (N8a desactivada) no hay plazo: se dice el mes que falta. */
      kmMissing: (month: string) => `falta la lectura de ${month}`,
      kmMonthEnd: (days: number) =>
        days <= 0 ? 'el mes acaba hoy' : days === 1 ? 'el mes acaba mañana' : `el mes acaba en ${days} días`,
      /** Antigüedad de la última lectura: lo que dice si esto va en rojo. */
      kmLast: (days: number) =>
        days === 0 ? 'última hoy' : days === 1 ? 'última ayer' : `última hace ${days} días`,
      kmNever: 'sin ninguna lectura',
      fuelStale: (days: number) =>
        days === 1 ? 'sin anotar desde ayer' : `sin anotar desde hace ${days} días`,
      fuelNever: 'sin ninguna anotación',
      /** GAP-2: el consumo se anota POR VIAJE, no una cifra al mes. Sin esta
       * línea el aviso se lee como si tuviera plazo mensual, y no lo tiene. */
      fuelPerTrip: 'se anota en cada viaje',
      lastOn: (date: string) => `última el ${date}`,
    },
  },
  gate: {
    checking: 'Comprobando tu acceso…',
    offline:
      'Sin conexión: no se puede comprobar tu flota ahora mismo. Reintenta cuando tengas cobertura.',
    retry: 'Reintentar',
    adminTitle: 'Sin acceso',
    adminBody: (username: string) =>
      `Esta app es para conductores y supervisores. Tu usuario (${username}) es de ` +
      'administración: usa el front de gestión (red interna / VPN).',
  },
  // R3-36: el copy de los chunks perezosos (noFleet, request, fleet, split)
  // vive en `src/translations/<ns>.ts` — cada chunk se lleva su texto. Aquí
  // queda SOLO lo que consume el bundle inicial (shell, home y sus modales).
  vehicle: {
    back: 'Volver',
    notFound: 'Vehículo no encontrado.',
    // N9: al abrir la ficha hay que ver de un golpe si el coche está parado
    // por un sustituto (no se registra nada sobre él) o si ES el sustituto.
    blockedTitle: '🔒 Bloqueado por sustitución',
    blockedPanel: (reason: string, plate: string) =>
      `${reason} — lo cubre ${plate}. Registra los km y los documentos sobre el sustituto, no aquí.`,
    coveringTitle: '🔁 Coche de sustitución',
    coveringPanel: (plate: string, reason: string) =>
      `Estás cubriendo a ${plate} (${reason}). Todo lo que registres va sobre este coche.`,
    blockedActions: 'Bloqueado por sustitución: regístralo sobre el sustituto.',
    loadError: 'No se pudo cargar el vehículo.',
    kmLabel: 'Km actual',
    readingOf: (d: string) => `Lectura del ${d}`,
    noReadings: 'Sin lecturas',
    /** N8a: el último día de la ventana es el mejor para la lectura mensual. */
    bestKmDay: (d: number) => `Mejor día para registrar los km: el ${d}`,
    nextItv: 'Próxima ITV',
    kmPending: 'Falta la lectura de km de este mes.',
    kmPendingCta: 'Registrarla ahora',
    quickUpload: 'Subir documento',
    quickItv: 'Registrar ITV',
    scheduledActionUnavailable:
      'Disponible cuando falten 30 días o menos, o cuando la fecha esté vencida.',
    /** Lo que sale al pulsar ITV o Mantenimiento con la cita todavía lejos: un
     * `title` no se lee en un móvil, y un botón muerto tampoco se explica. */
    scheduledInfo: {
      title: { itv: 'ITV programada', maintenance: 'Mantenimiento programado' },
      due: {
        itv: (fecha: string) => `La ITV está citada para el ${fecha}.`,
        maintenance: (fecha: string) => `El mantenimiento toca el ${fecha}.`,
      },
      remaining: (dias: number) =>
        dias === 1 ? 'Falta 1 día.' : dias < 0 ? 'La fecha ya pasó.' : `Faltan ${dias} días.`,
      opens: {
        itv: (fecha: string) => `Podrás registrarla a partir del ${fecha}.`,
        maintenance: (fecha: string) => `Podrás marcarlo como realizado a partir del ${fecha}.`,
      },
      why: 'Se abre 30 días antes de la cita: así no se registra por error una que todavía no toca.',
      none: {
        itv: 'Este coche no tiene ninguna ITV programada.',
        maintenance: 'Este coche no tiene ningún mantenimiento programado.',
      },
      noneHint: 'Las programa la gestión de flota. En cuanto haya una, este botón se abre solo.',
      ok: 'Entendido',
    },
    situationTitle: 'Situación',
    state: 'Estado',
    substitution: 'Sustitución',
    isSubstitute: '🔁 Es vehículo de sustitución',
    mainVehicle: 'Vehículo principal',
    driver: 'Conductor',
    noDriver: 'Sin conductor asignado',
    supervisor: 'Supervisor',
    use: 'Uso',
    /** Las TRES tarjetas de lo que el coche tiene abierto (tablero y ficha):
     * una por familia, con su recuento en el título y plegadas de salida.
     * Todo es resoluble desde ahí (las incidencias, solo por el supervisor). */
    alertsTitle: 'Alertas',
    alertsEmpty: 'Sin alertas abiertas. Todo al día.',
    incidentsTitle: 'Incidencias',
    incidentsEmpty: 'Sin incidencias abiertas.',
    accidentsTitle: 'Accidentes',
    accidentsEmpty: 'Sin accidentes abiertos.',
    /** Filtro de la cabecera: sale al desplegar y solo si hay varios tipos. */
    filterByType: 'Filtrar por tipo',
    filterAllTypes: 'Todos los tipos',
    noDate: 'Sin fecha',
    documentsTitle: 'Documentos',
    upload: 'Subir',
    noDocuments: 'Sin documentos.',
    expires: (d: string) => ` · caduca ${d}`,
    openDoc: (name: string) => `Abrir ${name}`,
    itvTitle: (plate: string) => `Registrar ITV · ${plate}`,
    itvDate: 'Fecha de la ITV',
    itvDateRequired: 'Indica la fecha de la ITV.',
    itvToday: 'Hoy',
    itvCalc: 'Calcular',
    /** De dónde sale la fecha que ha puesto «Calcular». */
    itvCalcNote: (periodo: string) =>
      `Propuesta: ${periodo} desde la fecha de la ITV, por la edad del vehículo. Si el informe dice otra, corrígela.`,
    itvEveryYears: (n: number) => (n === 1 ? '1 año' : `${n} años`),
    itvEveryMonths: (n: number) => `${n} meses`,
    itvResult: 'Resultado',
    itvResultDone: 'Favorable',
    itvResultNotDone: 'Desfavorable',
    /** Lo que está en juego al elegir, junto a cada opción. */
    itvResultDoneNote: 'Cierra los avisos de ITV del vehículo.',
    itvResultNotDoneNote: 'La cita sigue pendiente: los avisos no se cierran.',
    itvNextDue: 'Próxima ITV',
    itvNextDueHint: 'Opcional: la que indique el informe. En blanco, el coche queda sin próxima cita hasta que se registre.',
    /** R3-32: espejo del back — la próxima ITV es posterior a la inspección. */
    itvNextDueInvalid: 'La próxima ITV debe ser posterior a la fecha de la inspección.',
    itvAnyDate: 'Se puede registrar antes o después de esa fecha.',
    itvNoDate: 'Este vehículo no tiene próxima ITV registrada.',
    itvReport: 'Informe de la ITV',
    itvReportHint: 'Foto o PDF · opcional',
    itvReportChange: 'Toca para cambiarlo',
    itvReportQueued: 'Sin conexión: el informe se subirá al recuperar la cobertura.',
    itvReportFailed: 'El informe no se pudo subir: súbelo desde Documentos del vehículo.',
    itvSubmit: 'Registrar ITV',
    itvSubmitting: 'Registrando…',
    itvOk: 'ITV registrada. Los avisos asociados se cierran y la próxima fecha queda actualizada.',
    itvOffline: 'Estás sin conexión: la ITV se registrará sola en cuanto vuelva la red.',
    itvError: 'No se pudo registrar la ITV.',
    docType: 'Tipo de documento',
    docTypes: {
      registration_certificate: 'Permiso de circulación',
      technical_datasheet: 'Ficha técnica',
      insurance: 'Seguro',
      contract: 'Contrato',
      delivery_report: 'Acta de entrega',
      return_report: 'Acta de devolución',
      accident_report: 'Parte de accidente',
      damage_photos: 'Fotos de daños',
      // No se ofrecen al subir (los cuelga el formulario que cierra la ITV o
      // la incidencia), pero SÍ salen en la lista: sin ellos, esas dos filas
      // se quedaban con la etiqueta que manda el back, en castellano.
      itv_report: 'Informe de ITV',
      workshop_invoice: 'Factura de taller',
      driving_license: 'Permiso de conducir',
      other: 'Otro',
    } as Record<string, string>,
    filePick: 'Foto o PDF (cámara / galería)',
    expiry: 'Caducidad (opcional)',
    linkIncident: 'Ligado a incidencia abierta (opcional)',
    linkNone: 'Ninguna',
    linkAccident: 'Accidente abierto',
    linkChoose: 'Elige el accidente…',
    linkAccidentRequired: 'Elige el accidente al que pertenece el parte.',
    noOpenAccident:
      'Un parte de accidente va ligado a un accidente abierto y este vehículo no tiene ninguno: comunica primero el accidente.',
    // Las fotos de daños son las fotos DE una incidencia: obligatoria.
    linkIncidentOpen: 'Incidencia abierta',
    linkChooseIncident: 'Elige la incidencia…',
    linkIncidentRequired: 'Elige la incidencia a la que pertenecen las fotos.',
    noOpenIncident:
      'Unas fotos de daños van ligadas a una incidencia abierta y este vehículo no tiene ninguna: comunica primero la incidencia.',
    notes: 'Notas (opcional)',
    chooseFile: 'Elige una foto o un PDF.',
    uploadSubmitting: 'Subiendo…',
    uploadOkPending:
      'Documento subido. Queda pendiente de archivar en Drive; mientras tanto se abre desde aquí.',
    uploadOkArchived: 'Documento subido y archivado en Drive.',
    uploadOffline: 'Estás sin conexión: el documento se subirá solo en cuanto vuelva la red.',
    uploadError: 'No se pudo subir el documento.',
  },
  km: {
    title: 'Registrar kilómetros',
    vehicle: 'Vehículo',
    choose: 'Elige un vehículo…',
    lastReading: 'Última lectura:',
    /** R3-42: la última lectura salió del cálculo de km faltantes (N8b). */
    estimatedTag: 'estimado',
    estimatedNote:
      'La última lectura es una estimación automática, no un dato del cuadro: ' +
      'registra el kilometraje real cuando puedas.',
    missingMonth: ' — falta la de este mes.',
    firstReading: 'Aún no hay lecturas: esta será la primera.',
    odometer: 'Odómetro (km totales del cuadro)',
    date: 'Fecha de la lectura',
    historyTitle: 'Histórico de lecturas',
    save: 'Guardar lectura',
    saving: 'Guardando…',
    noGoBack: (last: string) => `El odómetro no puede retroceder: la última lectura fue ${last}.`,
    savedTitle: 'Lectura guardada',
    queuedTitle: 'Lectura en cola',
    queuedNote: 'Estás sin conexión: la lectura se enviará sola en cuanto vuelva la red.',
    drivenPrefix: 'Has recorrido ',
    drivenSuffix: ' desde la última lectura.',
    another: 'Registrar otra lectura',
    backHome: 'Volver a mis vehículos',
    throttled: 'Demasiados registros seguidos. Espera un momento y reintenta.',
    windowClosed: (start: number) =>
      `El registro de km se abre del día ${start} al último día del mes.`,
    queueFailed:
      'Sin conexión y sin poder guardar en el dispositivo (¿modo privado o memoria llena?). La lectura NO se ha registrado: reinténtalo con conexión.',
    saveError: 'No se pudo guardar la lectura.',
  },
  alerts: {
    title: 'Alertas',
    showClosed: 'Ver cerradas',
    onlyOpen: 'Solo abiertas',
    fleet: 'flota',
    /* Acordeón por coche: total y desglose por tipo en la cabecera. */
    groupFleet: 'Flota',
    groupCount: (n: number) => (n === 1 ? '1 alerta' : `${n} alertas`),
    /* Clasificadores por tipo: el global de la bandeja y el de cada coche. */
    tabAll: 'Todas',
    typeFilter: 'Filtrar por tipo de alerta',
    classifyLabel: 'Clasificar las alertas por tipo',
    resolved: (plate: string) => `Alerta de ${plate} resuelta.`,
    loadError: 'No se pudieron cargar las alertas.',
    closeError: 'No se pudo cerrar la alerta.',
    pushTitle: 'Avisos en este dispositivo',
    pushOn: 'Recibirás las alertas aunque la app esté cerrada.',
    pushBlocked: 'Bloqueados por el navegador: actívalos en sus ajustes.',
    pushNotConfigured: 'Los avisos no están configurados en el servidor. Avisa a Sistemas.',
    pushUnknown: 'No se pudo comprobar el estado (¿sin conexión?).',
    pushRetry: 'Reintentar',
    pushOff: 'ITV, lecturas pendientes y más, aunque la app esté cerrada.',
    pushEnable: 'Activar',
    pushDisable: 'Desactivar',
    pushError: 'No se pudo cambiar el estado de los avisos.',
    empty: 'Sin alertas abiertas. Todo al día.',
    due: (d: string) => `Vence: ${d}`,
    created: (d: string) => `Creada el ${d}`,
    resolve: 'Resolver',
    /* Modal de resolución personalizado por tipo (solo gestión). */
    resolveTitle: (plate: string) => `Resolver alerta · ${plate}`,
    resolveSubmit: 'Resolver alerta',
    resolveNoteLabel: 'Observaciones (opcional, quedan en la alerta resuelta)',
    /** Proponer otro conductor: solo en la alerta de km contratados, que es la
     * única que se arregla cambiando quién lleva el coche. No resuelve nada:
     * abre una solicitud que decide administración. */
    propose: {
      title: '¿Debería llevarlo otra persona?',
      intro:
        'Si el coche va camino de pasarse de los km contratados, propón a quien ruede menos. ' +
        'No se cambia nada ahora: la propuesta la decide administración.',
      whoLabel: 'A quién propones (de tu flota)',
      whoNone: 'Nadie de la lista — lo explico abajo',
      /** La única caja de texto de esa ventana: viaja con la propuesta y, si
       * se resuelve la alerta, es lo que queda escrito en ella. */
      noteLabel: 'Nota (queda en la propuesta y en la alerta)',
      noteRequiredLabel: 'Nota para administración (di a quién y por qué)',
      submit: 'Enviar propuesta',
      sending: 'Enviando…',
      sent: 'Propuesta enviada. Administración la decide en sus solicitudes.',
      error: 'No se pudo enviar la propuesta.',
    },
    resolveKmTitle: (plate: string) => `Registrar km · ${plate}`,
    resolveKmIntro: 'Registrar la lectura de este mes resuelve la alerta.',
    resolveKmLabel: 'Lectura del cuentakilómetros',
    resolveKmLast: (v: string, d: string) => `Última conocida: ${v} (${d})`,
    resolveKmSubmit: 'Registrar y resolver',
    resolveKmNote: (v: string) => `Lectura registrada: ${v}`,
    closedTitle: 'Resueltas',
  },
  group: {
    title: 'Proyección de km',
    loadError: 'No se pudo cargar el grupo.',
    levels: { within: 'Dentro', watch: 'A vigilar', over: 'Riesgo exceso' } as Record<
      string,
      string
    >,
    /** Sin contrato de km o con km ilimitados: no hay proyección que pintar. */
    levelNone: 'Sin proyección',
    statVehicles: 'Vehículos',
    statWatch: 'A vigilar',
    statOver: 'En riesgo',
    tabsLabel: 'Filtrar por nivel',
    tabAll: 'Todos',
    noDriver: 'sin conductor',
    progressLabel: (pct: number) => `Kilómetros consumidos sobre contratados: ${pct}%`,
    consumedOf: (driven: string, contracted: string) => `${driven} de ${contracted} contratados`,
    /** Avance temporal del contrato: la marca de "por dónde deberías ir". */
    elapsed: (pct: number) => `Contrato al ${pct}%`,
    elapsedMarker: (pct: number) => `Avance temporal del contrato: ${pct}%`,
    monthlyAvg: 'Media mensual',
    paceContracted: (rate: string) => `contratado ${rate}/mes`,
    projectedEnd: 'Proyección a fin',
    remaining: 'Restantes',
    overage: 'Exceso estimado',
    noContract: 'Sin contrato de km: no hay proyección.',
    unlimited: 'Km ilimitados',
    unlimitedNote: 'Km ilimitados: este vehículo no tiene proyección ni límite de km.',
    showChart: 'Ver evolución',
    hideChart: 'Ocultar evolución',
    incidents: 'Incidencias',
    newIncident: 'Nueva',
  },
  // Recordatorio del supervisor (correo y/o alerta) desde la tarjeta del coche.
  reminder: {
    button: 'Enviar recordatorio',
    title: (plate: string) => `Recordatorio · ${plate}`,
    recipient: (name: string) => `Conductor: ${name}`,
    noDriver: 'Sin conductor asignado: el correo no se podrá entregar.',
    kindLabel: 'Motivo',
    kinds: {
      km_reading_pending: 'Lectura de km sin registrar',
      itv_due: 'ITV',
      maintenance_due: 'Mantenimiento',
    } as Record<string, string>,
    channelEmail: 'Enviar correo',
    channelAlert: 'Crear alerta en la app',
    message: 'Mensaje adicional (opcional)',
    submit: 'Enviar',
    alertCreated: 'Alerta creada en la app.',
    alertExisted: 'La alerta de hoy ya estaba abierta.',
    emailSent: 'Correo enviado.',
    emailSkipped: (reason: string) => `Correo no enviado: ${reason}.`,
    skipReasons: {
      sin_email: 'el conductor no tiene email',
      correo_deshabilitado: 'el correo saliente está deshabilitado',
      fallo_envio: 'falló el envío',
    } as Record<string, string>,
    error: 'No se pudo enviar el recordatorio.',
    close: 'Cerrar',
  },
  // Lanzar una incidencia desde la tarjeta/ficha, con el coche fijado. En TRES
  // pasos: qué pasa · qué lo prueba · dónde se arregla.
  breakdown: {
    title: (plate: string) => `Comunicar incidencia · ${plate}`,
    stepTires: 'Neumáticos',
    stepAvailability: 'Disponibilidad',
    stepDocs: 'Documentos',
    stepManage: 'Gestión',
    docsHint:
      'Adjunta lo que ayude a entenderlo: fotos del daño, el presupuesto del ' +
      'taller… Puedes añadir varios y no es obligatorio.',
    /** Único requisito de la petición de coche: justificarla con algo. */
    docsRequired:
      'Para pedir coche de sustitución hay que adjuntar al menos un documento ' +
      '(foto del daño, informe del taller…). Puedes añadir varios.',
    substituteDocsTitle: 'Documentación del coche de sustitución',
    substituteDocsHint:
      'Si ya te han dado uno, sube aquí su documentación: permiso de ' +
      'circulación, ficha técnica, seguro… Puedes subir varios y es opcional ' +
      '(lo normal al comunicarlo es no tenerlo todavía).',
    substituteAttach: 'Adjuntar documentación del coche de sustitución',
    availabilityLabel: '¿Cómo queda el coche?',
    availabilityHint:
      'Esto no cambia el estado del vehículo: lo registra la gestión, que es ' +
      'quien decide.',
    availability: {
      active: 'Sigue en servicio',
      stopped: 'No se puede usar',
      substitute: 'Necesito coche de sustitución',
    },
    availabilityNotes: {
      active: 'Puedo seguir conduciéndolo mientras se atiende.',
      stopped: 'El coche se queda parado, pero no hace falta otro.',
      substitute:
        'Se abre una solicitud de coche a administración, que decide si lo ' +
        'facilita. Hay que adjuntar algún documento.',
    },
    removeFile: (name: string) => `Quitar ${name}`,
    vehicle: 'Vehículo',
    date: 'Fecha',
    description: 'Descripción',
    attach: 'Adjuntar foto (opcional)',
    next: 'Continuar',
    back: 'Atrás',
    workshop: 'Taller',
    workshopHint: 'Indica el código postal de la ubicación desde la que prefieres acudir al taller más cercano.',
    preferredPostalCode: 'Código postal de la ubicación preferente',
    cost: 'Coste (€)',
    submit: 'Comunicar incidencia',
    saved: 'Incidencia comunicada.',
    savedRequest:
      'Incidencia comunicada. Tu solicitud de coche de sustitución queda ' +
      'pendiente de administración.',
    savedUploadFailed: 'Incidencia comunicada; algún adjunto no se pudo subir.',
    /** R3-27: el adjunto quedó en la cola offline — llegará al reconectar. */
    savedUploadQueued:
      'Incidencia comunicada; sin conexión, el adjunto quedó guardado y se subirá al recuperar la cobertura.',
    /** R3-27: el parte entero quedó en la cola offline. */
    queued:
      'Sin conexión: la incidencia quedó guardada en el móvil y se comunicará al recuperar la cobertura.',
    error: 'No se pudo comunicar la incidencia.',
    close: 'Cerrar',
  },
  // Nueva incidencia desde la tarjeta: selector de tipo, cada uno con su div
  // informativo. Los tipos son los de gestión (`src/incidentTypes.ts`).
  incidentModal: {
    title: (plate: string) => `Incidencia · ${plate}`,
    kind: 'Tipo',
    kinds: {
      maintenance: 'Mantenimiento puntual',
      tires: 'Cambio de neumáticos',
      breakdown: 'Avería',
      general: 'Petición general',
    },
    info: {
      maintenance:
        'Mantenimiento puntual: cosas rotas o cambios necesarios que no ' +
        'impiden conducir; se atienden sin urgencia. El programado va por su ' +
        'plan, no por aquí.',
      tires:
        'Cambio de neumáticos por desgaste o pinchazo. El taller y la cita se ' +
        'concretan después, en la gestión.',
      breakdown:
        'El vehículo ha fallado: no está en condiciones de circular o no se ' +
        'puede usar con normalidad.',
      general:
        'Solicitud general: peticiones que quizá no tienen que ver con el ' +
        'vehículo (documentación, tarjetas, dudas…).',
    },
    date: 'Fecha',
    description: 'Descripción',
    attach: 'Adjuntar documento o foto (opcional)',
    tireRequiredBase: 'Obligatorios para continuar: kilometraje y motivo.',
    tireRequiredWear: 'En desgaste: qué ruedas y las medidas de los ejes elegidos.',
    tireRequiredPuncture: 'En pinchazo: qué rueda y medida del neumático.',
    submit: 'Comunicar incidencia',
    saved: 'Incidencia comunicada.',
    savedUploadFailed: 'Incidencia comunicada; el adjunto no se pudo subir.',
    error: 'No se pudo comunicar la incidencia.',
    close: 'Cerrar',
  },
  // Actualización de campo del supervisor: km, mantenimiento y partes de
  // incidencia EN NOMBRE del conductor (el aviso de responsabilidad lo deja claro).
  carUpdate: {
    button: 'Actualizar datos',
    maintenanceButton: 'Actualizar mantenimiento',
    title: (plate: string) => `Actualizar · ${plate}`,
    notice:
      'La responsabilidad de registrar los km, el mantenimiento y las incidencias es ' +
      'del conductor, no del supervisor. Usa esto solo en su lugar cuando haga ' +
      'falta: quedará registrado a tu nombre.',
    /** La X del aviso. Dice hasta cuándo se calla: no es «cerrar» y ya está. */
    noticeHide: 'Ocultar el aviso en esta sesión',
    /** El icono que lo devuelve, en el hueco que deja la X. */
    noticeShow: 'Ver el aviso de responsabilidad',
    /** Una pestaña por cosa que se actualiza; no hay «Alertas»: cada alerta se
     * cierra haciendo lo suyo en su pestaña. */
    tabsLabel: 'Qué actualizar',
    tabs: {
      km: 'Km',
      fuel: 'Combustible',
      itv: 'ITV',
      maintenance: 'Mantenimiento',
      incidents: 'Incidencias',
    },
    kmLabel: 'Lectura del cuentakilómetros',
    kmCurrent: (v: string) => `Última conocida: ${v}`,
    kmLast: (value: string, date: string) => `Última lectura: ${value} · ${date}`,
    kmDateUnknown: 'fecha desconocida',
    kmNever: 'No hay ninguna lectura anterior.',
    kmSubmit: 'Registrar lectura',
    kmSaved: (v: string) => `Lectura registrada: ${v}.`,
    planEvery: (txt: string) => `cada ${txt}`,
    planLast: (txt: string) => `último: ${txt}`,
    planNever: 'sin registrar',
    /** Es un BOTÓN, no la etiqueta de un campo: «Realizado en:» prometía un
     * hueco donde escribir y lo que hace es preguntar la fecha. */
    planDone: 'Marcar como realizado',
    planNext: (date: string) => `Próxima: ${date}`,
    planDateTitle: (name: string) => `¿Cuándo se hizo? · ${name}`,
    planDateLabel: 'Fecha de realización',
    planToday: 'Hoy',
    planDateAccept: 'Marcar como realizado',
    planChosen: (date: string) => `Mantenimiento realizado el ${date}.`,
    planMore: 'Ver detalles',
    planLess: 'Ocultar detalles',
    planFrequency: 'Periodicidad',
    planLastDate: 'Última realización',
    planLastKm: 'Kilometraje de la última realización',
    planSaved: (name: string) => `«${name}» reanclado a hoy.`,
    planAlerts: (n: number) => (n === 1 ? '1 alerta resuelta.' : `${n} alertas resueltas.`),
    plansEmpty: 'Este vehículo no tiene planes de mantenimiento (los crea administración).',
    /** Este modal es SOLO el mantenimiento programado: las incidencias viven en
     * su tarjeta, y quien las cerraba aquí tiene que saber adónde ir. */
    plansOnly:
      'Mantenimiento programado del coche. Las incidencias se comunican y se solucionan ' +
      'en su tarjeta «Incidencias».',
    months: (n: number) => (n === 1 ? '1 mes' : `${n} meses`),
    actionView: 'Ver',
    actionManage: 'Gestión',
    actionResolve: 'Solucionar',
    actions: { view: 'Detalle', manage: 'Gestión', resolve: 'Solución' },
    detailStatus: 'Estado',
    detailDate: 'Fecha',
    detailDescription: 'Descripción',
    detailMileage: 'Kilometraje',
    detailPostalCode: 'CP de ubicación preferente',
    noDate: 'Sin fecha',
    /* Ciclo en tres fases de toda incidencia: lanzar → gestión → solución. */
    workshop: 'Taller',
    preferredPostalCode: 'Código postal de la ubicación preferente',
    cost: 'Coste (€)',
    manageSubmit: 'Guardar gestión',
    managed: 'Gestión guardada: la incidencia queda en curso.',
    observations: 'Observaciones',
    downtime: 'Tiempo parado (días)',
    resolutionDate: 'Fecha de solución',
    calculatedDowntime: (n: number) => `Tiempo parado calculado: ${n === 1 ? '1 día' : `${n} días`}`,
    resolveSubmit: 'Cerrar incidencia',
    resolvedNote: 'Incidencia cerrada.',
    incidentsEmpty: 'Sin incidencias abiertas.',
    loadError: 'No se pudo cargar.',
    error: 'No se pudo guardar.',
    close: 'Cerrar',
  },
  // Vista propia de subida de documentos; los campos reutilizan `vehicle.*`.
  uploadDoc: {
    title: 'Subir documento',
    /** Los tres pasos: qué se sube, de qué es y qué más hay que decir. */
    stepFile: 'Tipo y documento',
    stepLink: 'Ligado a',
    stepNotes: 'Notas',
    linkHint:
      'A qué incidencia del coche acompaña este documento. Lo exigen la '
      + 'factura del taller, las fotos de daños y el parte de accidente; el '
      + 'resto lo llevan si viene a cuento.',
    linkNothing:
      'Este documento no se liga a ninguna incidencia: sigue al paso '
      + 'siguiente.',
    notesHint:
      'Algo que ayude a reconocerlo después en la lista de documentos. Es '
      + 'opcional.',
    back: 'Volver',
    vehicle: 'Vehículo',
    choose: 'Elige un vehículo…',
    submit: 'Subir',
    savedTitle: 'Documento subido',
    another: 'Subir otro',
    backHome: 'Volver al inicio',
  },
  newIncident: {
    title: 'Nueva incidencia',
    /** El inicio tiene un acceso propio para "Incidencia": el título lo refleja. */
    titleBreakdown: 'Comunicar incidencia',
    back: 'Volver',
    vehicle: 'Vehículo',
    choose: 'Elige un vehículo…',
    type: 'Tipo',
    // Los mismos nombres que gestión y que el back (`IncidentType`).
    types: {
      general: 'Petición general',
      breakdown: 'Avería',
      accident: 'Accidente',
      maintenance: 'Mantenimiento puntual',
      tires: 'Cambio de neumáticos',
      inspection: 'Revisión',
    } as Record<string, string>,
    date: 'Fecha',
    description: 'Descripción',
    descPlaceholder: 'Qué ha pasado, dónde, estado del vehículo…',
    tiresData: 'Datos del cambio',
    accidentData: 'Datos del accidente',
    /** Pasos del parte, los mismos que en gestión. */
    stepWhere: 'Dónde y cuándo',
    stepDamage: 'Daños',
    stepPeople: 'Implicados',
    stepReport: 'Atestado y archivo',
    peopleHint:
      'Otros vehículos y personas heridas, si las hay. Es opcional: un '
      + 'accidente sin implicados también se comunica.',
    reportHint:
      'El número de atestado y el parte en papel, si los tienes. También '
      + 'son opcionales: puedes añadirlos después desde la ficha.',
    mileage: 'Kilometraje actual',
    /** Pista bajo el odómetro cuando viene precargado del resumen del coche. */
    mileageFromReading: (value: string) => `Última lectura conocida: ${value}`,
    /** R3-42: la precarga sale de una lectura ESTIMADA (N8b) — verifícala. */
    mileageFromReadingEstimated: (value: string) =>
      `Última lectura conocida: ${value} (estimada — verifica el cuadro)`,
    workshopPostalCodeOptional: 'CP del taller (opcional)',
    changeReason: 'Motivo del cambio',
    wear: 'Desgaste',
    puncture: 'Pinchazo',
    whichWheels: '¿Qué ruedas?',
    whichWheel: '¿Qué rueda?',
    front: 'Delanteras',
    rear: 'Traseras',
    allWheels: 'Las 4 ruedas',
    frontLeft: 'Delantera izquierda',
    frontRight: 'Delantera derecha',
    rearLeft: 'Trasera izquierda',
    rearRight: 'Trasera derecha',
    frontMeasure: 'Medidas delanteras',
    rearMeasure: 'Medidas traseras',
    tireMeasure: 'Medidas del neumático',
    comment: 'Comentario',
    street: 'Calle',
    streetNumber: 'Número',
    postalCode: 'Código postal',
    locality: 'Localidad',
    province: 'Provincia',
    accidentAt: 'Fecha y hora',
    phone: 'Teléfono',
    damageDescription: 'Descripción de los daños',
    thirdParties: 'Terceros implicados',
    injuredPeople: 'Lesionados',
    add: 'Añadir',
    /** Cada implicado se rellena en su propio modal y en la lista se lee
     * en una línea, con sus dos acciones. */
    thirdPartyTitle: 'Tercero implicado',
    injuredTitle: 'Lesionado',
    save: 'Guardar',
    edit: (quien: string) => `Modificar ${quien}`,
    noThirdParties: 'Sin terceros implicados.',
    noInjured: 'Sin lesionados.',
    unnamed: 'Sin nombre',
    thirdPartyRequired: 'Del tercero hacen falta el nombre y la matrícula.',
    injuredRequired: 'Del lesionado hace falta el nombre.',
    removeThirdParty: (quien: string) => `Quitar a ${quien}`,
    removeInjured: (quien: string) => `Quitar a ${quien}`,
    plate: 'Matrícula',
    brand: 'Marca',
    model: 'Modelo',
    fullName: 'Nombre y apellidos',
    insurer: 'Aseguradora',
    policyNumber: 'N.º de póliza',
    email: 'Correo electrónico',
    seat: 'Plaza ocupada',
    driver: 'Conductor',
    passenger: 'Ocupante',
    policeReportReference: 'Referencia del atestado (opcional)',
    accidentReport: 'Archivo del parte (opcional)',
    // Vale para cualquier tipo: una foto del daño, pero también el
    // presupuesto del taller o el papel de una petición general.
    attachments: 'Fotos o documentos (cámara, galería o archivo; opcional)',
    attachmentsSelected: (n: number) =>
      `${n} archivo${n === 1 ? '' : 's'} seleccionado${n === 1 ? '' : 's'}`,
    submit: 'Crear incidencia',
    submitting: 'Creando…',
    createError: 'No se pudo crear la incidencia.',
    uploadFailed: (names: string) =>
      `Incidencia creada, pero no se pudieron subir: ${names}. Puedes añadirlas desde la ` +
      'ficha del vehículo.',
    /** R3-27: el parte quedó en la cola offline (con sus adjuntos). */
    queuedTitle: 'Guardado sin conexión',
    queuedNote:
      'La incidencia quedó guardada en este dispositivo (con sus adjuntos) y se comunicará ' +
      'automáticamente al recuperar la cobertura.',
  },
  accidentModal: {
    button: 'Accidente',
    title: (plate: string) => `Comunicación de accidente · ${plate}`,
    submit: 'Comunicar accidente',
    saved: 'Accidente comunicado correctamente.',
    savedUploadFailed: (name: string) =>
      `Accidente comunicado, pero no se pudo subir el archivo ${name}.`,
    /** R3-27: el archivo del parte quedó en la cola offline. */
    savedUploadQueued: (name: string) =>
      `Accidente comunicado; sin conexión, el archivo ${name} se subirá al recuperar la cobertura.`,
    /** R3-27: el parte entero quedó en la cola offline. */
    queued:
      'Sin conexión: el accidente quedó guardado en el móvil (con su archivo) y se comunicará ' +
      'al recuperar la cobertura.',
    close: 'Cerrar',
  },
  /** R3-43: documentos PERSONALES (permiso de conducir…) en la app de campo.
   * Gestión ya los subía con titular persona y aquí no se veían. */
  myDocs: {
    title: 'Mis documentos',
    hint:
      'Documentos personales, como el permiso de conducir. Los ve también tu ' +
      'supervisor y la gestión de flota.',
    empty: 'Sin documentos personales.',
    upload: 'Subir documento personal',
    type: 'Tipo',
    types: {
      driving_license: 'Permiso de conducir',
      other: 'Otro',
    } as Record<string, string>,
    expiry: 'Caducidad (opcional)',
    submit: 'Subir',
    submitting: 'Subiendo…',
    uploadOk: 'Documento subido.',
    uploadOffline:
      'Sin conexión: el documento quedó guardado y se subirá al recuperar la cobertura.',
    uploadError: 'No se pudo subir el documento.',
    loadError: 'No se pudieron cargar tus documentos.',
  },
  /** Documentación en una tarjeta con dos pestañas: el titular del documento
   * es un coche O una persona, y eso es lo que separan. */
  docs: {
    title: 'Documentación',
    tabs: {
      vehicle: 'Documentación del coche',
      driver: 'Documentación del conductor',
    } as Record<'vehicle' | 'driver', string>,
    vehicleHint:
      'Papeles del vehículo: permiso de circulación, ficha técnica, seguro… Se ' +
      'quedan con el coche cuando lo devuelves.',
    /** Lo que se puede hacer con un documento desde el campo: verlo,
     * descargarlo y PEDIR su borrado — que no lo borra: lo decide la gestión. */
    viewDoc: (name: string) => `Ver ${name}`,
    viewTitle: (name: string) => `Ver · ${name}`,
    viewLoading: 'Abriendo el documento…',
    viewError: 'No se pudo abrir el documento. Inténtalo de nuevo.',
    /** Por qué no queda nada en el móvil después de mirarlo. */
    viewNote: 'Se trae solo para verlo: al cerrar esta ventana, la copia desaparece del móvil.',
    viewNewTab: 'Verlo a pantalla completa',
    download: 'Descargar',
    downloadDoc: (name: string) => `Descargar ${name}`,
    /** La descarga también pasa por el back: tampoco se va a Drive a por ella. */
    downloadError: 'No se pudo descargar el documento. Inténtalo de nuevo.',
    askDeleteDoc: (name: string) => `Pedir el borrado de ${name}`,
    deleteTitle: (name: string) => `Pedir el borrado · ${name}`,
    deleteHint:
      'No se borra aquí: la petición va a la gestión, que decide. Hasta entonces el ' +
      'documento sigue en la lista, con su chapa de pendiente de borrado.',
    deleteReason: 'Motivo (opcional)',
    deleteSubmit: 'Pedir borrado',
    deleteSubmitting: 'Enviando…',
    deleteOk: 'Petición enviada. La gestión decidirá qué hacer con el documento.',
    deleteError: 'No se pudo pedir el borrado. Inténtalo de nuevo.',
    deletePending: 'Pendiente de borrado por parte del administrador',
    deletePendingNote: 'Ya hay una petición sobre este documento: la gestión la está revisando.',
    /** Corregir tampoco lo hace el campo: lo pide, como el borrado. */
    fixDoc: (what: string) => `Pedir que se corrija ${what}`,
    fixTitle: (what: string) => `Corregir ${what}`,
    fixHint:
      'Esto no cambia el documento: manda una petición a la gestión, que la aplica o la rechaza. El archivo se queda donde está.',
    fixType: 'Tipo de documento',
    fixExpiry: 'Fecha de caducidad',
    fixNotes: 'Nota del documento',
    fixReason: 'Por qué hay que corregirlo',
    fixSubmit: 'Enviar petición',
    fixSubmitting: 'Enviando…',
    fixOk: 'Petición enviada. La gestión decidirá si se corrige.',
    fixError: 'No se pudo pedir la corrección. Inténtalo de nuevo.',
  },
  /** Pantalla del avatar del header: los datos del usuario y su documentación. */
  profile: {
    title: 'Mi perfil',
    dataTitle: 'Mis datos',
    dataHint:
      'Aquí solo se consultan: corregirlos lo decide la gestión de flota, y se le pide desde aquí.',
    email: 'Correo',
    phone: 'Teléfono',
    dni: 'DNI',
    licenseType: 'Tipo de permiso',
    fuelCard: 'Tarjeta de combustible',
    empty: 'Sin datos',
    roleNames: {
      admin: 'Administración',
      supervisor: 'Supervisor',
      driver: 'Conductor',
    } as Record<'admin' | 'supervisor' | 'driver', string>,
    /** Resumen de lo que lleva a cargo quien supervisa: cinco cifras y, tras
     * cada una, la lista de lo que la compone. */
    /** Pedir que la gestión corrija la ficha: la pantalla es de lectura, así
     * que lo que se manda es una solicitud a su bandeja. */
    edit: {
      button: 'Mis datos',
      title: 'Mis datos y mis documentos',
      introTitle: 'Desde aquí se PIDE, no se guarda',
      intro:
        'Nada de esto cambia tu ficha al momento: manda una petición a la gestión de flota, que la aplica o la rechaza.',
      /** Los tres pasos del carrusel, como en subir documento. */
      stepData: 'Tus datos',
      stepDocs: 'Documentos',
      stepSend: 'Enviar',
      dataTitle: 'Tus datos',
      dataHint: 'Corrige solo lo que esté mal: viaja únicamente lo que toques.',
      firstName: 'Nombre',
      lastName: 'Apellidos',
      emailHint: 'Es la cuenta con la que entras: cambiarlo lo revisa la gestión.',
      dniHint: 'Lo comprueban con tu documento antes de aplicarlo.',
      note: 'Nota para la gestión',
      noteHint: 'Cuéntales por qué hay que corregirlo: es lo que leen para decidir.',
      licenseNone: 'Sin especificar',
      /** Los tipos de permiso del back (`accounts.LicenseType`). La letra es la
       * misma en los dos idiomas; lo que se traduce es lo que lleva al lado. */
      licenseTypes: {
        B: 'B (turismos)',
        C1: 'C1',
        C: 'C (camiones)',
        'C+E': 'C+E (camión con remolque)',
        D1: 'D1',
        D: 'D (autobuses)',
      } as Record<string, string>,
      submit: 'Enviar petición',
      submitting: 'Enviando…',
      nothing: 'Cambia algún dato o escribe una nota.',
      error: 'No se pudo enviar la petición. Inténtalo de nuevo.',
      ok: 'Petición enviada. La gestión la revisará.',
      savedTitle: 'Petición enviada',
      backToDocs: 'Volver a mis documentos',
      /** Último paso: lo que se va a pedir, campo a campo. Enviar no puede ser
       * un salto a ciegas («¿mandé el teléfono o no?»). */
      reviewTitle: 'Lo que vas a pedir',
      reviewEmpty: 'No has cambiado ningún dato. Si solo quieres avisar de algo, escríbelo aquí.',
      submitHint: 'Esto manda solo tus datos: cada documento va por su cuenta.',
      docsTitle: 'Modificar los documentos subidos',
      docsHint:
        'Cada documento se corrige o se pide borrar por su cuenta, con los botones de su fila.',
      pending: 'Tienes una petición de ficha esperando decisión.',
      pendingSince: (when: string) => `Pedida el ${when}.`,
      pendingNote: 'Mientras tanto, la ficha sigue como está.',
    },
    /** Lo que uno tiene pedido, en la propia pantalla: pendiente y resuelto. */
    requests: {
      title: 'Peticiones',
      tabsLabel: 'Peticiones pendientes o resueltas',
      tabPending: 'Pendientes',
      tabDone: 'Resueltas',
      emptyPending: 'No tienes nada pendiente de decisión.',
      emptyDone: 'Todavía no te han resuelto ninguna.',
      loadError: 'No se pudieron cargar tus peticiones.',
      kindProfile: 'Mi ficha',
      kindDocument: 'Documento',
      kindVehicle: 'Coche',
      kindDriver: 'Cambio de conductor',
      asked: (when: string) => `Pedida el ${when}`,
      noDetail: 'Sin detalle',
    },
  },
  /** GAP-2: consumo medio de campo (hermano del de km): lo que marca el
   * ordenador de a bordo, con su día. */
  fuel: {
    title: 'Consumo medio',
    noteLead:
      'Por favor, anota el consumo medio que marca el ordenador de a bordo correspondiente a tu último trayecto o ciclo de repostaje.',
    noteWarn: 'NO anotes el "consumo histórico" o acumulado total del vehículo.',
    consumption: 'Consumo medio real en ese momento (l/km o kWh/km)',
    /** El ejemplo del campo lleva el separador decimal del idioma: con la app
     * en inglés (`en-GB`) se teclea con punto, no con coma. */
    consumptionPlaceholder: '6,80',
    date: 'Fecha',
    save: 'Guardar consumo',
    /** Lo enseña la pestaña «Combustible» de «Actualizar», que no se cierra al
     * guardar: la ventana sigue abierta por si toca otra cosa. */
    saved: 'Consumo anotado.',
    saving: 'Guardando…',
    saveError: 'No se pudo guardar el consumo.',
    lastNoted: 'Última anotación',
    noneYet: 'Sin anotaciones de consumo todavía.',
  },
  /**
   * **Las etiquetas del dominio, por código.** El back las manda ya escritas
   * (`type_display`, `state_display`, `status_display`…) y las manda SIEMPRE en
   * castellano: con la app en inglés, la lista de documentos decía «Permiso de
   * conducir · Vigente» y el botón salía mezclado («Ask for Permiso de conducir
   * to be fixed»). Aquí están las mismas por su **código**, que es lo estable
   * del contrato; lo que llega del back queda de reserva por si aparece uno
   * nuevo (`domainLabels.ts`).
   *
   * Los tipos de documento y de incidencia y las prioridades no se repiten:
   * viven en `vehicle.docTypes`, `newIncident.types` y `priority`, que son las
   * mismas tablas que pintan sus formularios.
   */
  domain: {
    docStatus: {
      valid: 'Vigente',
      expired: 'Caducado',
      pending_archive: 'Pendiente de archivar',
    },
    alertType: {
      itv_due: 'ITV programada',
      insurance_due: 'Seguro próximo / vencido',
      km_reading_pending: 'Lectura de km pendiente',
      km_overage: 'Exceso de km proyectado',
      no_driver: 'Vehículo sin conductor',
      maintenance_due: 'Mantenimiento programado',
    },
    /** En qué quedó cada petición. Una tabla por bandeja porque el MISMO
     * código dice cosas distintas: `done` es «Aplicada» en una ficha personal
     * y «Atendida» en una propuesta de conductor. */
    requestStatus: {
      profile: { pending: 'Pendiente', done: 'Aplicada', rejected: 'Rechazada' },
      document: {
        pending: 'Pendiente',
        deleted: 'Borrado (en erratas)',
        hidden: 'Oculto para el conductor',
        applied: 'Corrección aplicada',
        rejected: 'Rechazada',
      },
      vehicle: {
        pending: 'Pendiente de aprobación',
        approved: 'Aprobada',
        assigned: 'Vehículo asignado',
        rejected: 'Rechazada',
        closed: 'Cerrada',
      },
      driver: { pending: 'Pendiente', done: 'Atendida', rejected: 'Rechazada' },
    },
    docRequestKind: { delete: 'Borrado', change: 'Corrección' },
    /** Los campos que se piden corregir, tal como los nombra su formulario. */
    fieldNames: {
      first_name: 'Nombre',
      last_name: 'Apellidos',
      email: 'Correo',
      dni: 'DNI',
      phone: 'Teléfono',
      license_type: 'Tipo de permiso',
      fuel_card: 'Tarjeta de combustible',
      type: 'Tipo de documento',
      expiry_date: 'Fecha de caducidad',
      notes: 'Nota del documento',
    },
    alertLevel: { info: 'Informativa', warning: 'Aviso', critical: 'Crítica' },
    alertStatus: { open: 'Abierta', resolved: 'Resuelta' },
    /**
     * La frase de un aviso. El back manda el código de la plantilla y sus
     * números (`alert_messages.py`), y se escribe aquí; los marcadores
     * `{dato}` los rellena `alertMessage` del DS. Un código que no esté en
     * esta tabla cae en la frase castellana que manda el back.
     */
    alertMessage: {
      itv_overdue: 'ITV vencida hace {days} día(s) (venció el {due}).',
      itv_due: 'ITV en {days} día(s) (vence el {due}).',
      insurance_overdue: 'Seguro vencido hace {days} día(s) (venció el {due}).',
      insurance_due: 'Seguro en {days} día(s) (vence el {due}).',
      km_pending: 'Falta la lectura de km de {period}.',
      no_driver: 'Sin conductor asignado desde hace más de {days} día(s).',
      km_overage: 'Proyección {projected} km supera los {contracted} km contratados ({pct}%).',
      // El mantenimiento es el único compuesto: el marco y los tramos que
      // toquen (por km, por fecha o los dos; en castellano mandan los km).
      maintenance: '{plan}: {parts}.',
      maintenance_km_over: 'superado el objetivo de {target} km (odómetro: {current} km)',
      maintenance_km_near: 'quedan {remaining} km para el objetivo de {target} km',
      maintenance_date_overdue: 'vencido hace {days} día(s) (tocaba el {due})',
      maintenance_date_soon: 'toca en {days} día(s) (el {due})',
      maintenance_date_join: 'y, por fecha, {leg}',
      // El recordatorio que manda a mano quien supervisa; su nota la escribió
      // una persona y va tal cual, sin traducir.
      reminder_km_reading_pending: 'Recordatorio: lectura de km pendiente este mes.',
      reminder_itv_due: 'Recordatorio: ITV del vehículo.',
      reminder_maintenance_due: 'Recordatorio: mantenimiento programado.',
      reminder_due: 'Vencimiento: {due}.',
    },
    incidentStatus: { open: 'Abierta', on_going: 'En curso', closed: 'Cerrada' },
    vehicleState: {
      active: 'Activo',
      maintenance: 'No activo - Mantenimiento',
      itv: 'No activo - ITV',
      broken: 'No activo - Averiado',
      accidente: 'No activo - Accidentado',
      non_active: 'No activo sin justificación',
      retired: 'Devuelto (baja)',
    },
  },
}

const en: typeof es = {
  shell: {
    brand: 'Fleet',
    tabs: {
      home: 'Home',
      vehicles: 'Vehicles',
      registerKm: 'Log km',
      alerts: 'Alerts',
      breakdown: 'Incident',
      incident: 'Incident',
      projection: 'Km projection',
      km: 'Km',
      itv: 'MOT',
      maintenance: 'Maintenance',
      fuel: 'Fuel',
      accident: 'Accident',
    },
    mode: {
      label: 'Switch view',
      vehicle: 'My vehicle',
      fleet: 'Fleet',
      profile: 'My profile',
    },
    noVehicle: 'No vehicle assigned',
    logout: 'Log out',
    navLabel: 'Main navigation',
    offlinePending: (n) => `${n} unsent record${n === 1 ? '' : 's'} — tap to retry`,
    offlineSending: 'Sending pending…',
    offlineSent: (n) => `${n} pending record${n === 1 ? '' : 's'} sent.`,
    offlineRejected: (detail) => `Rejected by the server: ${detail}`,
    updateAvailable: 'A new version is available — tap to reload',
    dismissNotice: 'Dismiss notice',
  },
  common: {
    loading: 'Loading…',
    cancel: 'Cancel',
    logout: 'Log out',
    seeCard: 'View card',
    registerKm: 'Log km',
    required: 'Required',
    yes: 'Yes',
    no: 'No',
    search: 'Search',
    noMatches: 'Nothing matches your search.',
    truncated: (shown: number, total: number) =>
      `List truncated: showing ${shown} of ${total} records.`,
  },
  priority: {
    label: 'Priority',
    hint: 'Set how urgently it has to be dealt with.',
    critical: 'Critical',
    moderate: 'Moderate',
    functional: 'Functional',
    informative: 'Informative',
  },
  login: {
    brand: 'Fleet',
    heading: 'Sign in',
    subtitle: 'Field app — drivers and supervisors.',
    userLabel: 'Username or email',
    passwordLabel: 'Password',
    submit: 'Sign in',
    submitting: 'Signing in…',
    security: 'Secure access with your corporate account.',
    devTitle: 'Development · sign in as a test user',
    devUserLabel: 'Test user',
    devSubmit: 'Sign in without password',
    devNoRole: 'no role',
    errorLogin: 'Could not sign in.',
    sessionExpired: 'Your session has expired. Please sign in again.',
    errorDev: 'Could not sign in as test user.',
    googleSubtitle: 'Sign in with your company Google account.',
    googleSecurity: 'Google provides your identity; no password is stored here.',
    googleUnavailable: 'Google sign-in is not configured. Contact IT.',
    errorGoogle: 'Could not sign in with Google.',
    errorGoogleScript: 'Could not load the Google button. Check your connection.',
  },
  home: {
    myVehicles: 'My vehicles',
    searchPlaceholder: 'Search by plate or model…',
    searchLabel: 'Search vehicle',
    empty: 'No results.',
    km: 'Km',
    pendingReading: 'reading due',
    pendingSince: (d) => `reading due since ${d}`,
    upcomingTitle: 'Upcoming dates',
    kmDateLabel: 'Km reading',
    kmDateDay: (d) => `day ${d}`,
    nextItv: 'Next MOT',
    nextMaintenance: 'Next maintenance',
    breakdownsTitle: 'Incidents',
    noBreakdowns: 'No open incidents.',
    driver: 'Driver',
    lastReading: 'Last reading',
    noReading: 'No readings',
    projection: 'Projection',
    openIncidents: (n) => (n === 1 ? '1 open incident' : `${n} open incidents`),
    substitute: '🔁 substitute',
    blocked: 'Blocked',
    blockedNote: (reason, plate) =>
      `${reason} — substituted by ${plate}. Log mileage and documents on the substitute.`,
    substituteTag: '🔁 Substitution',
    ownTag: 'Your car',
    ownTitle: 'You drive this car',
    covering: (plate, reason) => `Covering ${plate} · ${reason}`,
    showOriginal: (plate) => `Show the substituted car ${plate}`,
    backToSubstitute: (plate) => `Back to the substitution car ${plate}`,
    statVehicles: 'Vehicles',
    statPending: 'Readings due',
    ownEmpty: 'You are not driving any vehicle right now.',
    ownEmptyCta: 'See the fleet in my care',
    quickRegister: 'Log km',
    quickUpload: 'Upload document',
    quickBreakdown: 'Incident',
    loadError: 'Could not load your vehicles.',
    deadlines: {
      title: 'Due soon',
      count: (n) => (n === 1 ? '1 notice' : `${n} notices`),
      km: (plate) => `Mileage for ${plate}`,
      itv: (plate) => `MOT for ${plate}`,
      maintenance: (plate) => `Maintenance for ${plate}`,
      fuel: (plate) => `Fuel for ${plate}`,
      inDays: (days) =>
        days <= 0 ? 'today is the last day' : days === 1 ? 'tomorrow is the last day' : `${days} days left`,
      dueIn: (days) => (days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`),
      overdue: (days) => (days === 1 ? 'expired yesterday' : `expired ${days} days ago`),
      kmUntil: (lastDay) => `until day ${lastDay}`,
      // Sin ordinal inglés a mano: con la ventana abriendo el 21, 22 o 31
      // salía «21th». El día va suelto, que es lo que dice el back.
      kmOpens: (startDay) => `best from day ${startDay} to month end`,
      kmMissing: (month) => `${month} reading still missing`,
      kmMonthEnd: (days) =>
        days <= 0
          ? 'the month ends today'
          : days === 1
            ? 'the month ends tomorrow'
            : `the month ends in ${days} days`,
      kmLast: (days) =>
        days === 0 ? 'last one today' : days === 1 ? 'last one yesterday' : `last one ${days} days ago`,
      kmNever: 'no reading yet',
      fuelStale: (days) => (days === 1 ? 'not logged since yesterday' : `not logged for ${days} days`),
      fuelNever: 'never logged',
      fuelPerTrip: 'logged on every trip',
      lastOn: (date) => `last one on ${date}`,
    },
  },
  gate: {
    checking: 'Checking your access…',
    offline: 'Offline: your fleet cannot be checked right now. Retry once you have coverage.',
    retry: 'Retry',
    adminTitle: 'No access',
    adminBody: (username) =>
      `This app is for drivers and supervisors. Your user (${username}) is an admin ` +
      'account: use the management front (internal network / VPN).',
  },
  vehicle: {
    back: 'Back',
    notFound: 'Vehicle not found.',
    blockedTitle: '🔒 Blocked by substitution',
    blockedPanel: (reason, plate) =>
      `${reason} — covered by ${plate}. Log mileage and documents on the substitute, not here.`,
    coveringTitle: '🔁 Substitution car',
    coveringPanel: (plate, reason) =>
      `You are covering ${plate} (${reason}). Everything you log goes on this car.`,
    blockedActions: 'Blocked by substitution: log it on the substitute.',
    loadError: 'Could not load the vehicle.',
    kmLabel: 'Current km',
    readingOf: (d) => `Reading from ${d}`,
    noReadings: 'No readings',
    bestKmDay: (d) => `Best day to log the km: day ${d}`,
    nextItv: 'Next MOT',
    kmPending: "This month's km reading is missing.",
    kmPendingCta: 'Log it now',
    quickUpload: 'Upload document',
    quickItv: 'Log MOT',
    scheduledActionUnavailable:
      'Available when 30 days or less remain, or when the due date has passed.',
    scheduledInfo: {
      title: { itv: 'Scheduled MOT', maintenance: 'Scheduled maintenance' },
      due: {
        itv: (fecha) => `The MOT is booked for ${fecha}.`,
        maintenance: (fecha) => `The maintenance is due on ${fecha}.`,
      },
      remaining: (dias) =>
        dias === 1 ? '1 day to go.' : dias < 0 ? 'The date has already passed.' : `${dias} days to go.`,
      opens: {
        itv: (fecha) => `You will be able to log it from ${fecha}.`,
        maintenance: (fecha) => `You will be able to mark it as done from ${fecha}.`,
      },
      why: 'It opens 30 days before the date, so something that is not due yet is not logged by mistake.',
      none: {
        itv: 'This vehicle has no MOT scheduled.',
        maintenance: 'This vehicle has no maintenance scheduled.',
      },
      noneHint: 'Fleet management schedules them. As soon as there is one, this button opens on its own.',
      ok: 'Got it',
    },
    situationTitle: 'Status',
    // El estado de un coche en inglés es «status», como las otras dos
    // etiquetas del mismo dato (`situationTitle`, `carUpdate.detailStatus`).
    state: 'Status',
    substitution: 'Substitution',
    isSubstitute: '🔁 Substitute vehicle',
    mainVehicle: 'Main vehicle',
    driver: 'Driver',
    noDriver: 'No driver assigned',
    supervisor: 'Supervisor',
    use: 'Use',
    alertsTitle: 'Alerts',
    alertsEmpty: 'No open alerts. All clear.',
    incidentsTitle: 'Incidents',
    incidentsEmpty: 'No open incidents.',
    accidentsTitle: 'Accidents',
    accidentsEmpty: 'No open accidents.',
    filterByType: 'Filter by type',
    filterAllTypes: 'All types',
    noDate: 'No date',
    documentsTitle: 'Documents',
    upload: 'Upload',
    noDocuments: 'No documents.',
    expires: (d) => ` · expires ${d}`,
    openDoc: (name) => `Open ${name}`,
    itvTitle: (plate) => `Log MOT · ${plate}`,
    itvDate: 'MOT date',
    itvDateRequired: 'Enter the MOT date.',
    itvToday: 'Today',
    itvCalc: 'Work it out',
    itvCalcNote: (periodo) =>
      `Proposed: ${periodo} from the MOT date, based on the vehicle's age. If the report says otherwise, correct it.`,
    itvEveryYears: (n) => (n === 1 ? '1 year' : `${n} years`),
    itvEveryMonths: (n) => `${n} months`,
    itvResult: 'Result',
    itvResultDone: 'Passed',
    itvResultNotDone: 'Failed',
    itvResultDoneNote: "Closes the vehicle's MOT alerts.",
    itvResultNotDoneNote: 'The appointment stays open: alerts are not closed.',
    itvNextDue: 'Next MOT',
    itvNextDueHint: 'Optional: the one on the report. Left blank, the vehicle has no next MOT until one is logged.',
    itvNextDueInvalid: 'The next MOT must be after the inspection date.',
    itvAnyDate: 'It can be logged before or after that date.',
    itvNoDate: 'This vehicle has no next MOT on record.',
    itvReport: 'MOT report',
    itvReportHint: 'Photo or PDF · optional',
    itvReportChange: 'Tap to replace it',
    itvReportQueued: 'Offline: the report will upload once you reconnect.',
    itvReportFailed: "The report could not be uploaded: add it from the vehicle's Documents.",
    itvSubmit: 'Log MOT',
    itvSubmitting: 'Logging…',
    itvOk: 'MOT logged. Related alerts are closed and the next date is updated.',
    itvOffline: 'You are offline: the MOT will be logged automatically once you reconnect.',
    itvError: 'Could not log the MOT.',
    docType: 'Document type',
    docTypes: {
      registration_certificate: 'Registration certificate',
      technical_datasheet: 'Technical datasheet',
      insurance: 'Insurance',
      contract: 'Contract',
      delivery_report: 'Delivery report',
      return_report: 'Return report',
      accident_report: 'Accident report',
      damage_photos: 'Damage photos',
      itv_report: 'MOT report',
      workshop_invoice: 'Workshop invoice',
      driving_license: 'Driving licence',
      other: 'Other',
    },
    filePick: 'Photo or PDF (camera / gallery)',
    expiry: 'Expiry (optional)',
    linkIncident: 'Linked to open incident (optional)',
    linkNone: 'None',
    linkAccident: 'Open accident',
    linkChoose: 'Choose the accident…',
    linkAccidentRequired: 'Choose the accident this report belongs to.',
    noOpenAccident:
      'An accident report is linked to an open accident and this vehicle has none: report the accident first.',
    linkIncidentOpen: 'Open incident',
    linkChooseIncident: 'Choose the incident…',
    linkIncidentRequired: 'Choose the incident these photos belong to.',
    noOpenIncident:
      'Damage photos are linked to an open incident and this vehicle has none: report the incident first.',
    notes: 'Notes (optional)',
    chooseFile: 'Choose a photo or a PDF.',
    uploadSubmitting: 'Uploading…',
    uploadOkPending:
      'Document uploaded. Pending archiving in Drive; meanwhile it opens from here.',
    uploadOkArchived: 'Document uploaded and archived in Drive.',
    uploadOffline: 'You are offline: the document will upload automatically once you reconnect.',
    uploadError: 'Could not upload the document.',
  },
  km: {
    title: 'Log kilometres',
    vehicle: 'Vehicle',
    choose: 'Choose a vehicle…',
    lastReading: 'Last reading:',
    estimatedTag: 'estimated',
    estimatedNote:
      'The last reading is an automatic estimate, not an odometer value: log the real ' +
      'reading when you can.',
    missingMonth: " — this month's is missing.",
    firstReading: 'No readings yet: this will be the first one.',
    odometer: 'Odometer (total km on the dashboard)',
    date: 'Reading date',
    historyTitle: 'Reading history',
    save: 'Save reading',
    saving: 'Saving…',
    noGoBack: (last) => `The odometer cannot go backwards: the last reading was ${last}.`,
    savedTitle: 'Reading saved',
    queuedTitle: 'Reading queued',
    queuedNote: 'You are offline: the reading will be sent automatically once you reconnect.',
    drivenPrefix: 'You have driven ',
    drivenSuffix: ' since the last reading.',
    another: 'Log another reading',
    backHome: 'Back to my vehicles',
    throttled: 'Too many readings in a row. Wait a moment and retry.',
    windowClosed: (start) => `Mileage entry opens from day ${start} to the last day of the month.`,
    queueFailed:
      'Offline and unable to store on this device (private mode or full storage?). The reading was NOT saved: retry when back online.',
    saveError: 'Could not save the reading.',
  },
  alerts: {
    title: 'Alerts',
    showClosed: 'Show closed',
    onlyOpen: 'Open only',
    fleet: 'fleet',
    groupFleet: 'Fleet',
    groupCount: (n) => (n === 1 ? '1 alert' : `${n} alerts`),
    tabAll: 'All',
    typeFilter: 'Filter by alert type',
    classifyLabel: 'Classify alerts by type',
    resolved: (plate) => `Alert for ${plate} resolved.`,
    loadError: 'Could not load the alerts.',
    closeError: 'Could not close the alert.',
    pushTitle: 'Notifications on this device',
    pushOn: 'You will receive alerts even with the app closed.',
    pushBlocked: 'Blocked by the browser: enable them in its settings.',
    pushNotConfigured: 'Notifications are not set up on the server. Contact IT.',
    pushUnknown: 'Could not check the status (offline?).',
    pushRetry: 'Retry',
    pushOff: 'MOT, pending readings and more, even with the app closed.',
    pushEnable: 'Enable',
    pushDisable: 'Disable',
    pushError: 'Could not change the notification state.',
    empty: 'No open alerts. All clear.',
    due: (d) => `Due: ${d}`,
    created: (d) => `Created on ${d}`,
    resolve: 'Resolve',
    resolveTitle: (plate) => `Resolve alert · ${plate}`,
    resolveSubmit: 'Resolve alert',
    resolveNoteLabel: 'Notes (optional, kept on the resolved alert)',
    propose: {
      title: 'Should someone else drive it?',
      intro:
        'If the vehicle is heading past its contracted km, propose whoever drives less. ' +
        'Nothing changes now: administration decides on the proposal.',
      whoLabel: 'Who you propose (from your fleet)',
      whoNone: 'Nobody on the list — I explain below',
      noteLabel: 'Note (kept on the proposal and on the alert)',
      noteRequiredLabel: 'Note for administration (say who and why)',
      submit: 'Send proposal',
      sending: 'Sending…',
      sent: 'Proposal sent. Administration decides on it in their requests.',
      error: 'Could not send the proposal.',
    },
    resolveKmTitle: (plate) => `Register km · ${plate}`,
    resolveKmIntro: "Registering this month's reading resolves the alert.",
    resolveKmLabel: 'Odometer reading',
    resolveKmLast: (v, d) => `Last known: ${v} (${d})`,
    resolveKmSubmit: 'Register and resolve',
    resolveKmNote: (v) => `Reading registered: ${v}`,
    closedTitle: 'Resolved',
  },
  group: {
    title: 'Km projection',
    loadError: 'Could not load the group.',
    levels: { within: 'On track', watch: 'Watch', over: 'Overage risk' },
    levelNone: 'No projection',
    statVehicles: 'Vehicles',
    statWatch: 'To watch',
    statOver: 'At risk',
    tabsLabel: 'Filter by level',
    tabAll: 'All',
    noDriver: 'no driver',
    progressLabel: (pct) => `Kilometres used over contracted: ${pct}%`,
    consumedOf: (driven, contracted) => `${driven} of ${contracted} contracted`,
    elapsed: (pct) => `Contract at ${pct}%`,
    elapsedMarker: (pct) => `Contract time elapsed: ${pct}%`,
    monthlyAvg: 'Monthly average',
    paceContracted: (rate) => `contracted ${rate}/mo`,
    projectedEnd: 'Projection at end',
    remaining: 'Remaining',
    overage: 'Estimated overage',
    noContract: 'No km contract: no projection.',
    unlimited: 'Unlimited km',
    unlimitedNote: 'Unlimited km: this vehicle has no projection or mileage cap.',
    showChart: 'Show trend',
    hideChart: 'Hide trend',
    incidents: 'Incidents',
    newIncident: 'New',
  },
  reminder: {
    button: 'Send reminder',
    title: (plate) => `Reminder · ${plate}`,
    recipient: (name) => `Driver: ${name}`,
    noDriver: 'No driver assigned: the email cannot be delivered.',
    kindLabel: 'Reason',
    kinds: {
      km_reading_pending: 'Km reading not logged',
      itv_due: 'MOT',
      maintenance_due: 'Maintenance',
    },
    channelEmail: 'Send email',
    channelAlert: 'Create in-app alert',
    message: 'Additional message (optional)',
    submit: 'Send',
    alertCreated: 'In-app alert created.',
    alertExisted: "Today's alert was already open.",
    emailSent: 'Email sent.',
    emailSkipped: (reason) => `Email not sent: ${reason}.`,
    skipReasons: {
      sin_email: 'the driver has no email',
      correo_deshabilitado: 'outgoing email is disabled',
      fallo_envio: 'sending failed',
    },
    error: 'Could not send the reminder.',
    close: 'Close',
  },
  breakdown: {
    title: (plate) => `Report an incident · ${plate}`,
    stepTires: 'Tyres',
    stepAvailability: 'Availability',
    stepDocs: 'Documents',
    stepManage: 'Management',
    docsHint:
      'Attach whatever helps explain it: photos of the damage, the workshop ' +
      'quote… You can add several, and none is required.',
    docsRequired:
      'To request a replacement car you must attach at least one document ' +
      '(photo of the damage, workshop report…). You can add several.',
    substituteDocsTitle: 'Replacement car paperwork',
    substituteDocsHint:
      'If you have already been given one, upload its paperwork here: ' +
      'registration certificate, technical sheet, insurance… You can upload ' +
      'several and it is optional (you usually do not have it yet).',
    substituteAttach: 'Attach the replacement car paperwork',
    availabilityLabel: 'How is the car left?',
    availabilityHint:
      "This does not change the vehicle's state: management records it and " +
      'decides.',
    availability: {
      active: 'Still in service',
      stopped: 'Cannot be used',
      substitute: 'I need a replacement car',
    },
    availabilityNotes: {
      active: 'I can keep driving it while it is handled.',
      stopped: 'The car stays off the road, but no other one is needed.',
      substitute:
        'A car request is opened for administration, who decide whether to ' +
        'provide one. You must attach a document.',
    },
    removeFile: (name) => `Remove ${name}`,
    vehicle: 'Vehicle',
    date: 'Date',
    description: 'Description',
    attach: 'Attach a photo (optional)',
    next: 'Continue',
    back: 'Back',
    workshop: 'Workshop',
    workshopHint: 'Enter the postal code of the preferred location for finding the nearest workshop.',
    preferredPostalCode: 'Preferred location postal code',
    cost: 'Cost (€)',
    submit: 'Report incident',
    saved: 'Incident reported.',
    savedRequest:
      'Incident reported. Your replacement car request is pending with ' +
      'administration.',
    savedUploadFailed: 'Incident reported; an attachment could not be uploaded.',
    savedUploadQueued:
      'Incident reported; offline — the attachment was saved and will upload once back online.',
    queued:
      'Offline: the incident was saved on this device and will be reported once back online.',
    error: 'Could not report the incident.',
    close: 'Close',
  },
  incidentModal: {
    title: (plate) => `Incident · ${plate}`,
    kind: 'Type',
    kinds: {
      maintenance: 'One-off maintenance',
      tires: 'Tyre change',
      breakdown: 'Breakdown',
      general: 'General request',
    },
    info: {
      maintenance:
        'One-off maintenance: broken things or needed changes that do not ' +
        'prevent driving; handled without urgency. Scheduled maintenance goes ' +
        'through its plan, not here.',
      tires:
        'Tyre change due to wear or a puncture. The workshop and appointment ' +
        'are set later, while managing it.',
      breakdown:
        'The vehicle has failed: it is not roadworthy or cannot be used ' +
        'normally.',
      general:
        'General request: things that may not be related to the vehicle ' +
        '(paperwork, cards, questions…).',
    },
    date: 'Date',
    description: 'Description',
    attach: 'Attach a document or photo (optional)',
    tireRequiredBase: 'Required to continue: mileage and reason.',
    tireRequiredWear: 'For wear: which tyres and the sizes for the selected axles.',
    tireRequiredPuncture: 'For a puncture: which tyre and its size.',
    submit: 'Report incident',
    saved: 'Incident reported.',
    savedUploadFailed: 'Incident reported; the attachment could not be uploaded.',
    error: 'Could not report the incident.',
    close: 'Close',
  },
  carUpdate: {
    button: 'Update data',
    maintenanceButton: 'Update maintenance',
    title: (plate) => `Update · ${plate}`,
    notice:
      'Logging km, maintenance and incidents is the responsibility of the driver, ' +
      'not the supervisor. Use this only on their behalf when needed: it will be ' +
      'recorded under your name.',
    noticeHide: 'Hide this notice for this session',
    noticeShow: 'Show the responsibility notice',
    tabsLabel: 'What to update',
    tabs: {
      km: 'Km',
      fuel: 'Fuel',
      itv: 'MOT',
      maintenance: 'Maintenance',
      incidents: 'Incidents',
    },
    kmLabel: 'Odometer reading',
    kmCurrent: (v) => `Last known: ${v}`,
    kmLast: (value, date) => `Last reading: ${value} · ${date}`,
    kmDateUnknown: 'date unknown',
    kmNever: 'There is no previous reading.',
    kmSubmit: 'Log reading',
    kmSaved: (v) => `Reading logged: ${v}.`,
    planEvery: (txt) => `every ${txt}`,
    planLast: (txt) => `last: ${txt}`,
    planNever: 'never logged',
    planDone: 'Mark as done',
    planNext: (date) => `Next: ${date}`,
    planDateTitle: (name) => `When was it done? · ${name}`,
    planDateLabel: 'Completion date',
    planToday: 'Today',
    planDateAccept: 'Mark as done',
    planChosen: (date) => `Maintenance completed on ${date}.`,
    planMore: 'See details',
    planLess: 'Hide details',
    planFrequency: 'Frequency',
    planLastDate: 'Last completed',
    planLastKm: 'Mileage when last completed',
    planSaved: (name) => `“${name}” re-anchored to today.`,
    planAlerts: (n) => (n === 1 ? '1 alert resolved.' : `${n} alerts resolved.`),
    plansEmpty: 'This vehicle has no maintenance plans (administration creates them).',
    plansOnly:
      "The car's scheduled maintenance. Incidents are reported and resolved in " +
      "their own “Incidents” card.",
    months: (n) => (n === 1 ? '1 month' : `${n} months`),
    actionView: 'View',
    actionManage: 'Handling',
    actionResolve: 'Resolve',
    actions: { view: 'Details', manage: 'Handling', resolve: 'Resolution' },
    detailStatus: 'Status',
    detailDate: 'Date',
    detailDescription: 'Description',
    detailMileage: 'Mileage',
    detailPostalCode: 'Preferred location postal code',
    noDate: 'No date',
    workshop: 'Workshop',
    preferredPostalCode: 'Preferred location postal code',
    cost: 'Cost (€)',
    manageSubmit: 'Save handling',
    managed: 'Handling saved: the incident is now in progress.',
    observations: 'Notes',
    downtime: 'Days out of service',
    resolutionDate: 'Resolution date',
    calculatedDowntime: (n) => `Calculated downtime: ${n === 1 ? '1 day' : `${n} days`}`,
    resolveSubmit: 'Close incident',
    resolvedNote: 'Incident closed.',
    incidentsEmpty: 'No open incidents.',
    loadError: 'Could not load.',
    error: 'Could not save.',
    close: 'Close',
  },
  uploadDoc: {
    title: 'Upload document',
    stepFile: 'Type and file',
    stepLink: 'Linked to',
    stepNotes: 'Notes',
    linkHint:
      "Which of the vehicle's incidents this document belongs to. The "
      + 'workshop invoice, damage photos and accident report require one; '
      + 'the rest carry it when it makes sense.',
    linkNothing: 'This document is not linked to any incident: move on to the next step.',
    notesHint:
      'Anything that helps you recognise it later in the document list. '
      + 'Optional.',
    back: 'Back',
    vehicle: 'Vehicle',
    choose: 'Choose a vehicle…',
    submit: 'Upload',
    savedTitle: 'Document uploaded',
    another: 'Upload another',
    backHome: 'Back to home',
  },
  newIncident: {
    title: 'New incident',
    titleBreakdown: 'Report an incident',
    back: 'Back',
    vehicle: 'Vehicle',
    choose: 'Choose a vehicle…',
    type: 'Type',
    types: {
      general: 'General request',
      breakdown: 'Breakdown',
      accident: 'Accident',
      maintenance: 'One-off maintenance',
      tires: 'Tyre change',
      inspection: 'Inspection',
    },
    date: 'Date',
    description: 'Description',
    descPlaceholder: 'What happened, where, vehicle condition…',
    tiresData: 'Replacement details',
    accidentData: 'Accident details',
    stepWhere: 'Where and when',
    stepDamage: 'Damage',
    stepPeople: 'People involved',
    stepReport: 'Police report and file',
    peopleHint:
      'Other vehicles and anyone injured, if any. Optional: an accident '
      + 'with nobody else involved is reported too.',
    reportHint:
      'The police report reference and the paper report, if you have them. '
      + 'Also optional: you can add them later from the vehicle card.',
    mileage: 'Current mileage',
    mileageFromReading: (value) => `Last known reading: ${value}`,
    mileageFromReadingEstimated: (value) =>
      `Last known reading: ${value} (estimated — check the odometer)`,
    workshopPostalCodeOptional: 'Workshop postal code (optional)',
    changeReason: 'Reason for replacement',
    wear: 'Wear',
    puncture: 'Puncture',
    whichWheels: 'Which tyres?',
    whichWheel: 'Which tyre?',
    front: 'Front',
    rear: 'Rear',
    allWheels: 'All 4 tyres',
    frontLeft: 'Front left',
    frontRight: 'Front right',
    rearLeft: 'Rear left',
    rearRight: 'Rear right',
    frontMeasure: 'Front tyre size',
    rearMeasure: 'Rear tyre size',
    tireMeasure: 'Tyre size',
    comment: 'Comment',
    street: 'Street',
    streetNumber: 'Number',
    postalCode: 'Postal code',
    locality: 'Town / city',
    province: 'Province',
    accidentAt: 'Date and time',
    phone: 'Phone',
    damageDescription: 'Damage description',
    thirdParties: 'Third parties involved',
    injuredPeople: 'Injured people',
    add: 'Add',
    thirdPartyTitle: 'Third party involved',
    injuredTitle: 'Injured person',
    save: 'Save',
    edit: (quien: string) => `Edit ${quien}`,
    noThirdParties: 'No third parties involved.',
    noInjured: 'No injured people.',
    unnamed: 'Unnamed',
    thirdPartyRequired: 'A third party needs a name and a plate.',
    injuredRequired: 'An injured person needs a name.',
    removeThirdParty: (quien: string) => `Remove ${quien}`,
    removeInjured: (quien: string) => `Remove ${quien}`,
    plate: 'Registration',
    brand: 'Make',
    model: 'Model',
    fullName: 'Full name',
    insurer: 'Insurer',
    policyNumber: 'Policy number',
    email: 'Email',
    seat: 'Seat occupied',
    driver: 'Driver',
    passenger: 'Passenger',
    policeReportReference: 'Police report reference (optional)',
    accidentReport: 'Accident report file (optional)',
    attachments: 'Photos or documents (camera, gallery or file; optional)',
    attachmentsSelected: (n) => `${n} file${n === 1 ? '' : 's'} selected`,
    submit: 'Create incident',
    submitting: 'Creating…',
    createError: 'Could not create the incident.',
    uploadFailed: (names) =>
      `Incident created, but these could not be uploaded: ${names}. You can add them from ` +
      "the vehicle's card.",
    queuedTitle: 'Saved offline',
    queuedNote:
      'The incident was saved on this device (with its attachments) and will be reported ' +
      'automatically once back online.',
  },
  accidentModal: {
    button: 'Accident',
    title: (plate) => `Accident report · ${plate}`,
    submit: 'Report accident',
    saved: 'Accident reported successfully.',
    savedUploadFailed: (name) =>
      `The accident was reported, but the file ${name} could not be uploaded.`,
    savedUploadQueued: (name) =>
      `Accident reported; offline — the file ${name} will upload once back online.`,
    queued:
      'Offline: the accident report was saved on this device (with its file) and will be sent ' +
      'once back online.',
    close: 'Close',
  },
  myDocs: {
    title: 'My documents',
    hint:
      'Personal documents, such as the driving licence. Your supervisor and fleet ' +
      'management can also see them.',
    empty: 'No personal documents.',
    upload: 'Upload personal document',
    type: 'Type',
    types: {
      driving_license: 'Driving licence',
      other: 'Other',
    },
    expiry: 'Expiry (optional)',
    submit: 'Upload',
    submitting: 'Uploading…',
    uploadOk: 'Document uploaded.',
    uploadOffline: 'Offline: the document was saved and will upload once back online.',
    uploadError: 'The document could not be uploaded.',
    loadError: 'Your documents could not be loaded.',
  },
  docs: {
    title: 'Documentation',
    tabs: {
      vehicle: 'Vehicle documents',
      driver: 'Driver documents',
    },
    vehicleHint:
      'Vehicle paperwork: registration, technical datasheet, insurance… It stays ' +
      'with the car when you return it.',
    viewDoc: (name) => `View ${name}`,
    viewTitle: (name) => `View · ${name}`,
    viewLoading: 'Opening the document…',
    viewError: 'The document could not be opened. Try again.',
    viewNote: 'Fetched just to look at it: when you close this window, the copy is gone.',
    viewNewTab: 'Open it full screen',
    download: 'Download',
    downloadDoc: (name) => `Download ${name}`,
    downloadError: 'The document could not be downloaded. Try again.',
    askDeleteDoc: (name) => `Request deletion of ${name}`,
    deleteTitle: (name) => `Request deletion · ${name}`,
    deleteHint:
      'This does not delete it: the request goes to fleet management, who decide. ' +
      'Until then the document stays in the list, with its deletion-pending chip.',
    deleteReason: 'Reason (optional)',
    deleteSubmit: 'Request deletion',
    deleteSubmitting: 'Sending…',
    deleteOk: 'Request sent. Fleet management will decide what to do with it.',
    deleteError: 'The deletion request could not be sent. Try again.',
    deletePending: 'Deletion pending administrator approval',
    deletePendingNote: 'There is already a request on this document: fleet management is reviewing it.',
    fixDoc: (what: string) => `Ask for ${what} to be fixed`,
    fixTitle: (what: string) => `Fix ${what}`,
    fixHint:
      'This does not change the document: it sends a request to fleet management, who apply or reject it. The file stays where it is.',
    fixType: 'Document type',
    fixExpiry: 'Expiry date',
    fixNotes: 'Document note',
    fixReason: 'Why it needs fixing',
    fixSubmit: 'Send request',
    fixSubmitting: 'Sending…',
    fixOk: 'Request sent. Fleet management will decide whether to apply it.',
    fixError: 'The correction request could not be sent. Try again.',
  },
  profile: {
    title: 'My profile',
    dataTitle: 'My details',
    dataHint:
      'Read-only here: correcting them is fleet management’s call, and you ask for it from here.',
    email: 'Email',
    phone: 'Phone',
    dni: 'ID number',
    licenseType: 'Licence type',
    fuelCard: 'Fuel card',
    empty: 'Not set',
    roleNames: {
      admin: 'Management',
      supervisor: 'Supervisor',
      driver: 'Driver',
    },
    edit: {
      button: 'My details',
      title: 'My details and my documents',
      introTitle: 'This ASKS, it does not save',
      intro:
        'None of this changes your record right away: it sends a request to fleet management, who apply or reject it.',
      stepData: 'Your details',
      stepDocs: 'Documents',
      stepSend: 'Send',
      dataTitle: 'Your details',
      dataHint: 'Only fix what is wrong: just what you touch is sent.',
      firstName: 'First name',
      lastName: 'Surname',
      emailHint: 'It is the account you sign in with: changing it is reviewed by management.',
      dniHint: 'They check it against your document before applying it.',
      note: 'Note for management',
      noteHint: 'Tell them why it needs fixing: that is what they read to decide.',
      licenseNone: 'Not set',
      licenseTypes: {
        B: 'B (cars)',
        C1: 'C1',
        C: 'C (lorries)',
        'C+E': 'C+E (lorry with trailer)',
        D1: 'D1',
        D: 'D (buses)',
      },
      submit: 'Send request',
      submitting: 'Sending…',
      nothing: 'Change something or write a note.',
      error: 'The request could not be sent. Try again.',
      ok: 'Request sent. Fleet management will review it.',
      savedTitle: 'Request sent',
      backToDocs: 'Back to my documents',
      reviewTitle: 'What you are asking for',
      reviewEmpty: 'You have not changed anything. If you just want to flag something, write it here.',
      submitHint: 'This sends your details only: each document goes on its own.',
      docsTitle: 'Change the documents you uploaded',
      docsHint: 'Each document is fixed or asked to be deleted on its own, from its row.',
      pending: 'You have a record request awaiting a decision.',
      pendingSince: (when: string) => `Asked on ${when}.`,
      pendingNote: 'Meanwhile, your record stays as it is.',
    },
    requests: {
      title: 'Requests',
      tabsLabel: 'Pending or decided requests',
      tabPending: 'Pending',
      tabDone: 'Decided',
      emptyPending: 'Nothing of yours is awaiting a decision.',
      emptyDone: 'None of yours has been decided yet.',
      loadError: 'Your requests could not be loaded.',
      kindProfile: 'My record',
      kindDocument: 'Document',
      kindVehicle: 'Vehicle',
      kindDriver: 'Driver change',
      asked: (when: string) => `Asked on ${when}`,
      noDetail: 'No detail',
    },
  },
  fuel: {
    title: 'Average consumption',
    noteLead:
      'Please note the average consumption shown by the on-board computer for your last trip or refuelling cycle.',
    noteWarn: 'Do NOT note the "historical" or total accumulated consumption of the vehicle.',
    consumption: 'Actual average consumption at that moment (l/km or kWh/km)',
    consumptionPlaceholder: '6.80',
    date: 'Date',
    save: 'Save consumption',
    saved: 'Consumption noted.',
    saving: 'Saving…',
    saveError: 'The consumption could not be saved.',
    lastNoted: 'Last entry',
    noneYet: 'No consumption entries yet.',
  },
  domain: {
    docStatus: {
      valid: 'Valid',
      expired: 'Expired',
      pending_archive: 'Pending archiving',
    },
    alertType: {
      itv_due: 'Scheduled MOT',
      insurance_due: 'Insurance due / expired',
      km_reading_pending: 'Km reading due',
      km_overage: 'Projected km overage',
      no_driver: 'Vehicle without a driver',
      maintenance_due: 'Scheduled maintenance',
    },
    requestStatus: {
      profile: { pending: 'Pending', done: 'Applied', rejected: 'Rejected' },
      document: {
        pending: 'Pending',
        deleted: 'Deleted (in corrections)',
        hidden: 'Hidden from the driver',
        applied: 'Correction applied',
        rejected: 'Rejected',
      },
      vehicle: {
        pending: 'Pending approval',
        approved: 'Approved',
        assigned: 'Vehicle assigned',
        rejected: 'Rejected',
        closed: 'Closed',
      },
      driver: { pending: 'Pending', done: 'Handled', rejected: 'Rejected' },
    },
    docRequestKind: { delete: 'Deletion', change: 'Correction' },
    fieldNames: {
      first_name: 'First name',
      last_name: 'Surname',
      email: 'Email',
      dni: 'ID number',
      phone: 'Phone',
      license_type: 'Licence type',
      fuel_card: 'Fuel card',
      type: 'Document type',
      expiry_date: 'Expiry date',
      notes: 'Document note',
    },
    alertLevel: { info: 'Informative', warning: 'Warning', critical: 'Critical' },
    alertStatus: { open: 'Open', resolved: 'Resolved' },
    alertMessage: {
      itv_overdue: 'MOT overdue by {days} day(s) (it expired on {due}).',
      itv_due: 'MOT in {days} day(s) (expires on {due}).',
      insurance_overdue: 'Insurance overdue by {days} day(s) (it expired on {due}).',
      insurance_due: 'Insurance in {days} day(s) (expires on {due}).',
      km_pending: 'The km reading for {period} is missing.',
      no_driver: 'No driver assigned for more than {days} day(s).',
      km_overage: 'Projected {projected} km exceeds the {contracted} km contracted ({pct}%).',
      maintenance: '{plan}: {parts}.',
      maintenance_km_over: 'target of {target} km passed (odometer: {current} km)',
      maintenance_km_near: '{remaining} km left to the {target} km target',
      maintenance_date_overdue: 'overdue by {days} day(s) (it was due on {due})',
      maintenance_date_soon: 'due in {days} day(s) (on {due})',
      maintenance_date_join: 'and, by date, {leg}',
      reminder_km_reading_pending: 'Reminder: km reading due this month.',
      reminder_itv_due: 'Reminder: vehicle MOT.',
      reminder_maintenance_due: 'Reminder: scheduled maintenance.',
      reminder_due: 'Due date: {due}.',
    },
    incidentStatus: { open: 'Open', on_going: 'In progress', closed: 'Closed' },
    vehicleState: {
      active: 'Active',
      maintenance: 'Off the road - Maintenance',
      itv: 'Off the road - MOT',
      broken: 'Off the road - Broken down',
      accidente: 'Off the road - Crashed',
      non_active: 'Off the road, no reason given',
      retired: 'Returned (written off)',
    },
  },
}

export const { LanguageProvider, useLang } = createI18n({ es, en })
