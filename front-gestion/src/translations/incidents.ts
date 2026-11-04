import { useAppLang } from '@flota/ui/i18n'

const es = {
  /** Las dos caras de la bandeja (`IncidentsPage` con su `scope`): lo que
   * cambia de rótulo entre incidencias y accidentes. */
  incidents: {
    title: 'Incidencias',
    // Sin ITV (es una alerta, su cita la lleva «ITV programada») y sin
    // accidentes, que tienen su propia bandeja.
    subtitle: 'Averías, mantenimientos puntuales y peticiones de la flota.',
    newLabel: 'Nueva incidencia',
    empty: 'No hay incidencias con estos filtros.',
    itemTitle: (id: number) => `Incidencia #${id}`,
  },
  accidents: {
    title: 'Accidentes',
    subtitle: 'Los accidentes de la flota: su parte, los implicados y cómo se cerró el siniestro.',
    // Un accidente se COMUNICA con su parte guiado, no con el formulario corto.
    newLabel: 'Comunicar accidente',
    empty: 'No hay accidentes con estos filtros.',
    itemTitle: (id: number) => `Accidente #${id}`,
    pickHint: 'Elige el coche accidentado: el siguiente paso es su parte.',
    pickContinue: 'Continuar al parte',
    // Cuánto lleva el expediente desde que se creó: meses enteros y los días
    // que sobran; por debajo del mes, solo días.
    ageColumn: 'Meses desde la creación',
    age: (months: number, days: number) => {
      const m = months === 1 ? '1 mes' : `${months} meses`
      const d = days === 1 ? '1 día' : `${days} días`
      if (months === 0) return d
      return days === 0 ? m : `${m} y ${d}`
    },
    ageTitle: (created: string) => `Creado el ${created}`,
    // RGPD: los datos de los terceros no se guardan para siempre. Al año la
    // fila avisa; a los 18 meses toca borrarlos, con su nota y su botón.
    warnNote: 'Más de un año: los datos de terceros se borran a los 18 meses.',
    purgeNote: 'Hay que borrar los datos de los terceros implicados.',
    purgedNote: (when: string) => `Datos de terceros borrados el ${when}.`,
    purge: 'Borrar datos de terceros',
    purgeNotYet: 'Los datos de terceros se borran a los 18 meses de la creación.',
    purgeTitle: (plate: string) => `Borrar datos de terceros · ${plate}`,
    purgeConfirm:
      'Se borran los datos de los terceros implicados y de los lesionados de este accidente (nombres, matrículas, teléfonos, aseguradoras). El resto del parte —dónde, cuándo, atestado y daños— se conserva. No se puede deshacer.',
    purged: (plate: string) => `Datos de terceros del accidente de ${plate} borrados.`,
    purgeError: 'No se pudieron borrar los datos de terceros.',
  },
  exportCsv: 'Exportar CSV',
  loading: 'Cargando…',
  loadError: 'No se pudieron cargar las incidencias.',
  saveError: 'No se pudo guardar la incidencia.',
  chooseVehicle: 'Elige el vehículo.',
  // Catálogo visible de la bandeja. La ITV no está: es una alerta, no una
  // incidencia (las peticiones internas «En ITV» del ciclo de estado no se
  // listan aquí; se siguen en «Estados abiertos» del vehículo).
  types: {
    breakdown: 'Avería',
    maintenance: 'Mantenimiento puntual',
    tires: 'Avería de neumáticos',
    accident: 'Accidente',
    general: 'Petición general',
  },
  // Prioridad: la decide quien abre la petición, de más a menos urgente.
  priorities: {
    critical: 'Crítica',
    moderate: 'Moderada',
    functional: 'Funcional',
    informative: 'Informativa',
  },
  statuses: {
    open: 'Abierta',
    on_going: 'En curso',
    closed: 'Cerrada',
  },
  // Las tres bandejas se recorren juntas: de una se salta a las otras.
  goAlerts: 'Ver alertas',
  goAccidents: 'Ver accidentes',
  goIncidents: 'Ver incidencias',
  // El campo ha propuesto cambios al parte (fila en azul; se decide en Solicitudes).
  changePending: 'Cambios propuestos desde el campo',
  // El botón de resolver, apagado mientras la propuesta siga sin decidir.
  resolveBlocked:
    'No se puede resolver hasta que se acepten o rechacen los cambios propuestos (Solicitudes).',
  // Solo dos pestañas: o está pendiente (abierta o en curso) o está cerrada.
  tabOpen: 'Abiertas',
  tabClosed: 'Cerradas',
  columns: {
    vehicle: 'Vehículo',
    type: 'Tipo',
    priority: 'Prioridad',
    date: 'Fecha',
    status: 'Estado',
    vehicleState: 'Estado del vehículo',
    cost: 'Coste',
    description: 'Descripción',
    actions: 'Acciones',
  },
  // Ficha completa de una incidencia (el ojo de la columna «Acciones»): lo que
  // no cabe en la tabla y vivía en el JSON del parte.
  view: 'Ver la incidencia',
  detail: {
    title: (plate: string) => `Incidencia · ${plate}`,
    close: 'Cerrar',
    request: 'La petición',
    tires: 'Parte de neumáticos',
    resolution: 'La solución',
    notResolved: 'Sigue abierta: todavía no tiene solución registrada.',
    noDescription: 'Sin descripción.',
    workshop: 'Taller',
    downtimeLabel: 'Días parado',
    downtime: (n: number) => `${n} ${n === 1 ? 'día' : 'días'}`,
    resolvedBy: 'Cerrada por',
    resolvedAt: 'Cerrada el',
    yes: 'Sí',
  },
  // Parte de accidente: lo que se recogió al comunicarlo y no cabe en columnas.
  report: {
    title: 'Parte del accidente',
    where: 'Dónde y cuándo',
    place: 'Lugar',
    occurredAt: 'Fecha y hora',
    phone: 'Teléfono de contacto',
    policeRef: 'Atestado',
    mileage: 'Kilometraje',
    workshopPostalCode: 'CP del taller',
    thirdParties: (n: number) => `Terceros implicados (${n})`,
    injured: (n: number) => `Lesionados (${n})`,
    noThirdParties: 'Sin terceros implicados.',
    noInjured: 'Sin lesionados.',
    tpPlate: 'Matrícula',
    tpVehicle: 'Vehículo',
    tpName: 'Nombre',
    tpPhone: 'Teléfono',
    tpInsurer: 'Aseguradora',
    tpPolicy: 'N.º de póliza',
    tpDamage: 'Daños',
    injName: 'Nombre',
    injPhone: 'Teléfono',
    injEmail: 'Correo',
    injPlate: 'Matrícula',
    injSeat: 'Plaza',
    empty: '—',
  },
  edit: 'Editar',
  resolve: 'Resolver',
  documents: 'Documentos',
  documentsTitle: 'Los documentos (acta/parte/fotos) se ligan desde la ficha',
  filterVehicle: 'Vehículo',
  filterType: 'Tipo',
  filterPriority: 'Prioridad',
  filterAll: 'Todos',
  filterByStatus: 'Filtrar por estado',
  records: 'Registros',
  searchLabel: 'Buscar',
  searchPlaceholder: 'Matrícula, tipo o descripción…',
  viewDescription: 'Ver descripción',
  form: {
    vehicle: 'Vehículo',
    choosePlaceholder: '— Elegir —',
    type: 'Tipo',
    priority: 'Prioridad',
    date: 'Fecha',
    status: 'Estado',
    cost: 'Coste (€)',
    postalCode: 'CP preferente',
    postalCodeHint: 'Desde este código postal se busca el taller más cercano.',
    description: 'Descripción',
    cancel: 'Cancelar',
    save: 'Guardar',
    saving: 'Guardando…',
  },
}

const en: typeof es = {
  incidents: {
    title: 'Incidents',
    subtitle: 'Breakdowns, one-off maintenance and requests across the fleet.',
    newLabel: 'New incident',
    empty: 'No incidents match these filters.',
    itemTitle: (id) => `Incident #${id}`,
  },
  accidents: {
    title: 'Accidents',
    subtitle: 'The fleet accidents: the report, who was involved and how the claim was closed.',
    newLabel: 'Report accident',
    empty: 'No accidents match these filters.',
    itemTitle: (id) => `Accident #${id}`,
    pickHint: 'Choose the car involved: the next step is its report.',
    pickContinue: 'Continue to the report',
    ageColumn: 'Months since created',
    age: (months, days) => {
      const m = months === 1 ? '1 month' : `${months} months`
      const d = days === 1 ? '1 day' : `${days} days`
      if (months === 0) return d
      return days === 0 ? m : `${m} and ${d}`
    },
    ageTitle: (created) => `Created on ${created}`,
    warnNote: 'Over a year old: third-party data is deleted at 18 months.',
    purgeNote: 'The third parties’ data must be deleted.',
    purgedNote: (when) => `Third-party data deleted on ${when}.`,
    purge: 'Delete third-party data',
    purgeNotYet: 'Third-party data is deleted 18 months after creation.',
    purgeTitle: (plate) => `Delete third-party data · ${plate}`,
    purgeConfirm:
      'The data of the third parties and injured people in this accident (names, plates, phones, insurers) will be deleted. The rest of the report —where, when, police report and damage— is kept. This cannot be undone.',
    purged: (plate) => `Third-party data of the ${plate} accident deleted.`,
    purgeError: 'The third-party data could not be deleted.',
  },
  exportCsv: 'Export CSV',
  loading: 'Loading…',
  loadError: 'Could not load incidents.',
  saveError: 'Could not save the incident.',
  chooseVehicle: 'Choose a vehicle.',
  types: {
    breakdown: 'Breakdown',
    maintenance: 'One-off maintenance',
    tires: 'Tyre breakdown',
    accident: 'Accident',
    general: 'General request',
  },
  priorities: {
    critical: 'Critical',
    moderate: 'Moderate',
    functional: 'Functional',
    informative: 'Informative',
  },
  statuses: {
    open: 'Open',
    on_going: 'In progress',
    closed: 'Closed',
  },
  goAlerts: 'View alerts',
  goAccidents: 'View accidents',
  goIncidents: 'View incidents',
  changePending: 'Changes proposed from the field',
  resolveBlocked:
    'It cannot be resolved until the proposed changes are accepted or rejected (Requests).',
  tabOpen: 'Open',
  tabClosed: 'Closed',
  columns: {
    vehicle: 'Vehicle',
    type: 'Type',
    priority: 'Priority',
    date: 'Date',
    status: 'Status',
    vehicleState: 'Vehicle status',
    cost: 'Cost',
    description: 'Description',
    actions: 'Actions',
  },
  view: 'View incident',
  detail: {
    title: (plate: string) => `Incident · ${plate}`,
    close: 'Close',
    request: 'The request',
    tires: 'Tyre report',
    resolution: 'The resolution',
    notResolved: 'Still open: no resolution recorded yet.',
    noDescription: 'No description.',
    workshop: 'Workshop',
    downtimeLabel: 'Days off road',
    downtime: (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`,
    resolvedBy: 'Closed by',
    resolvedAt: 'Closed on',
    yes: 'Yes',
  },
  report: {
    title: 'Accident report',
    where: 'Where and when',
    place: 'Place',
    occurredAt: 'Date and time',
    phone: 'Contact phone',
    policeRef: 'Police report',
    mileage: 'Odometer',
    workshopPostalCode: 'Workshop postcode',
    thirdParties: (n: number) => `Third parties involved (${n})`,
    injured: (n: number) => `Injured people (${n})`,
    noThirdParties: 'No third parties involved.',
    noInjured: 'No injured people.',
    tpPlate: 'Plate',
    tpVehicle: 'Vehicle',
    tpName: 'Name',
    tpPhone: 'Phone',
    tpInsurer: 'Insurer',
    tpPolicy: 'Policy number',
    tpDamage: 'Damage',
    injName: 'Name',
    injPhone: 'Phone',
    injEmail: 'Email',
    injPlate: 'Plate',
    injSeat: 'Seat',
    empty: '—',
  },
  edit: 'Edit',
  resolve: 'Resolve',
  documents: 'Documents',
  documentsTitle: 'Documents (report/claim/photos) are attached from the vehicle page',
  filterVehicle: 'Vehicle',
  filterType: 'Type',
  filterPriority: 'Priority',
  filterAll: 'All',
  filterByStatus: 'Filter by status',
  records: 'Records',
  searchLabel: 'Search',
  searchPlaceholder: 'Plate, type or description…',
  viewDescription: 'View description',
  form: {
    vehicle: 'Vehicle',
    choosePlaceholder: '— Choose —',
    type: 'Type',
    priority: 'Priority',
    date: 'Date',
    status: 'Status',
    cost: 'Cost (€)',
    postalCode: 'Preferred postcode',
    postalCodeHint: 'The nearest workshop is looked up from this postcode.',
    description: 'Description',
    cancel: 'Cancel',
    save: 'Save',
    saving: 'Saving…',
  },
}

const dict = { es, en }

/** Copia de la página en el idioma activo (UX1). */
export function useIncidentsCopy() {
  return dict[useAppLang()]
}
