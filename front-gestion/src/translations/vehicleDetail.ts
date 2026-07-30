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
  retire: 'Dar de baja',
  blockedTooltip: (plate: string) => `Bloqueado por sustitución — registra los km sobre ${plate}`,

  // --- Badges ----------------------------------------------------------------
  substituteBadge: '🔁 Vehículo de sustitución',
  unlimitedKmBadge: '∞ km ilimitados',
  driverBadge: (name: string) => `Conductor: ${name}`,
  noDriverBadge: 'Sin conductor',

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
  linkActive: {
    pre: 'Vínculo ',
    bold: 'activo',
    post: (date: string, reason: string) => ` desde ${date} (${reason}): `,
  },
  onlyOneSubstitute: 'Solo puede haber un sustituto activo por principal.',
  closeLinkEndsToday: 'Cerrar vínculo (fin hoy)',
  closing: 'Cerrando…',
  substituteVehicle: 'Vehículo de sustitución',
  choosePlaceholder: '— Elegir —',
  reason: 'Motivo',
  linkVerb: 'Vincular',
  linking: 'Vinculando…',
  linkHistoryTitle: 'Histórico de vínculos',
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
  retire: 'Retire',
  blockedTooltip: (plate) => `Blocked by substitution — log mileage on ${plate}`,

  // --- Badges ----------------------------------------------------------------
  substituteBadge: '🔁 Substitute vehicle',
  unlimitedKmBadge: '∞ Unlimited km',
  driverBadge: (name) => `Driver: ${name}`,
  noDriverBadge: 'No driver',

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
  linkActive: {
    pre: '',
    bold: 'Active',
    post: (date, reason) => ` link since ${date} (${reason}): `,
  },
  onlyOneSubstitute: 'Only one active substitute is allowed per main vehicle.',
  closeLinkEndsToday: 'Close link (ends today)',
  closing: 'Closing…',
  substituteVehicle: 'Substitute vehicle',
  choosePlaceholder: '— Choose —',
  reason: 'Reason',
  linkVerb: 'Link',
  linking: 'Linking…',
  linkHistoryTitle: 'Link history',
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
}

const dict = { es, en }

/** Copia de la ficha de vehículo en el idioma activo (UX1). */
export function useVehicleDetailCopy() {
  return dict[useAppLang()]
}
