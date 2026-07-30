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
  dismiss: 'Descartar',
  emptyState: 'Sin alertas con estos filtros. 🎉',
  closedNotice: (subject: string, resolved: boolean) =>
    `Alerta de ${subject} ${resolved ? 'resuelta' : 'descartada'}.`,
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
    dismissed: 'Descartadas',
    all: 'Todas',
  },
  columns: {
    level: 'Nivel',
    type: 'Tipo',
    vehicle: 'Vehículo',
    message: 'Mensaje',
    dueDate: 'Fecha límite',
    actions: 'Acciones',
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
  dismiss: 'Dismiss',
  emptyState: 'No alerts with these filters. 🎉',
  closedNotice: (subject, resolved) =>
    `Alert for ${subject} ${resolved ? 'resolved' : 'dismissed'}.`,
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
    dismissed: 'Dismissed',
    all: 'All',
  },
  columns: {
    level: 'Level',
    type: 'Type',
    vehicle: 'Vehicle',
    message: 'Message',
    dueDate: 'Due date',
    actions: 'Actions',
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
