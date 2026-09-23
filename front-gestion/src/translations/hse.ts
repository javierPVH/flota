import { useAppLang } from '@flota/ui/i18n'

/**
 * Copia de la vista HSE (prevención/seguridad): la flota de SOLO LECTURA en
 * cuatro pestañas. Lo que ya tiene dueño no se repite: el plazo bajo la fecha
 * límite es el de `alertsPage.deadline`, el semáforo de km el de
 * `vehicles.kmStale`, y las etiquetas de los enumerados las pone
 * `domainLabels`.
 */
const es = {
  title: 'HSE',
  subtitle: 'Vista de solo lectura de la flota: vehículos, incidencias, accidentes y alertas.',
  readOnly:
    'Aquí se consulta, no se opera: no hay acciones sobre los vehículos ni sobre lo que tienen abierto.',
  tabs: {
    vehicles: 'Vehículos',
    incidents: 'Incidencias',
    accidents: 'Accidentes',
    alerts: 'Alertas',
  },
  records: 'Registros',
  searchLabel: 'Buscar',
  searchPlaceholder: {
    vehicles: 'Matrícula, marca, conductor, supervisor…',
    incidents: 'Matrícula, tipo, descripción, taller…',
    accidents: 'Matrícula, lugar, atestado, descripción…',
    alerts: 'Matrícula, tipo, persona o mensaje…',
  },
  exportCsv: 'Exportar CSV',
  loading: 'Cargando…',
  loadError: {
    vehicles: 'No se pudieron cargar los vehículos.',
    incidents: 'No se pudieron cargar las incidencias.',
    alerts: 'No se pudieron cargar las alertas.',
  },
  empty: {
    vehicles: 'Ningún vehículo con estos filtros.',
    incidents: 'No hay incidencias con estos filtros.',
    accidents: 'No hay accidentes con estos filtros.',
    alerts: 'Sin alertas con estos filtros.',
  },
  // Estado de lo abierto: pendiente (abierta o en curso), cerrado o todo.
  statusFilter: 'Estado',
  incidentStatus: {
    pending: 'Abiertas',
    closed: 'Cerradas',
    all: 'Todas',
  },
  alertStatus: {
    open: 'Abiertas',
    resolved: 'Resueltas',
  },
  viewDescription: 'Ver descripción',
  viewMessage: 'Ver mensaje',
  columns: {
    vehicles: {
      plate: 'Matrícula',
      vehicle: 'Vehículo',
      state: 'Estado',
      driver: 'Conductor',
      supervisor: 'Supervisor',
      site: 'Sede',
      nextItv: 'Próx. ITV',
      insurance: 'Seguro',
      km: 'Kilómetros',
      fuel: 'Combustible',
    },
    incidents: {
      date: 'Fecha',
      vehicle: 'Vehículo',
      type: 'Tipo',
      priority: 'Prioridad',
      status: 'Estado',
      vehicleState: 'Estado del vehículo',
      description: 'Descripción',
      postalCode: 'CP',
      workshop: 'Taller',
      cost: 'Coste',
    },
    accidents: {
      date: 'Fecha',
      vehicle: 'Vehículo',
      occurredAt: 'Cuándo ocurrió',
      place: 'Lugar',
      priority: 'Prioridad',
      status: 'Estado',
      vehicleState: 'Estado del vehículo',
      thirdParties: 'Terceros',
      injured: 'Lesionados',
      policeRef: 'Atestado',
      description: 'Descripción',
      cost: 'Coste',
    },
    alerts: {
      type: 'Tipo',
      level: 'Nivel',
      vehicle: 'Vehículo',
      driver: 'Conductor',
      supervisor: 'Supervisor',
      message: 'Mensaje',
      dueDate: 'Fecha límite',
      status: 'Estado',
    },
  },
}

const en: typeof es = {
  title: 'HSE',
  subtitle: 'Read-only view of the fleet: vehicles, incidents, accidents and alerts.',
  readOnly:
    'This is for looking, not for doing: there are no actions on vehicles or on what they have open.',
  tabs: {
    vehicles: 'Vehicles',
    incidents: 'Incidents',
    accidents: 'Accidents',
    alerts: 'Alerts',
  },
  records: 'Records',
  searchLabel: 'Search',
  searchPlaceholder: {
    vehicles: 'Plate, brand, driver, supervisor…',
    incidents: 'Plate, type, description, workshop…',
    accidents: 'Plate, place, police report, description…',
    alerts: 'Plate, type, person or message…',
  },
  exportCsv: 'Export CSV',
  loading: 'Loading…',
  loadError: {
    vehicles: 'Vehicles could not be loaded.',
    incidents: 'Incidents could not be loaded.',
    alerts: 'Alerts could not be loaded.',
  },
  empty: {
    vehicles: 'No vehicles match these filters.',
    incidents: 'No incidents match these filters.',
    accidents: 'No accidents match these filters.',
    alerts: 'No alerts match these filters.',
  },
  statusFilter: 'Status',
  incidentStatus: {
    pending: 'Open',
    closed: 'Closed',
    all: 'All',
  },
  alertStatus: {
    open: 'Open',
    resolved: 'Resolved',
  },
  viewDescription: 'View description',
  viewMessage: 'View message',
  columns: {
    vehicles: {
      plate: 'Plate',
      vehicle: 'Vehicle',
      state: 'State',
      driver: 'Driver',
      supervisor: 'Supervisor',
      site: 'Site',
      nextItv: 'Next MOT',
      insurance: 'Insurance',
      km: 'Mileage',
      fuel: 'Fuel',
    },
    incidents: {
      date: 'Date',
      vehicle: 'Vehicle',
      type: 'Type',
      priority: 'Priority',
      status: 'Status',
      vehicleState: 'Vehicle state',
      description: 'Description',
      postalCode: 'Postcode',
      workshop: 'Workshop',
      cost: 'Cost',
    },
    accidents: {
      date: 'Date',
      vehicle: 'Vehicle',
      occurredAt: 'When it happened',
      place: 'Place',
      priority: 'Priority',
      status: 'Status',
      vehicleState: 'Vehicle state',
      thirdParties: 'Third parties',
      injured: 'Injured',
      policeRef: 'Police report',
      description: 'Description',
      cost: 'Cost',
    },
    alerts: {
      type: 'Type',
      level: 'Level',
      vehicle: 'Vehicle',
      driver: 'Driver',
      supervisor: 'Supervisor',
      message: 'Message',
      dueDate: 'Due date',
      status: 'Status',
    },
  },
}

const dict = { es, en }

/** Copia de la vista HSE en el idioma activo. */
export function useHseCopy() {
  return dict[useAppLang()]
}
