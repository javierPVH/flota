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
  records: 'Registros',
  searchLabel: 'Buscar',
  searchPlaceholder: 'Matrícula, tipo, persona o mensaje…',
  viewMessage: 'Ver mensaje',
  emptyState: 'Sin alertas con estos filtros. 🎉',
  closedNotice: (subject: string) => `Alerta de ${subject} resuelta.`,
  emailModalTitle: (plate: string) => `Correo · ${plate}`,
  noVehicle: 'Sin vehículo',
  filters: {
    type: 'Tipo',
    level: 'Nivel',
    status: 'Estado',
  },
  typeOptions: {
    all: 'Todos los tipos',
    itvDue: 'ITV próxima / vencida',
    kmReadingPending: 'Lectura de km pendiente',
    kmOverage: 'Exceso de km proyectado',
    maintenanceDue: 'Mantenimiento próximo / vencido',
    noDriver: 'Sin conductor',
  },
  levelOptions: {
    all: 'Todos los niveles',
    critical: 'Crítica',
    warning: 'Aviso',
    info: 'Informativa',
  },
  statusOptions: {
    open: 'Abiertas',
    resolved: 'Resueltas',
    all: 'Todas',
  },
  columns: {
    level: 'Nivel',
    type: 'Tipo',
    vehicle: 'Vehículo',
    driver: 'Conductor',
    supervisor: 'Responsable',
    message: 'Mensaje',
    dueDate: 'Fecha límite',
    resolvedAt: 'Resuelta el',
    resolvedBy: 'Resuelta por',
    resolutionNote: 'Nota de cierre',
    actions: 'Acciones',
  },
  /** Modal de resolver: resumen del aviso + la actuación propia de cada tipo
   * (lectura de km, cambio de conductor, servicio de mantenimiento, correo a
   * la renting) + nota opcional de qué se hizo. */
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
    maintenance: {
      hint: 'Registra el servicio: el plan se reancla y los avisos de mantenimiento se cierran.',
      planLabel: 'Plan de mantenimiento',
      dateLabel: 'Fecha del servicio',
      kmLabel: 'Km al realizarlo',
      kmPlaceholder: 'Vacío = última lectura conocida',
      costLabel: 'Coste (€, opcional)',
      costHint: 'El coste queda en el histórico como incidencia de mantenimiento cerrada.',
      confirm: 'Registrar mantenimiento y resolver',
      noPlans:
        'El vehículo no tiene planes de mantenimiento: la alerta se resolverá solo con la nota.',
    },
    insurance: {
      hint:
        'El destinatario natural de este aviso es la empresa de renting: puedes mandarle el correo antes de resolver.',
      emailButton: 'Mandar correo a la renting',
    },
  },
  resolver: {
    /** Cerró quien tenía el coche: se pinta en verde. */
    driverMatch: 'Cerrada por el conductor del vehículo.',
    supervisorMatch: 'Cerrada por el responsable del vehículo.',
    /** Y cuando no lo era: bocadillo del icono de aviso. */
    mismatchTitle: 'Cerrada por alguien ajeno al vehículo',
    mismatch: (driver: string, supervisor: string) =>
      `No es el conductor (${driver}) ni el responsable (${supervisor}) de este vehículo. ` +
      'Comprueba que quien la cerró sabía lo que pasaba con el coche.',
    mismatchNoPeople:
      'El vehículo no tiene conductor ni responsable asignado, así que nadie del coche pudo cerrarla.',
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
  records: 'Records',
  searchLabel: 'Search',
  searchPlaceholder: 'Plate, type, person or message…',
  viewMessage: 'View message',
  emptyState: 'No alerts with these filters. 🎉',
  closedNotice: (subject) => `Alert for ${subject} resolved.`,
  emailModalTitle: (plate) => `Email · ${plate}`,
  noVehicle: 'No vehicle',
  filters: {
    type: 'Type',
    level: 'Level',
    status: 'Status',
  },
  typeOptions: {
    all: 'All types',
    itvDue: 'MOT due / overdue',
    kmReadingPending: 'Km reading pending',
    kmOverage: 'Projected km overage',
    maintenanceDue: 'Maintenance due / overdue',
    noDriver: 'No driver',
  },
  levelOptions: {
    all: 'All levels',
    critical: 'Critical',
    warning: 'Warning',
    info: 'Info',
  },
  statusOptions: {
    open: 'Open',
    resolved: 'Resolved',
    all: 'All',
  },
  columns: {
    level: 'Level',
    type: 'Type',
    vehicle: 'Vehicle',
    driver: 'Driver',
    supervisor: 'Owner',
    message: 'Message',
    dueDate: 'Due date',
    resolvedAt: 'Resolved on',
    resolvedBy: 'Resolved by',
    resolutionNote: 'Closing note',
    actions: 'Actions',
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
    maintenance: {
      hint: 'Register the service: the plan is re-anchored and maintenance notices close.',
      planLabel: 'Maintenance plan',
      dateLabel: 'Service date',
      kmLabel: 'Km when done',
      kmPlaceholder: 'Empty = last known reading',
      costLabel: 'Cost (€, optional)',
      costHint: 'The cost is kept in the history as a closed maintenance incident.',
      confirm: 'Register maintenance and resolve',
      noPlans: 'The vehicle has no maintenance plans: the alert will be resolved with the note only.',
    },
    insurance: {
      hint: 'The natural recipient of this notice is the leasing company: you can email them before resolving.',
      emailButton: 'Email the leasing company',
    },
  },
  resolver: {
    driverMatch: 'Closed by the vehicle’s driver.',
    supervisorMatch: 'Closed by the vehicle’s owner.',
    mismatchTitle: 'Closed by someone outside the vehicle',
    mismatch: (driver, supervisor) =>
      `Neither the driver (${driver}) nor the owner (${supervisor}) of this vehicle. ` +
      'Check that whoever closed it knew what was going on with the car.',
    mismatchNoPeople:
      'The vehicle has no driver or owner assigned, so nobody from the car could have closed it.',
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
