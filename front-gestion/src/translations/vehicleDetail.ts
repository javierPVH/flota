import { useAppLang } from '@flota/ui/i18n'

const es = {
  // --- Cabecera y acciones ---------------------------------------------------
  backToOverview: '← Vista general',
  loading: 'Cargando…',
  registerKm: 'Registrar km',
  edit: 'Editar',
  changeState: 'Cambiar estado',
  substitution: 'Sustitución',
  convertToFleet: 'Convertir en flota',
  convertToFleetTitle: 'El tipo se fija al crear; esta es la única vía sustituto → flota',
  // Modal de conversión sustituto → flota (operación sin vuelta atrás).
  convertModalTitle: (plate: string) => `Convertir ${plate} en vehículo de flota`,
  convertIntro:
    'El vehículo dejará de ser de sustitución y pasará a ser uno más de la flota: podrá tener conductor asignado y sus propias sustituciones.',
  convertIrreversible:
    'No tiene vuelta atrás: el tipo se fija al crear el vehículo y esta es la única vía sustituto → flota.',
  convertBlockedByLink: (plate: string) =>
    `Ahora mismo está en un vínculo de sustitución con ${plate}. Cierra ese vínculo antes de convertirlo.`,
  convertConfirm: 'Convertir en flota',
  converting: 'Convirtiendo…',
  retire: 'Dar de baja',
  blockedTooltip: (plate: string) => `Bloqueado por sustitución — registra los km sobre ${plate}`,

  // --- Badges ----------------------------------------------------------------
  substituteBadge: '🔁 Vehículo de sustitución',
  substituteFrame: 'Vehículo de sustitución',
  unlimitedKmBadge: '∞ km ilimitados',
  driverBadge: (name: string) => `Conductor: ${name}`,
  noDriverBadge: 'Sin conductor',
  supervisorBadge: (name: string) => `Supervisor: ${name}`,
  // Callout de estado destacado (cuando el vehículo no está activo).
  statusLabel: 'Estado',

  // --- Banners ---------------------------------------------------------------
  blockedBanner: (reason: string, since: string) =>
    `Bloqueado por sustitución: ${reason} desde ${since} — sustituto`,
  blockedBannerNote: 'Las asignaciones y lecturas de km se hacen sobre el sustituto.',
  substitutedBy: 'Sustituido por',
  substitutes: 'Sustituye a',
  sinceDate: (date: string) => `desde ${date}.`,

  // --- KPIs ------------------------------------------------------------------
  monthlyCost: 'Coste mensual',
  penaltySub: (rate: string | number) => `Penalización ${rate} €/km`,
  contractFeeSub: 'Cuota del contrato',
  mileage: 'Kilometraje',
  manageMileage: 'Gestionar kilometraje',
  lastReadingSub: (date: string) => `Última lectura: ${date}`,
  noReadings: 'Sin lecturas',
  nextItv: 'Próxima ITV',
  insuranceExpiry: 'Vencimiento del seguro',
  noDateRecorded: 'Sin fecha registrada',
  contractEnd: 'Fin de contrato',
  noActiveContract: 'Sin contrato vigente',
  months: (n: number) => `${n} meses`,
  /** "en 3 meses" / "en 12 días" / "hace 6 días" — para los KPIs. */
  relative: (days: number) => {
    const abs = Math.abs(days)
    const unit = abs >= 60 ? `${Math.round(abs / 30)} meses` : `${abs} día${abs === 1 ? '' : 's'}`
    return days >= 0 ? `en ${unit}` : `hace ${unit}`
  },

  // --- Modal de detalle de un KPI (clic en una tarjeta) ----------------------
  kpiHint: 'Ver detalle e histórico',
  kpiTitle: (label: string, plate: string) => `${label} · ${plate}`,
  kpiCurrentData: 'Datos actuales',
  kpiRelatedHistory: 'Movimientos relacionados',
  kpiNoHistory: 'Sin movimientos relacionados todavía.',
  kpiMoreInHistory: (n: number) => `y ${n} más en el histórico completo…`,
  kpiClose: 'Cerrar',
  // Coste mensual
  kpiCostTotal: 'Coste total del contrato',
  kpiCostTotalSub: 'estimado: cuota × duración',
  kpiCostPenalty: 'Penalización estimada por exceso de km',
  kpiCostInvoicesNote: 'Las facturas emitidas están en el bloque «Facturas» de la ficha.',
  // ITV
  kpiItvLast: 'Última ITV registrada',
  kpiItvResult: 'Resultado',
  kpiItvCost: 'Coste',
  kpiItvNone: 'Sin ITV registradas.',
  // Seguro
  kpiInsuranceLast: 'Última renovación registrada',
  kpiInsuranceNone: 'Sin renovaciones registradas.',
  kpiInsuranceDocsNote: 'La póliza y sus documentos están en el bloque «Documentos» de la ficha.',

  // --- Tarjeta de km contratados --------------------------------------------
  contractedKmTitle: 'Kilómetros contratados',
  kmSwitchAria: 'Vista de km contratados',
  annualView: 'Anual',
  contractView: 'Contrato completo',
  levelLabel: {
    within: 'Dentro',
    watch: 'A vigilar',
    over: 'Riesgo de exceso',
  } as Record<string, string>,
  annualCaption: (year: number, total: number, start: string, end: string) =>
    `Cupo anual proporcional · Año ${year} de ${total} (${start} → ${end})`,
  contractCaption: (kmStr: string, years: number) =>
    `Total del contrato · ${kmStr} en ${years} año${years === 1 ? '' : 's'}`,
  kmProgressLegend: (driven: string, limit: string, pct: number, remaining: string, annual: boolean) =>
    `${driven} de ${limit} (${pct}%) · quedan ${remaining}${annual ? ' este año' : ''}`,
  monthlyAvg: 'Media mensual',
  annualAllowance: 'Cupo anual',
  contractedRate: 'Ritmo contratado',
  perMonth: (kmStr: string) => `${kmStr}/mes`,
  annualProjection: 'Proyección anual',
  endProjection: 'Proyección a fin',
  overageLead: (annual: boolean) =>
    `Exceso previsto ${annual ? 'este año' : 'a fin de contrato'} de`,
  penaltyEstimate: (eurStr: string) => ` — penalización estimada ${eurStr}`,
  noPenaltyRate: ' (el contrato no tiene €/km para estimar la penalización)',

  // --- Datos técnicos --------------------------------------------------------
  techTitle: 'Datos técnicos',
  vin: 'Bastidor (VIN)',
  year: 'Año',
  registrationDate: 'Matriculación',
  fuel: 'Combustible',
  type: 'Tipo',
  consumption: 'Consumo',
  initialOdometer: 'Odómetro inicial',
  supervisor: 'Supervisor',

  // --- Contrato --------------------------------------------------------------
  contractTitle: 'Contrato',
  ownership: 'Propiedad',
  monthlyFee: 'Cuota mensual',
  start: 'Inicio',
  plannedEnd: 'Fin previsto',
  duration: 'Duración',
  contractedKm: 'Km contratados',
  quotaPerYear: (kmStr: string) => ` · cupo ${kmStr}/año`,
  penalty: 'Penalización',
  noActiveContractDot: 'Sin contrato vigente.',

  // --- Histórico -------------------------------------------------------------
  historyTitle: 'Histórico',
  showLess: 'Ver menos',
  showFullHistory: (n: number) => `Ver histórico completo (${n})`,
  noEventsYet: 'Sin eventos todavía.',
  historyCount: (n: number) => `${n} movimiento${n === 1 ? '' : 's'}`,
  noMatchingHistory: 'Sin movimientos de este origen.',
  // Histórico exhaustivo: filtro por origen + etiquetas de modelo/acción/campo.
  historyFilterLabel: 'Origen',
  historyAll: 'Todos',
  byActor: (name: string) => `Por ${name}`,
  doneByLabel: 'Realizado por',
  systemActor: 'Sistema',
  // Desglose de campos: plegado por defecto en las altas (vuelcan la ficha
  // entera) y en los cambios largos.
  historyChanges: (n: number) => `${n} campo${n === 1 ? '' : 's'} modificado${n === 1 ? '' : 's'}`,
  historyCreateFields: (n: number) => `Datos del alta (${n})`,
  // Ráfagas del mismo tipo el mismo día (p. ej. 11 lecturas sembradas de golpe).
  historyGroupTitle: (n: number, action: string) => `${n} × ${action}`,
  historyGroupOpen: (n: number) => `Ver el detalle (${n})`,
  historyDayItems: (n: number) => `${n} movimiento${n === 1 ? '' : 's'}`,
  boolYes: 'Sí',
  boolNo: 'No',
  auditModels: {
    vehicle: 'Vehículo',
    contract: 'Contrato',
    assignment: 'Conductor',
    vehicleusage: 'Reparto de uso',
    vehiclelink: 'Sustitución',
    kmreading: 'Kilómetros',
    invoice: 'Factura',
    incident: 'Incidencia',
    document: 'Documento',
    event: 'Evento',
  } as Record<string, string>,
  auditModelOther: 'Otro',
  auditActions: {
    create: 'Alta',
    update: 'Modificación',
    delete: 'Eliminación',
    access: 'Acceso',
  } as Record<string, string>,
  fieldLabels: {
    state: 'Estado',
    driver: 'Conductor',
    supervisor: 'Supervisor',
    next_itv_date: 'Próxima ITV',
    insurance_expiry_date: 'Vencimiento del seguro',
    km_start: 'Odómetro inicial',
    km_end: 'Odómetro final',
    plate: 'Matrícula',
    brand: 'Marca',
    model: 'Modelo',
    version: 'Versión',
    vin: 'Bastidor',
    year: 'Año',
    fuel: 'Combustible',
    type: 'Tipo',
    property: 'Propiedad',
    business_use: 'Uso',
    consumption: 'Consumo',
    market_segment: 'Segmento',
    size: 'Tamaño',
    veh_use: 'Uso del vehículo',
    unlimited_km: 'Km ilimitados',
    is_substitute: 'De sustitución',
    registration_date: 'Matriculación',
    company: 'Empresa',
    month_fee: 'Cuota mensual',
    contract_km: 'Km contratados',
    contract_time: 'Duración (meses)',
    penalty_per_km: 'Penalización €/km',
    start_date: 'Inicio',
    planned_end_date: 'Fin previsto',
    end_date: 'Fin real',
    contract_number: 'Nº de contrato',
    renting: 'Renting',
    drive_url: 'Enlace en Drive',
    status: 'Estado',
    usage_percent: 'Porcentaje de uso',
    km_reading: 'Odómetro',
    reading_date: 'Fecha de lectura',
    estimated: 'Estimada',
    expiry_date: 'Caducidad',
    notes: 'Notas',
    code: 'Código',
    amount: 'Importe',
    date: 'Fecha',
    reason: 'Motivo',
    description: 'Descripción',
    cost: 'Coste',
    paid: 'Pagada',
    result: 'Resultado',
    next_due: 'Próxima ITV',
  } as Record<string, string>,

  // --- Tarjeta de facturas ---------------------------------------------------
  invoicesTitle: 'Facturas',
  manageInvoices: 'Gestionar facturas',
  noInvoices: 'Sin facturas todavía.',
  invoiceCount: 'Nº de facturas',
  invoiceTotal: 'Total facturado',
  invoiceOpenPdf: 'PDF',
  invoicesMore: (n: number) => `y ${n} más…`,
  invoicesModalTitle: (plate: string) => `Facturas de ${plate}`,

  // --- Contrato · enlace de Drive --------------------------------------------
  contractDrive: 'Contrato en Drive',
  contractDriveOpen: 'Abrir',
  contractDriveEdit: 'Editar enlace',
  contractDriveAdd: 'Añadir enlace',
  contractDriveNone: 'Sin enlace',
  contractDriveModalTitle: 'Enlace del contrato en Drive',
  contractDriveFieldLabel: 'URL de la carpeta o el fichero (https)',
  contractDrivePlaceholder: 'https://drive.google.com/…',
  contractDriveSave: 'Guardar enlace',
  errContractDrive: 'No se pudo guardar el enlace del contrato.',

  // --- Etiquetas de dominio (antes constantes de módulo) ---------------------
  stateOptions: [
    { value: 'active', label: 'Activo' },
    { value: 'maintenance', label: 'En mantenimiento' },
    { value: 'itv', label: 'En ITV' },
    { value: 'broken', label: 'Averiado' },
  ],
  linkReasonOptions: [
    { value: 'breakdown', label: 'Avería' },
    { value: 'maintenance', label: 'Mantenimiento' },
    { value: 'tires', label: 'Neumáticos' },
    { value: 'inspection', label: 'ITV' },
    { value: 'accident', label: 'Accidente' },
  ],
  useLabel: {
    on_project: 'Proyecto',
    personal: 'Personal',
    works: 'Obras',
  } as Record<string, string>,
  fuelLabel: {
    gasoline: 'Gasolina',
    diesel: 'Diésel',
    LPG: 'GLP',
    hybrid: 'Híbrido',
    other: 'Otro',
  } as Record<string, string>,
  typeLabel: { car: 'Turismo', van: 'Furgoneta' } as Record<string, string>,
  propertyLabel: { propio: 'Propio', renting: 'Renting' } as Record<string, string>,

  // --- Modal de estado -------------------------------------------------------
  stateModalTitle: (plate: string) => `Cambiar estado de ${plate}`,
  newState: 'Nuevo estado',
  stateReasonLabel: 'Motivo (queda en el evento)',
  stateModalNote:
    'El cambio queda registrado como evento con fecha. Algunos estados también los mueve el sistema (p. ej. avería desde incidencias). La baja tiene su propio flujo.',
  cancel: 'Cancelar',
  save: 'Guardar',
  saving: 'Guardando…',

  // --- Modal de baja ---------------------------------------------------------
  bajaModalTitle: (plate: string) => `Dar de baja ${plate}`,
  bajaHasDriver: '⚠️ Tiene conductor asignado:',
  bajaLinkWarn: {
    pre: '⚠️ Tiene un vínculo de sustitución ',
    bold: 'activo',
    post: ' (ciérralo antes si procede).',
  },
  bajaDateLabel: 'Fecha de baja',
  reasonRequired: 'Motivo *',
  bajaNote: {
    pre: 'El vehículo pasa a ',
    bold: 'baja',
    post: ' conservando su histórico; deja de salir en el listado por defecto y no admite nuevas operaciones.',
  },
  confirmBaja: 'Confirmar baja',

  // --- Modal de vinculación --------------------------------------------------
  linkModalTitle: (plate: string) => `Sustitución de ${plate}`,
  // Cabecera del vínculo vigente (tarjeta de datos, no párrafo).
  linkActiveTitle: 'Vínculo activo',
  linkSinceDays: (date: string, days: number) =>
    `Desde ${date} · ${days} día${days === 1 ? '' : 's'}`,
  onlyOneSubstitute: 'Solo puede haber un sustituto activo por principal.',
  closing: 'Cerrando…',
  // Cierre del vínculo: hoy, con fecha anterior o programado a futuro.
  closeSectionTitle: 'Cerrar el vínculo',
  closeWhenLabel: 'Cuándo',
  closeToday: 'Hoy',
  closeOtherDate: 'Otra fecha',
  closeDateLabel: 'Fecha de fin',
  closeHintPast: 'Cierre con efecto retroactivo: el vínculo constará como terminado ese día.',
  closeHintToday: 'El sustituto deja de cubrir hoy mismo.',
  closeHintFuture:
    'Cierre programado: el sustituto sigue cubriendo hasta esa fecha y el principal continúa bloqueado.',
  closeBeforeStart: (date: string) => `La fecha de fin no puede ser anterior al inicio (${date}).`,
  closeDateRequired: 'Indica la fecha de fin.',
  closeMinDate: (date: string) =>
    `El calendario empieza el ${date}: un vínculo no puede terminar antes de empezar.`,
  scheduledClose: (date: string) => `Cierre programado para el ${date}.`,
  cancelScheduledClose: 'Anular el cierre programado',
  confirmCancelScheduled: '¿Anular el cierre programado y dejar el vínculo abierto?',
  errCancelScheduled: 'No se pudo anular el cierre programado.',
  substituteVehicle: 'Vehículo de sustitución',
  choosePlaceholder: '— Elegir —',
  unavailable: 'no disponible',
  reason: 'Motivo',
  linkVerb: 'Vincular',
  linking: 'Vinculando…',
  linkHistoryTitle: 'Histórico de vínculos',
  linkNoEnd: 'sin cerrar',
  activeWord: 'activo',
  confirmCloseLink: '¿Cerrar el vínculo de sustitución con fecha de hoy?',
  closeLink: 'Cerrar vínculo',

  // --- Modal de km -----------------------------------------------------------
  kmModalTitle: (plate: string) => `Kilometraje de ${plate}`,
  lastReadingLabel: 'Última lectura:',
  odometerNote: 'El odómetro no puede retroceder.',
  odometerLabel: 'Odómetro (km acumulados)',
  dateLabel: 'Fecha',
  saveReading: 'Guardar lectura',
  // Aviso de antigüedad de la última lectura (verde / ámbar / rojo).
  kmStaleDays: (n: number) => `${n} día${n === 1 ? '' : 's'} sin lectura`,
  kmStaleSince: (date: string) => `Última lectura el ${date}.`,
  kmStaleNever: 'Sin ninguna lectura registrada',
  kmStaleNeverSub: 'Este vehículo no tiene todavía ninguna lectura de odómetro.',
  kmStaleOk: 'Al día.',
  kmStaleWarn: 'Conviene reclamar una lectura al conductor.',
  kmStaleDanger: 'Lectura vencida: reclámala al conductor.',
  kmClaimByEmail: 'Reclamar por correo',
  kmEmailModalTitle: (plate: string) => `Reclamar lectura · ${plate}`,
  // Listado de lecturas agrupadas por año.
  kmReadingsTotal: (n: number) => `${n} lectura${n === 1 ? '' : 's'} registradas`,
  kmYearCount: (n: number) => `${n} lectura${n === 1 ? '' : 's'}`,
  kmYearDelta: (kmStr: string) => `+${kmStr} en el año`,
  kmNoReadings: 'Sin lecturas todavía.',
  kmNewReadingTitle: 'Nueva lectura',
  kmEstimatedTag: 'estimada',

  // --- Errores ---------------------------------------------------------------
  errLoadVehicle: 'No se pudo cargar el vehículo.',
  errChangeState: 'No se pudo cambiar el estado.',
  errBaja: 'No se pudo dar de baja.',
  errCreateLink: 'No se pudo crear el vínculo (¿ya hay un sustituto activo?).',
  errCloseLink: 'No se pudo cerrar el vínculo.',
  errKmReading: 'No se pudo registrar la lectura.',
  errConvertFleet: 'No se pudo convertir en flota.',
  errChooseSubstitute: 'Elige el vehículo de sustitución.',
  partialLoadError:
    'Algunos bloques de la ficha no se pudieron cargar (pueden verse vacíos).',
  partialLoadRetry: 'Reintentar',

  // --- Ficha técnica: filas nuevas (GAP-3/GAP-4) -----------------------------
  fuelCardRow: 'Tarjeta de combustible',
  siteRow: 'Sede',
  yes: 'Sí',
  no: 'No',

  // --- GAP-2 · Consumo de combustible -----------------------------------------
  fuelConsumptionTitle: 'Consumo de combustible',
  fuelAddMonth: 'Añadir mes',
  fuelMonth: 'Mes',
  fuelLiters: 'Litros',
  fuelAmount: 'Importe (€)',
  fuelSourceLabel: 'Origen',
  fuelSourceOptions: [
    { value: 'fuel_card', label: 'Tarjeta de combustible' },
    { value: 'manual', label: 'Manual' },
    { value: 'import', label: 'Importación' },
  ],
  noFuelRows: 'Sin consumos registrados. La serie mensual alimenta el informe de emisiones.',
  fuelModalTitle: (plate: string) => `Consumo de ${plate}`,
  fuelDeleteSubject: (mes: string) => `el consumo de ${mes}`,
  fuelMonthsCount: (n: number) => `${n} ${n === 1 ? 'mes' : 'meses'}`,
  errFuelSave: 'No se pudo guardar el consumo.',
  errFuelDelete: 'No se pudo desactivar el consumo.',

  // --- GAP-8 · Mantenimiento programado ---------------------------------------
  maintenanceTitle: 'Mantenimiento programado',
  maintenanceAdd: 'Nuevo plan',
  maintenanceName: 'Nombre',
  maintenanceNamePlaceholder: 'p. ej. Revisión general',
  maintenanceEveryKm: 'Cada (km)',
  maintenanceEveryMonths: 'Cada (meses)',
  maintenanceLastDate: 'Último realizado (fecha)',
  maintenanceLastKm: 'Último realizado (km)',
  maintenanceNotes: 'Notas',
  maintenanceCycle: (km: number | null, meses: number | null) => {
    const partes = []
    if (km) partes.push(`${km.toLocaleString()} km`)
    if (meses) partes.push(`${meses} meses`)
    return `cada ${partes.join(' / ') || '—'}`
  },
  maintenanceHint:
    'El chequeo diario abre una alerta al acercarse el ciclo (por km o por meses) y la escala al vencer.',
  noMaintenancePlans: 'Sin planes de mantenimiento.',
  maintenanceModalTitle: (plate: string) => `Plan de mantenimiento de ${plate}`,
  maintenanceDeleteSubject: (nombre: string) => `el plan «${nombre}»`,
  maintenancePlansCount: (n: number) => `${n} ${n === 1 ? 'plan' : 'planes'}`,
  errMaintenanceSave: 'No se pudo guardar el plan.',
  errMaintenanceDelete: 'No se pudo desactivar el plan.',

  // --- GAP-7 · Devolución guiada ----------------------------------------------
  returnBtn: 'Devolver',
  returnModalTitle: (plate: string) => `Devolver ${plate}`,
  returnIntro:
    'Una sola operación: registra la lectura final, cierra el contrato vigente, finaliza las asignaciones y da el vehículo de baja con su evento.',
  returnKmEnd: 'Km de devolución',
  returnDate: 'Fecha de devolución',
  returnReason: 'Motivo',
  returnReasonPlaceholder: 'p. ej. Fin del contrato de renting',
  returnEstimate: (exceso: number, penalizacion: string | null) =>
    exceso > 0
      ? `Exceso estimado: ${exceso.toLocaleString()} km sobre lo contratado` +
        (penalizacion ? ` → ~${penalizacion} € de penalización.` : '.')
      : 'Dentro de los km contratados.',
  returnConfirm: 'Devolver vehículo',
  returning: 'Devolviendo…',
  returnDoneTitle: 'Vehículo devuelto',
  returnDoneKm: 'Km de devolución',
  returnDoneAssignments: 'Asignaciones finalizadas',
  returnDoneContract: 'Contrato cerrado',
  returnDoneOverage: 'Exceso sobre lo contratado',
  returnDonePenalty: 'Penalización estimada',
  returnClose: 'Cerrar',
  errReturn: 'No se pudo devolver el vehículo.',
}

const en: typeof es = {
  // --- Header and actions ----------------------------------------------------
  backToOverview: '← Overview',
  loading: 'Loading…',
  registerKm: 'Log mileage',
  edit: 'Edit',
  changeState: 'Change status',
  substitution: 'Substitution',
  convertToFleet: 'Convert to fleet',
  convertToFleetTitle: 'Type is set at creation; this is the only substitute → fleet path',
  convertModalTitle: (plate) => `Convert ${plate} into a fleet vehicle`,
  convertIntro:
    'The vehicle stops being a substitute and becomes a regular fleet vehicle: it can have an assigned driver and its own substitutions.',
  convertIrreversible:
    'This cannot be undone: the type is set when the vehicle is created and this is the only substitute → fleet path.',
  convertBlockedByLink: (plate) =>
    `It is currently in a substitution link with ${plate}. Close that link before converting it.`,
  convertConfirm: 'Convert to fleet',
  converting: 'Converting…',
  retire: 'Retire',
  blockedTooltip: (plate) => `Blocked by substitution — log mileage on ${plate}`,

  // --- Badges ----------------------------------------------------------------
  substituteBadge: '🔁 Substitute vehicle',
  substituteFrame: 'Substitute vehicle',
  unlimitedKmBadge: '∞ Unlimited km',
  driverBadge: (name) => `Driver: ${name}`,
  noDriverBadge: 'No driver',
  supervisorBadge: (name) => `Supervisor: ${name}`,
  statusLabel: 'Status',

  // --- Banners ---------------------------------------------------------------
  blockedBanner: (reason, since) =>
    `Blocked by substitution: ${reason} since ${since} — substitute`,
  blockedBannerNote: 'Assignments and km readings go on the substitute.',
  substitutedBy: 'Substituted by',
  substitutes: 'Substitute for',
  sinceDate: (date) => `since ${date}.`,

  // --- KPIs ------------------------------------------------------------------
  monthlyCost: 'Monthly cost',
  penaltySub: (rate) => `Penalty ${rate} €/km`,
  contractFeeSub: 'Contract fee',
  mileage: 'Mileage',
  manageMileage: 'Manage mileage',
  lastReadingSub: (date) => `Last reading: ${date}`,
  noReadings: 'No readings',
  nextItv: 'Next MOT',
  insuranceExpiry: 'Insurance expiry',
  noDateRecorded: 'No date recorded',
  contractEnd: 'Contract end',
  noActiveContract: 'No active contract',
  months: (n) => `${n} months`,
  /** "in 3 months" / "in 12 days" / "6 days ago" — for the KPIs. */
  relative: (days) => {
    const abs = Math.abs(days)
    const unit = abs >= 60 ? `${Math.round(abs / 30)} months` : `${abs} day${abs === 1 ? '' : 's'}`
    return days >= 0 ? `in ${unit}` : `${unit} ago`
  },

  // --- KPI detail modal (click on a card) -----------------------------------
  kpiHint: 'View detail and history',
  kpiTitle: (label, plate) => `${label} · ${plate}`,
  kpiCurrentData: 'Current data',
  kpiRelatedHistory: 'Related activity',
  kpiNoHistory: 'No related activity yet.',
  kpiMoreInHistory: (n) => `and ${n} more in the full history…`,
  kpiClose: 'Close',
  // Monthly cost
  kpiCostTotal: 'Total contract cost',
  kpiCostTotalSub: 'estimated: fee × duration',
  kpiCostPenalty: 'Estimated penalty for excess km',
  kpiCostInvoicesNote: 'Issued invoices live in the “Invoices” block of this page.',
  // MOT
  kpiItvLast: 'Last MOT logged',
  kpiItvResult: 'Result',
  kpiItvCost: 'Cost',
  kpiItvNone: 'No MOT logged.',
  // Insurance
  kpiInsuranceLast: 'Last renewal logged',
  kpiInsuranceNone: 'No renewals logged.',
  kpiInsuranceDocsNote: 'The policy and its documents live in the “Documents” block of this page.',

  // --- Contracted mileage card ----------------------------------------------
  contractedKmTitle: 'Contracted mileage',
  kmSwitchAria: 'Contracted km view',
  annualView: 'Annual',
  contractView: 'Full contract',
  levelLabel: {
    within: 'Within limit',
    watch: 'Watch',
    over: 'Overage risk',
  },
  annualCaption: (year, total, start, end) =>
    `Prorated annual allowance · Year ${year} of ${total} (${start} → ${end})`,
  contractCaption: (kmStr, years) =>
    `Contract total · ${kmStr} over ${years} year${years === 1 ? '' : 's'}`,
  kmProgressLegend: (driven, limit, pct, remaining, annual) =>
    `${driven} of ${limit} (${pct}%) · ${remaining} left${annual ? ' this year' : ''}`,
  monthlyAvg: 'Monthly average',
  annualAllowance: 'Annual allowance',
  contractedRate: 'Contracted rate',
  perMonth: (kmStr) => `${kmStr}/month`,
  annualProjection: 'Annual projection',
  endProjection: 'Projection at end',
  overageLead: (annual) => `Projected overage ${annual ? 'this year' : 'at contract end'} of`,
  penaltyEstimate: (eurStr) => ` — estimated penalty ${eurStr}`,
  noPenaltyRate: ' (the contract has no €/km rate to estimate the penalty)',

  // --- Technical data --------------------------------------------------------
  techTitle: 'Technical data',
  vin: 'Chassis (VIN)',
  year: 'Year',
  registrationDate: 'Registration',
  fuel: 'Fuel',
  type: 'Type',
  consumption: 'Consumption',
  initialOdometer: 'Initial odometer',
  supervisor: 'Supervisor',

  // --- Contract --------------------------------------------------------------
  contractTitle: 'Contract',
  ownership: 'Ownership',
  monthlyFee: 'Monthly fee',
  start: 'Start',
  plannedEnd: 'Planned end',
  duration: 'Duration',
  contractedKm: 'Contracted km',
  quotaPerYear: (kmStr) => ` · allowance ${kmStr}/year`,
  penalty: 'Penalty',
  noActiveContractDot: 'No active contract.',

  // --- History ---------------------------------------------------------------
  historyTitle: 'History',
  showLess: 'Show less',
  showFullHistory: (n) => `Show full history (${n})`,
  noEventsYet: 'No events yet.',
  historyCount: (n) => `${n} event${n === 1 ? '' : 's'}`,
  noMatchingHistory: 'No movements from this source.',
  historyFilterLabel: 'Source',
  historyAll: 'All',
  byActor: (name) => `By ${name}`,
  doneByLabel: 'Performed by',
  systemActor: 'System',
  historyChanges: (n) => `${n} field${n === 1 ? '' : 's'} changed`,
  historyCreateFields: (n) => `Creation data (${n})`,
  historyGroupTitle: (n, action) => `${n} × ${action}`,
  historyGroupOpen: (n) => `View details (${n})`,
  historyDayItems: (n) => `${n} entr${n === 1 ? 'y' : 'ies'}`,
  boolYes: 'Yes',
  boolNo: 'No',
  auditModels: {
    vehicle: 'Vehicle',
    contract: 'Contract',
    assignment: 'Driver',
    vehicleusage: 'Usage split',
    vehiclelink: 'Substitution',
    kmreading: 'Mileage',
    invoice: 'Invoice',
    incident: 'Incident',
    document: 'Document',
    event: 'Event',
  },
  auditModelOther: 'Other',
  auditActions: {
    create: 'Created',
    update: 'Updated',
    delete: 'Deleted',
    access: 'Accessed',
  },
  fieldLabels: {
    state: 'Status',
    driver: 'Driver',
    supervisor: 'Supervisor',
    next_itv_date: 'Next MOT',
    insurance_expiry_date: 'Insurance expiry',
    km_start: 'Initial odometer',
    km_end: 'Final odometer',
    plate: 'Plate',
    brand: 'Brand',
    model: 'Model',
    version: 'Version',
    vin: 'Chassis',
    year: 'Year',
    fuel: 'Fuel',
    type: 'Type',
    property: 'Ownership',
    business_use: 'Use',
    consumption: 'Consumption',
    market_segment: 'Segment',
    size: 'Size',
    veh_use: 'Vehicle use',
    unlimited_km: 'Unlimited km',
    is_substitute: 'Substitute',
    registration_date: 'Registration',
    company: 'Company',
    month_fee: 'Monthly fee',
    contract_km: 'Contracted km',
    contract_time: 'Duration (months)',
    penalty_per_km: 'Penalty €/km',
    start_date: 'Start',
    planned_end_date: 'Planned end',
    end_date: 'Actual end',
    contract_number: 'Contract no.',
    renting: 'Leasing',
    drive_url: 'Drive link',
    status: 'Status',
    usage_percent: 'Usage percent',
    km_reading: 'Odometer',
    reading_date: 'Reading date',
    estimated: 'Estimated',
    expiry_date: 'Expiry',
    notes: 'Notes',
    code: 'Code',
    amount: 'Amount',
    date: 'Date',
    reason: 'Reason',
    description: 'Description',
    cost: 'Cost',
    paid: 'Paid',
    result: 'Result',
    next_due: 'Next MOT',
  },

  // --- Invoices card ---------------------------------------------------------
  invoicesTitle: 'Invoices',
  manageInvoices: 'Manage invoices',
  noInvoices: 'No invoices yet.',
  invoiceCount: 'Invoices',
  invoiceTotal: 'Total invoiced',
  invoiceOpenPdf: 'PDF',
  invoicesMore: (n) => `and ${n} more…`,
  invoicesModalTitle: (plate) => `Invoices for ${plate}`,

  // --- Contract · Drive link -------------------------------------------------
  contractDrive: 'Contract in Drive',
  contractDriveOpen: 'Open',
  contractDriveEdit: 'Edit link',
  contractDriveAdd: 'Add link',
  contractDriveNone: 'No link',
  contractDriveModalTitle: 'Contract link in Drive',
  contractDriveFieldLabel: 'Folder or file URL (https)',
  contractDrivePlaceholder: 'https://drive.google.com/…',
  contractDriveSave: 'Save link',
  errContractDrive: 'Could not save the contract link.',

  // --- Domain labels (formerly module constants) -----------------------------
  stateOptions: [
    { value: 'active', label: 'Active' },
    { value: 'maintenance', label: 'In maintenance' },
    { value: 'itv', label: 'At MOT' },
    { value: 'broken', label: 'Broken down' },
  ],
  linkReasonOptions: [
    { value: 'breakdown', label: 'Breakdown' },
    { value: 'maintenance', label: 'Maintenance' },
    { value: 'tires', label: 'Tyres' },
    { value: 'inspection', label: 'MOT' },
    { value: 'accident', label: 'Accident' },
  ],
  useLabel: {
    on_project: 'Project',
    personal: 'Personal',
    works: 'Works',
  },
  fuelLabel: {
    gasoline: 'Petrol',
    diesel: 'Diesel',
    LPG: 'LPG',
    hybrid: 'Hybrid',
    other: 'Other',
  },
  typeLabel: { car: 'Car', van: 'Van' },
  propertyLabel: { propio: 'Owned', renting: 'Leased' },

  // --- Status modal ----------------------------------------------------------
  stateModalTitle: (plate) => `Change status of ${plate}`,
  newState: 'New status',
  stateReasonLabel: 'Reason (recorded in the event)',
  stateModalNote:
    'The change is recorded as a dated event. Some statuses are also set by the system (e.g. breakdown from incidents). Retirement has its own flow.',
  cancel: 'Cancel',
  save: 'Save',
  saving: 'Saving…',

  // --- Retirement modal ------------------------------------------------------
  bajaModalTitle: (plate) => `Retire ${plate}`,
  bajaHasDriver: '⚠️ Has an assigned driver:',
  bajaLinkWarn: {
    pre: '⚠️ Has an ',
    bold: 'active',
    post: ' substitution link (close it first if appropriate).',
  },
  bajaDateLabel: 'Retirement date',
  reasonRequired: 'Reason *',
  bajaNote: {
    pre: 'The vehicle becomes ',
    bold: 'retired',
    post: ' keeping its history; it no longer appears in the default list and accepts no new operations.',
  },
  confirmBaja: 'Confirm retirement',

  // --- Substitution modal ----------------------------------------------------
  linkModalTitle: (plate) => `Substitution for ${plate}`,
  linkActiveTitle: 'Active link',
  linkSinceDays: (date, days) => `Since ${date} · ${days} day${days === 1 ? '' : 's'}`,
  onlyOneSubstitute: 'Only one active substitute is allowed per main vehicle.',
  closing: 'Closing…',
  closeSectionTitle: 'Close the link',
  closeWhenLabel: 'When',
  closeToday: 'Today',
  closeOtherDate: 'Another date',
  closeDateLabel: 'End date',
  closeHintPast: 'Backdated close: the link will show as ended on that day.',
  closeHintToday: 'The substitute stops covering today.',
  closeHintFuture:
    'Scheduled close: the substitute keeps covering until that date and the main vehicle stays blocked.',
  closeBeforeStart: (date) => `The end date cannot be earlier than the start (${date}).`,
  closeDateRequired: 'Enter the end date.',
  closeMinDate: (date) =>
    `The calendar starts on ${date}: a link cannot end before it began.`,
  scheduledClose: (date) => `Close scheduled for ${date}.`,
  cancelScheduledClose: 'Cancel the scheduled close',
  confirmCancelScheduled: 'Cancel the scheduled close and leave the link open?',
  errCancelScheduled: 'Could not cancel the scheduled close.',
  substituteVehicle: 'Substitute vehicle',
  choosePlaceholder: '— Choose —',
  unavailable: 'unavailable',
  reason: 'Reason',
  linkVerb: 'Link',
  linking: 'Linking…',
  linkHistoryTitle: 'Link history',
  linkNoEnd: 'open',
  activeWord: 'active',
  confirmCloseLink: 'Close the substitution link as of today?',
  closeLink: 'Close link',

  // --- Mileage modal ---------------------------------------------------------
  kmModalTitle: (plate) => `Mileage of ${plate}`,
  lastReadingLabel: 'Last reading:',
  odometerNote: 'The odometer cannot go backwards.',
  odometerLabel: 'Odometer (cumulative km)',
  dateLabel: 'Date',
  saveReading: 'Save reading',
  kmStaleDays: (n) => `${n} day${n === 1 ? '' : 's'} without a reading`,
  kmStaleSince: (date) => `Last reading on ${date}.`,
  kmStaleNever: 'No reading logged yet',
  kmStaleNeverSub: 'This vehicle has no odometer reading yet.',
  kmStaleOk: 'Up to date.',
  kmStaleWarn: 'Worth chasing the driver for a reading.',
  kmStaleDanger: 'Reading overdue: chase the driver.',
  kmClaimByEmail: 'Request by email',
  kmEmailModalTitle: (plate) => `Request reading · ${plate}`,
  kmReadingsTotal: (n) => `${n} reading${n === 1 ? '' : 's'} logged`,
  kmYearCount: (n) => `${n} reading${n === 1 ? '' : 's'}`,
  kmYearDelta: (kmStr) => `+${kmStr} in the year`,
  kmNoReadings: 'No readings yet.',
  kmNewReadingTitle: 'New reading',
  kmEstimatedTag: 'estimated',

  // --- Errors ----------------------------------------------------------------
  errLoadVehicle: 'Could not load the vehicle.',
  errChangeState: 'Could not change the status.',
  errBaja: 'Could not retire the vehicle.',
  errCreateLink: 'Could not create the link (is there already an active substitute?).',
  errCloseLink: 'Could not close the link.',
  errKmReading: 'Could not save the reading.',
  errConvertFleet: 'Could not convert to fleet.',
  errChooseSubstitute: 'Choose the substitute vehicle.',
  partialLoadError: 'Some blocks of this page failed to load (they may look empty).',
  partialLoadRetry: 'Retry',

  fuelCardRow: 'Fuel card',
  siteRow: 'Site',
  yes: 'Yes',
  no: 'No',

  fuelConsumptionTitle: 'Fuel consumption',
  fuelAddMonth: 'Add month',
  fuelMonth: 'Month',
  fuelLiters: 'Litres',
  fuelAmount: 'Amount (€)',
  fuelSourceLabel: 'Source',
  fuelSourceOptions: [
    { value: 'fuel_card', label: 'Fuel card' },
    { value: 'manual', label: 'Manual' },
    { value: 'import', label: 'Import' },
  ],
  noFuelRows: 'No consumption recorded yet. The monthly series feeds the emissions report.',
  fuelModalTitle: (plate) => `Fuel consumption for ${plate}`,
  fuelDeleteSubject: (mes) => `the ${mes} consumption`,
  fuelMonthsCount: (n) => `${n} ${n === 1 ? 'month' : 'months'}`,
  errFuelSave: 'Could not save the consumption.',
  errFuelDelete: 'Could not deactivate the consumption.',

  maintenanceTitle: 'Scheduled maintenance',
  maintenanceAdd: 'New plan',
  maintenanceName: 'Name',
  maintenanceNamePlaceholder: 'e.g. General service',
  maintenanceEveryKm: 'Every (km)',
  maintenanceEveryMonths: 'Every (months)',
  maintenanceLastDate: 'Last done (date)',
  maintenanceLastKm: 'Last done (km)',
  maintenanceNotes: 'Notes',
  maintenanceCycle: (km, meses) => {
    const partes = []
    if (km) partes.push(`${km.toLocaleString()} km`)
    if (meses) partes.push(`${meses} months`)
    return `every ${partes.join(' / ') || '—'}`
  },
  maintenanceHint:
    'The daily check opens an alert as the cycle approaches (by km or months) and escalates it when due.',
  noMaintenancePlans: 'No maintenance plans.',
  maintenanceModalTitle: (plate) => `Maintenance plan for ${plate}`,
  maintenanceDeleteSubject: (nombre) => `the plan “${nombre}”`,
  maintenancePlansCount: (n) => `${n} ${n === 1 ? 'plan' : 'plans'}`,
  errMaintenanceSave: 'Could not save the plan.',
  errMaintenanceDelete: 'Could not deactivate the plan.',

  returnBtn: 'Return',
  returnModalTitle: (plate) => `Return ${plate}`,
  returnIntro:
    'One operation: records the final reading, closes the current contract, ends the assignments and retires the vehicle with its event.',
  returnKmEnd: 'Return odometer (km)',
  returnDate: 'Return date',
  returnReason: 'Reason',
  returnReasonPlaceholder: 'e.g. Leasing contract ended',
  returnEstimate: (exceso, penalizacion) =>
    exceso > 0
      ? `Estimated overage: ${exceso.toLocaleString()} km over the contract` +
        (penalizacion ? ` → ~€${penalizacion} penalty.` : '.')
      : 'Within the contracted km.',
  returnConfirm: 'Return vehicle',
  returning: 'Returning…',
  returnDoneTitle: 'Vehicle returned',
  returnDoneKm: 'Return odometer',
  returnDoneAssignments: 'Assignments ended',
  returnDoneContract: 'Contract closed',
  returnDoneOverage: 'Overage vs contract',
  returnDonePenalty: 'Estimated penalty',
  returnClose: 'Close',
  errReturn: 'Could not return the vehicle.',
}

const dict = { es, en }

/** Copia de la ficha de vehículo en el idioma activo (UX1). */
export function useVehicleDetailCopy() {
  return dict[useAppLang()]
}
