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
    actions: 'Acciones',
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
    actions: 'Actions',
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
