import { useAppLang } from '@flota/ui/i18n'

const es = {
  title: 'Alertas',
  subtitle: 'Avisos de ITV, lecturas de km, exceso proyectado y vehículos sin conductor.',
  loading: 'Cargando…',
  loadError: 'No se pudieron cargar las alertas.',
  closeError: 'No se pudo cerrar la alerta.',
  exportCsv: 'Exportar CSV',
  registerItv: 'Registrar ITV',
  resolve: 'Resolver',
  sendEmail: 'Mandar correo',
  // Las dos bandejas se recorren juntas: de una se salta a la otra.
  goIncidents: 'Ver incidencias',
  documents: 'Documentos',
  documentsTitle: 'Los documentos (acta/parte/fotos) se ligan desde la ficha',
  records: 'Registros',
  searchLabel: 'Buscar',
  searchPlaceholder: 'Matrícula, tipo, persona o mensaje…',
  viewMessage: 'Ver mensaje',
  emptyState: 'Sin alertas con estos filtros. 🎉',
  closedNotice: (subject: string) => `Alerta de ${subject} resuelta.`,
  emailModalTitle: (plate: string) => `Correo · ${plate}`,
  filters: {
    type: 'Tipo',
    status: 'Estado',
    due: 'Plazo',
    driver: 'Conductor',
    supervisor: 'Supervisor',
  },
  // Un corte por plazo POR CADA color del semáforo de la fecha límite, más las
  // que no vencen (que no se pintan de ningún color y, si no, no hay forma de
  // llegar a ellas).
  dueOptions: {
    all: 'Todos los plazos',
    overdue: 'Vencidas',
    soon: 'Próximas (30 días o menos)',
    far: 'Lejanas (más de 30 días)',
    none: 'Sin fecha límite',
  },
  personAll: 'Todos',
  driverNone: 'Sin conductor',
  supervisorNone: 'Sin supervisor',
  // Orden y agrupado por la fecha límite (los dos, en la fila de abajo).
  sortDueAsc: 'Antes la más próxima',
  sortDueDesc: 'Antes la más lejana',
  sortDueTitle: 'Ordenar por fecha límite',
  groupByDue: 'Agrupar por mes de vencimiento',
  groupByType: 'Agrupar por tipo',
  // Nombres alineados con el back: la ITV/el mantenimiento «programados» son
  // alertas; el puntual es una incidencia.
  typeOptions: {
    all: 'Todos los tipos',
    itvDue: 'ITV programada',
    kmReadingPending: 'Lectura de km pendiente',
    kmOverage: 'Exceso de km proyectado',
    maintenanceDue: 'Mantenimiento programado',
    noDriver: 'Sin conductor',
  },
  // Dos: o está pendiente o está resuelta (no hay «Todas»: mezclar las dos
  // obligaba a mirar dos veces cada fila para saber cuál de las dos era).
  statusOptions: {
    open: 'Abiertas',
    resolved: 'Resueltas',
  },
  // Sin «Nivel»: la urgencia de una alerta la marca su fecha límite (y el plazo
  // que sale bajo ella), no una prioridad elegida — eso es de las incidencias.
  columns: {
    type: 'Tipo',
    vehicle: 'Vehículo',
    driver: 'Conductor',
    supervisor: 'Supervisor',
    message: 'Mensaje',
    dueDate: 'Fecha límite',
    resolvedAt: 'Resuelta el',
    resolvedBy: 'Resuelta por',
    resolutionNote: 'Nota de cierre',
    actions: 'Acciones',
  },
  /** Plazo en lenguaje natural bajo la fecha límite: más claro que deducir los
   * días a mano. Se calcula en vivo desde la fecha de vencimiento. */
  deadline: {
    overdue: (n: number) => `Vencido hace ${n} día${n === 1 ? '' : 's'}`,
    today: 'Vence hoy',
    tomorrow: 'Vence mañana',
    inDays: (n: number) => `Vence en ${n} días`,
  },
  /** Modal de resolver: resumen del aviso + la actuación propia de cada tipo
   * (lectura de km, cambio o asignación de conductor) + nota opcional de qué
   * se hizo. ITV, mantenimiento y seguro tienen su formulario propio en
   * `components/resolve/`. */
  resolveModal: {
    title: (subject: string) => `Resolver alerta · ${subject}`,
    intro:
      'La alerta se marcará como resuelta a tu nombre. Si se cerró con alguna actuación, déjala anotada: quedará visible en el histórico de resueltas.',
    noteLabel: 'Nota de resolución (opcional)',
    notePlaceholder: 'P. ej. taller avisado, revisión hecha, cita pedida…',
    dueDate: 'Fecha límite',
    driver: 'Conductor',
    cancel: 'Cancelar',
    confirm: 'Resolver alerta',
    saving: 'Resolviendo…',
    loadError: 'No se pudo cargar la información del aviso.',
    km: {
      hint: 'Registra la lectura pendiente: el aviso del periodo se cierra con ella.',
      dateLabel: 'Fecha de la lectura',
      kmLabel: 'Lectura de km',
      kmRequired: 'Indica la lectura de km.',
      confirm: 'Registrar lectura y resolver',
    },
    overage: {
      hint:
        'Puedes pasar el coche a alguien que ruede menos: elige un conductor con una media mensual menor.',
      loading: 'Buscando candidatos…',
      currentPace: (pace: string) => `Media mensual del coche: ${pace}`,
      candidateLabel: 'Nuevo conductor',
      noChange: '— Sin cambio de conductor —',
      noCar: 'sin coche',
      noData: 'sin datos',
      perMonth: (km: string) => `${km}/mes`,
      autoNote: (from: string, to: string) => `Cambio de conductor: ${from} → ${to}.`,
      confirmChange: 'Cambiar conductor y resolver',
    },
  },
  resolver: {
    /** Cerró quien tenía el coche: se pinta en verde. */
    driverMatch: 'Cerrada por el conductor del vehículo.',
    supervisorMatch: 'Cerrada por el supervisor del vehículo.',
    /** Y cuando no lo era: bocadillo del icono de aviso. */
    mismatchTitle: 'Cerrada por alguien ajeno al vehículo',
    mismatch: (driver: string, supervisor: string) =>
      `No es el conductor (${driver}) ni el supervisor (${supervisor}) de este vehículo. ` +
      'Comprueba que quien la cerró sabía lo que pasaba con el coche.',
    mismatchNoPeople:
      'El vehículo no tiene conductor ni supervisor asignado, así que nadie del coche pudo cerrarla.',
    /** Sin actor: la cerró el propio sistema, no una persona. */
    automatic: 'Cierre automático',
    automaticTip:
      'La cerró el sistema al registrarse la ITV, la póliza de seguro o la lectura de km del periodo.',
    unknown: 'Sin registrar',
  },
  itvModal: {
    title: 'Registrar ITV',
    vehicle: 'Vehículo',
    choose: '— Elegir —',
    chooseVehicleError: 'Elige el vehículo.',
    result: 'Resultado',
    resultPass: 'Favorable',
    resultFail: 'Desfavorable',
    inspectionDate: 'Fecha de la inspección',
    nextDue: 'Próxima ITV',
    cost: 'Coste (€, opcional)',
    notes: 'Notas',
    note1: 'Al registrarla, los avisos de ITV del vehículo se ',
    noteStrong: 'cierran solos',
    note2: ' y la próxima fecha queda actualizada en la ficha.',
    saveError: 'No se pudo registrar la ITV.',
    savedNotice:
      'ITV registrada: los avisos asociados se cierran automáticamente y la próxima fecha queda actualizada.',
    cancel: 'Cancelar',
    saving: 'Guardando…',
    save: 'Registrar',
  },
}

const en: typeof es = {
  title: 'Alerts',
  subtitle: 'MOT notices, km readings, projected overage and vehicles without a driver.',
  loading: 'Loading…',
  loadError: 'Could not load alerts.',
  closeError: 'Could not close the alert.',
  exportCsv: 'Export CSV',
  registerItv: 'Register MOT',
  resolve: 'Resolve',
  sendEmail: 'Send email',
  goIncidents: 'View incidents',
  documents: 'Documents',
  documentsTitle: 'Documents (report/claim/photos) are attached from the vehicle page',
  records: 'Records',
  searchLabel: 'Search',
  searchPlaceholder: 'Plate, type, person or message…',
  viewMessage: 'View message',
  emptyState: 'No alerts with these filters. 🎉',
  closedNotice: (subject) => `Alert for ${subject} resolved.`,
  emailModalTitle: (plate) => `Email · ${plate}`,
  filters: {
    type: 'Type',
    status: 'Status',
    due: 'Deadline',
    driver: 'Driver',
    supervisor: 'Supervisor',
  },
  dueOptions: {
    all: 'Any deadline',
    overdue: 'Overdue',
    soon: 'Due soon (30 days or less)',
    far: 'Later (more than 30 days)',
    none: 'No deadline',
  },
  personAll: 'All',
  driverNone: 'No driver',
  supervisorNone: 'No supervisor',
  sortDueAsc: 'Soonest first',
  sortDueDesc: 'Latest first',
  sortDueTitle: 'Sort by deadline',
  groupByDue: 'Group by due month',
  groupByType: 'Group by type',
  typeOptions: {
    all: 'All types',
    itvDue: 'Scheduled MOT',
    kmReadingPending: 'Km reading pending',
    kmOverage: 'Projected km overage',
    maintenanceDue: 'Scheduled maintenance',
    noDriver: 'No driver',
  },
  statusOptions: {
    open: 'Open',
    resolved: 'Resolved',
  },
  columns: {
    type: 'Type',
    vehicle: 'Vehicle',
    driver: 'Driver',
    supervisor: 'Supervisor',
    message: 'Message',
    dueDate: 'Due date',
    resolvedAt: 'Resolved on',
    resolvedBy: 'Resolved by',
    resolutionNote: 'Closing note',
    actions: 'Actions',
  },
  deadline: {
    overdue: (n: number) => `Overdue by ${n} day${n === 1 ? '' : 's'}`,
    today: 'Due today',
    tomorrow: 'Due tomorrow',
    inDays: (n: number) => `Due in ${n} days`,
  },
  resolveModal: {
    title: (subject) => `Resolve alert · ${subject}`,
    intro:
      'The alert will be marked as resolved under your name. If something was done to close it, leave a note: it stays visible in the resolved history.',
    noteLabel: 'Resolution note (optional)',
    notePlaceholder: 'E.g. workshop notified, service done, appointment booked…',
    dueDate: 'Due date',
    driver: 'Driver',
    cancel: 'Cancel',
    confirm: 'Resolve alert',
    saving: 'Resolving…',
    loadError: 'Could not load the notice details.',
    km: {
      hint: 'Register the pending reading: it closes the period’s notice.',
      dateLabel: 'Reading date',
      kmLabel: 'Km reading',
      kmRequired: 'Enter the km reading.',
      confirm: 'Register reading and resolve',
    },
    overage: {
      hint: 'You can hand the car to someone who drives less: pick a driver with a lower monthly average.',
      loading: 'Looking for candidates…',
      currentPace: (pace) => `Car’s monthly average: ${pace}`,
      candidateLabel: 'New driver',
      noChange: '— No driver change —',
      noCar: 'no car',
      noData: 'no data',
      perMonth: (km) => `${km}/month`,
      autoNote: (from, to) => `Driver change: ${from} → ${to}.`,
      confirmChange: 'Change driver and resolve',
    },
  },
  resolver: {
    driverMatch: 'Closed by the vehicle’s driver.',
    supervisorMatch: 'Closed by the vehicle’s supervisor.',
    mismatchTitle: 'Closed by someone outside the vehicle',
    mismatch: (driver, supervisor) =>
      `Neither the driver (${driver}) nor the supervisor (${supervisor}) of this vehicle. ` +
      'Check that whoever closed it knew what was going on with the car.',
    mismatchNoPeople:
      'The vehicle has no driver or supervisor assigned, so nobody from the car could have closed it.',
    automatic: 'Closed automatically',
    automaticTip:
      'The system closed it when the MOT, the insurance policy or the period’s km reading was registered.',
    unknown: 'Not recorded',
  },
  itvModal: {
    title: 'Register MOT',
    vehicle: 'Vehicle',
    choose: '— Choose —',
    chooseVehicleError: 'Choose a vehicle.',
    result: 'Result',
    resultPass: 'Pass',
    resultFail: 'Fail',
    inspectionDate: 'Inspection date',
    nextDue: 'Next MOT',
    cost: 'Cost (€, optional)',
    notes: 'Notes',
    note1: 'When registered, the vehicle’s MOT notices ',
    noteStrong: 'close automatically',
    note2: ' and the next due date is updated on the record.',
    saveError: 'Could not register the MOT.',
    savedNotice:
      'MOT registered: related notices close automatically and the next due date is updated.',
    cancel: 'Cancel',
    saving: 'Saving…',
    save: 'Register',
  },
}

const dict = { es, en }

/** Copia de la página en el idioma activo (UX1). */
export function useAlertsPageCopy() {
  return dict[useAppLang()]
}
