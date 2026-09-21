import { useAppLang } from '@flota/ui/i18n'

/** Textos de los modales de resolver (dispatcher + formularios por tipo). Las
 * literales «Coste (€)», «Resolver y cerrar», «Mandar correo a la renting» y
 * «Petición resuelta y cerrada.» las aseveran tests existentes: no cambiarlas. */
const es = {
  titles: {
    incident: (type: string, plate: string) => `Resolver ${type.toLowerCase()} · ${plate}`,
    alert: (subject: string) => `Resolver alerta · ${subject}`,
    itv: (plate: string) => `Registrar ITV · ${plate}`,
    insurance: (plate: string) => `Renovar seguro · ${plate}`,
    maintenance: (plate: string) => `Registrar mantenimiento · ${plate}`,
  },
  common: {
    date: 'Fecha de solución',
    km: 'Km al recoger el vehículo',
    cost: 'Coste (€)',
    observations: 'Observaciones',
    proof: (doc: string) => `Adjuntar ${doc} (opcional)`,
    proofFailed: (name: string) =>
      `La resolución se guardó, pero no se pudo subir «${name}»: súbelo desde Documentos.`,
    returnToActive: 'Devolver el vehículo a Activo',
    returnToActiveHint: 'Desmárcalo si el coche sigue fuera de servicio por otra causa.',
    postalCode: 'CP de la ubicación / taller',
    postalCodeHint: 'El de la petición. Complétalo o corrígelo si al final fue a otro sitio.',
    // Vuelta al servicio: el coche está parado, así que hay algo que decidir.
    stoppedTitle: (state: string) => `Este coche está parado (${state}).`,
    backToService: 'Devolver el coche a Activo al resolver',
    backToServiceFree: (plate: string) =>
      `Devolver el coche a Activo y dejar libre el de sustitución (${plate})`,
    backToServiceHint: 'Déjalo sin marcar si sigue fuera de servicio por otra causa.',
    releasedNotice: (plate: string) => `El coche de sustitución ${plate} queda libre.`,
    releaseBlocked: (kind: string) =>
      `El coche no vuelve a Activo: sigue abierta una petición de ${kind}.`,
    releaseFailed: 'La resolución se guardó, pero no se pudo liberar el coche de sustitución.',
    // El coche no rueda mientras está en el taller: casi siempre se cierra con
    // la misma lectura con la que entró, y tecleada a mano se equivoca.
    loadKm: (km: string) => `Cargar los del coche (${km})`,
    loadKmHint: 'En el taller no hace kilómetros: si no ha rodado, esta lectura vale.',
    cancel: 'Cancelar',
    saving: 'Guardando…',
    genericError: 'No se pudo guardar la resolución.',
  },
  docs: {
    workshop_invoice: 'la factura del taller',
    itv_report: 'el informe de la ITV',
    insurance: 'la póliza',
  },
  breakdown: {
    intro:
      'Cierra la avería con lo que se hizo: dónde, cuánto costó y con qué km se recogió el coche.',
    confirm: 'Resolver y cerrar',
  },
  /** Petición general: puede no ir del coche (documentación, tarjetas, dudas),
   * así que lo del taller solo se pregunta si lo hubo. */
  general: {
    intro: 'Cierra la petición con lo que se hizo. Si no hubo taller, basta con las observaciones.',
    workshop: 'Requirió pasar por el taller',
    workshopHint: 'Al marcarlo se piden los kilómetros, el coste, el CP y la factura.',
  },
  itv: {
    km: 'Km en la inspección',
    savedActive: 'El vehículo vuelve a estar Activo.',
  },
  maintenance: {
    hint:
      'Registra el servicio: el plan se reancla, queda como incidencia de mantenimiento cerrada y sus avisos se cierran.',
    planLabel: 'Plan de mantenimiento',
    /** El puntual no tiene ciclo: se cierra con sus datos y nada más. */
    hintOnce:
      'Mantenimiento puntual: no hay plan que reanclar. Se cierra la petición con su fecha, kilómetros, coste y factura.',
    planFixed: 'Plan',
    dateLabel: 'Fecha del servicio',
    kmLabel: 'Km al realizarlo',
    kmPlaceholder: 'Vacío = última lectura conocida',
    loadingPlans: 'Cargando planes…',
    noPlans:
      'El vehículo no tiene planes de mantenimiento: la alerta se resolverá solo con la nota.',
    confirmAlert: 'Registrar mantenimiento y resolver',
    confirmIncident: 'Resolver y cerrar',
    confirmPlan: 'Registrar servicio',
    savedNotice: 'Mantenimiento registrado: el plan queda reanclado y sus avisos cerrados.',
    savedNoticeActive:
      'Mantenimiento registrado: el plan queda reanclado y sus avisos cerrados. El vehículo vuelve a estar Activo.',
  },
  insurance: {
    intro: (current: string) =>
      `Vencimiento actual: ${current}. Indica hasta cuándo queda cubierto el vehículo con la póliza renovada.`,
    newExpiry: 'Nueva fecha de vencimiento',
    notes: 'Notas',
    notesPlaceholder: 'P. ej. aseguradora o condiciones de la renovación…',
    emailHint:
      'El destinatario natural de este aviso es la empresa de renting: puedes mandarle el correo antes de renovar.',
    emailButton: 'Mandar correo a la renting',
    confirm: 'Renovar seguro',
    savedNotice: (date: string) =>
      `Seguro renovado hasta el ${date}: los avisos de seguro quedan resueltos.`,
    unchangedNotice: 'La fecha ya estaba aplicada: no había nada que renovar.',
  },
  tires: {
    intro:
      'Cierra el parte con los neumáticos MONTADOS (el parte registra los que se quitaron) y dónde se hizo.',
    size: 'Medida',
    sizePlaceholder: 'P. ej. 205/55 R16',
    brand: 'Marca',
    quantity: 'Cantidad',
    positions: 'Posiciones',
    position: {
      front_left: 'Delantera izquierda',
      front_right: 'Delantera derecha',
      rear_left: 'Trasera izquierda',
      rear_right: 'Trasera derecha',
    },
    confirm: 'Resolver y cerrar',
  },
  accident: {
    intro:
      'Cierra el accidente con la reparación (taller, coste, km) y los datos del siniestro para el seguro.',
    claimRef: 'Nº de expediente',
    liability: 'Quién asume el coste',
    liabilityNone: '— Sin determinar —',
    liabilityOwn: 'Seguro propio',
    liabilityThirdParty: 'Tercero',
    liabilityDeductible: 'Franquicia',
    deductibleAmount: 'Importe de la franquicia (€)',
    totalLoss: 'Siniestro total',
    totalLossHint: 'El vehículo no vuelve al servicio: al resolver se abre su baja.',
    confirm: 'Resolver y cerrar',
    confirmRetire: 'Resolver y dar de baja',
  },
  noDriver: {
    hint: 'Puedes asignar el conductor aquí mismo, o resolver solo con la nota.',
    loading: 'Buscando conductores…',
    candidateLabel: 'Asignar conductor',
    noAssign: '— Sin asignar ahora —',
    autoNote: (name: string) => `Conductor asignado: ${name}.`,
    confirmAssign: 'Asignar conductor y resolver',
  },
  /** Tarjeta «Alertas e incidencias abiertas» de la ficha del vehículo. */
  pending: {
    // Ya no solo lo abierto: la tarjeta lleva también el histórico cerrado.
    title: 'Alertas e incidencias',
    // La misma tarjeta como modal, desde el menú ⋮ del listado y del panel.
    modalTitle: (plate: string) => `Alertas e incidencias · ${plate}`,
    /** La misma lista, acotada a accidentes, en su propia tarjeta de la ficha. */
    accidentsTitle: 'Accidentes',
    loading: 'Cargando pendientes…',
    loadingClosed: 'Cargando el histórico…',
    error: 'No se pudieron cargar las alertas e incidencias del vehículo.',
    // Pestañas: de qué se habla y en qué estado. En el modal del menú ⋮, la
    // primera es el formulario de estado (antes una acción aparte).
    tabNewState: 'Nuevo estado',
    tabIncidents: 'Incidencias',
    tabAlerts: 'Alertas',
    tabOpen: 'Abiertas',
    tabClosed: 'Cerradas',
    // Filtros y orden de la lista (en las cuatro pestañas).
    filterType: 'Tipo',
    filterTypeAll: 'Todos los tipos',
    filterLevel: 'Prioridad',
    filterLevelAll: 'Todas',
    sortLabel: 'Ordenar',
    sortPriority: 'Prioridad',
    sortNear: 'Fecha más próxima',
    sortFar: 'Fecha más lejana',
    sortType: 'Tipo',
    emptyFiltered: 'Nada con este filtro.',
    emptyOpenIncidents: 'Sin incidencias abiertas.',
    emptyClosedIncidents: 'Todavía no hay incidencias cerradas.',
    // La misma lista acotada a los accidentes (pestaña «Gestionar accidentes»).
    emptyOpenAccidents: 'Sin accidentes abiertos.',
    emptyClosedAccidents: 'Todavía no hay accidentes cerrados.',
    emptyOpenAlerts: 'Sin alertas abiertas.',
    emptyClosedAlerts: 'Todavía no hay alertas resueltas.',
    closedTag: 'Cerrada',
    resolvedTag: 'Resuelta',
    resolvedBy: (name: string) => `Resuelta por ${name}`,
    resolve: 'Resolver',
    // Sobre de la fila: abre el aviso por correo al responsable del coche.
    email: 'Avisar por correo',
    newIncident: 'Nueva incidencia',
    accidentReport: 'Comunicar accidente',
    loadingVehicles: 'Cargando vehículos…',
    /** Solo en la lista de toda la flota: su histórico no cabe entero. */
    closedRecent: 'Lo último que se ha cerrado. El histórico completo, en su bandeja.',
  },
  notices: {
    incidentResolved: 'Petición resuelta y cerrada.',
    incidentResolvedActive: 'Petición resuelta y cerrada. El vehículo vuelve a estar Activo.',
    retired: (plate: string) => `Vehículo ${plate} dado de baja.`,
  },
}

const en: typeof es = {
  titles: {
    incident: (type, plate) => `Resolve ${type.toLowerCase()} · ${plate}`,
    alert: (subject) => `Resolve alert · ${subject}`,
    itv: (plate) => `Register MOT · ${plate}`,
    insurance: (plate) => `Renew insurance · ${plate}`,
    maintenance: (plate) => `Register maintenance · ${plate}`,
  },
  common: {
    date: 'Resolution date',
    km: 'Odometer when collected',
    cost: 'Cost (€)',
    observations: 'Notes',
    proof: (doc) => `Attach ${doc} (optional)`,
    proofFailed: (name) =>
      `The resolution was saved, but “${name}” could not be uploaded: add it from Documents.`,
    returnToActive: 'Return the vehicle to Active',
    returnToActiveHint: 'Untick it if the car is still out of service for another reason.',
    postalCode: 'Location / workshop postcode',
    postalCodeHint: 'The one on the request. Fill it in or correct it if it ended up elsewhere.',
    stoppedTitle: (state) => `This car is off the road (${state}).`,
    backToService: 'Return the car to Active when resolving',
    backToServiceFree: (plate) =>
      `Return the car to Active and free its replacement (${plate})`,
    backToServiceHint: 'Leave it unticked if it is still out of service for another reason.',
    releasedNotice: (plate) => `Replacement car ${plate} is now free.`,
    releaseBlocked: (kind) => `The car stays off the road: a ${kind} request is still open.`,
    releaseFailed: 'The resolution was saved, but the replacement car could not be freed.',
    loadKm: (km) => `Load the car's own (${km})`,
    loadKmHint: 'A car in the workshop covers no distance: if it has not moved, this reading holds.',
    cancel: 'Cancel',
    saving: 'Saving…',
    genericError: 'The resolution could not be saved.',
  },
  docs: {
    workshop_invoice: 'the workshop invoice',
    itv_report: 'the MOT report',
    insurance: 'the policy',
  },
  breakdown: {
    intro: 'Close the breakdown with what was done: where, how much it cost and the odometer when collected.',
    confirm: 'Resolve & close',
  },
  general: {
    intro: 'Close the request with what was done. If there was no workshop, the notes are enough.',
    workshop: 'It had to go to the workshop',
    workshopHint: 'Ticking it asks for the odometer, the cost, the postcode and the invoice.',
  },
  itv: {
    km: 'Odometer at inspection',
    savedActive: 'The vehicle is Active again.',
  },
  maintenance: {
    hint: 'Register the service: the plan is re-anchored, kept as a closed maintenance incident and its notices close.',
    planLabel: 'Maintenance plan',
    hintOnce:
      'One-off maintenance: there is no plan to re-anchor. The request is closed with its date, mileage, cost and invoice.',
    planFixed: 'Plan',
    dateLabel: 'Service date',
    kmLabel: 'Km when done',
    kmPlaceholder: 'Empty = last known reading',
    loadingPlans: 'Loading plans…',
    noPlans: 'The vehicle has no maintenance plans: the alert will be resolved with the note only.',
    confirmAlert: 'Register maintenance and resolve',
    confirmIncident: 'Resolve & close',
    confirmPlan: 'Register service',
    savedNotice: 'Maintenance registered: the plan is re-anchored and its notices closed.',
    savedNoticeActive:
      'Maintenance registered: the plan is re-anchored and its notices closed. The vehicle is Active again.',
  },
  insurance: {
    intro: (current) =>
      `Current expiry: ${current}. Enter until when the vehicle is covered by the renewed policy.`,
    newExpiry: 'New expiry date',
    notes: 'Notes',
    notesPlaceholder: 'E.g. insurer or renewal terms…',
    emailHint:
      'The natural recipient of this notice is the leasing company: you can email them before renewing.',
    emailButton: 'Email the leasing company',
    confirm: 'Renew insurance',
    savedNotice: (date) => `Insurance renewed until ${date}: insurance notices are resolved.`,
    unchangedNotice: 'That date was already applied: nothing to renew.',
  },
  tires: {
    intro: 'Close the report with the tyres FITTED (the report records the ones removed) and where it was done.',
    size: 'Size',
    sizePlaceholder: 'E.g. 205/55 R16',
    brand: 'Brand',
    quantity: 'Quantity',
    positions: 'Positions',
    position: {
      front_left: 'Front left',
      front_right: 'Front right',
      rear_left: 'Rear left',
      rear_right: 'Rear right',
    },
    confirm: 'Resolve & close',
  },
  accident: {
    intro: 'Close the accident with the repair (workshop, cost, km) and the claim details for the insurer.',
    claimRef: 'Claim reference',
    liability: 'Who bears the cost',
    liabilityNone: '— Not determined —',
    liabilityOwn: 'Own insurance',
    liabilityThirdParty: 'Third party',
    liabilityDeductible: 'Deductible',
    deductibleAmount: 'Deductible amount (€)',
    totalLoss: 'Total loss',
    totalLossHint: 'The vehicle does not return to service: resolving opens its retirement.',
    confirm: 'Resolve & close',
    confirmRetire: 'Resolve & retire',
  },
  noDriver: {
    hint: 'You can assign the driver right here, or resolve with just the note.',
    loading: 'Looking for drivers…',
    candidateLabel: 'Assign driver',
    noAssign: '— Do not assign now —',
    autoNote: (name) => `Driver assigned: ${name}.`,
    confirmAssign: 'Assign driver and resolve',
  },
  pending: {
    title: 'Alerts and incidents',
    modalTitle: (plate) => `Alerts and incidents · ${plate}`,
    accidentsTitle: 'Accidents',
    loading: 'Loading pending items…',
    loadingClosed: 'Loading history…',
    error: 'Could not load the vehicle’s alerts and incidents.',
    tabNewState: 'New status',
    tabIncidents: 'Incidents',
    tabAlerts: 'Alerts',
    tabOpen: 'Open',
    tabClosed: 'Closed',
    filterType: 'Type',
    filterTypeAll: 'All types',
    filterLevel: 'Priority',
    filterLevelAll: 'All',
    sortLabel: 'Sort',
    sortPriority: 'Priority',
    sortNear: 'Closest date',
    sortFar: 'Furthest date',
    sortType: 'Type',
    emptyFiltered: 'Nothing matches this filter.',
    emptyOpenIncidents: 'No open incidents.',
    emptyClosedIncidents: 'No closed incidents yet.',
    emptyOpenAccidents: 'No open accidents.',
    emptyClosedAccidents: 'No closed accidents yet.',
    emptyOpenAlerts: 'No open alerts.',
    emptyClosedAlerts: 'No resolved alerts yet.',
    closedTag: 'Closed',
    resolvedTag: 'Resolved',
    resolvedBy: (name) => `Resolved by ${name}`,
    resolve: 'Resolve',
    email: 'Notify by email',
    newIncident: 'New incident',
    accidentReport: 'Report an accident',
    loadingVehicles: 'Loading vehicles…',
    closedRecent: 'The most recently closed ones. The full history lives in its inbox.',
  },
  notices: {
    incidentResolved: 'Request resolved and closed.',
    incidentResolvedActive: 'Request resolved and closed. The vehicle is Active again.',
    retired: (plate) => `Vehicle ${plate} retired.`,
  },
}

export const useResolveCopy = () => (useAppLang() === 'en' ? en : es)
