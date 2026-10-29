import { useAppLang } from '@flota/ui/i18n'

const es = {
  newTitle: 'Nuevo vehículo',
  editTitle: (plate: string) => `Editar ${plate}`,
  plate: 'Matrícula',

  // Cabecera
  back: '← Volver',
  editSubtitle: 'Edita la ficha; los cambios se revisan antes de guardar.',
  newSubtitle: 'Alta transaccional: si algo falla, no se crea nada.',
  loading: 'Cargando…',

  // Badges de campo
  historicBadge: 'histórico',
  historicBadgeTitle: 'Su cambio queda registrado como evento',
  lockedBadge: 'bloqueado',
  lockedBadgeTitle: 'Tiene un flujo propio; no se edita aquí',

  // Conflicto de edición (409)
  conflictBanner: 'La ficha cambió mientras editabas (otra sesión guardó antes).',
  conflictReload: 'Recargar con los datos actuales',

  // Tipo de vehículo (N9)
  typeSectionTitle: 'Tipo de vehículo',
  typeAria: 'Tipo de vehículo',
  prevTab: 'Atrás',
  nextTab: 'Siguiente',
  fleetOption: 'Flota',
  substituteOption: '🔁 Sustitución',
  substituteBadge: '🔁 Sustitución',
  substituteVehicle: '🔁 Vehículo de sustitución',
  fleetVehicle: 'Vehículo de flota',
  typeFixedNote: '— el tipo se fija al crear.',
  convertibleNote: 'Puede convertirse en flota desde su ficha.',
  // Convertir sustituto → flota (triple aviso, solo si no está en uso).
  convertBtn: 'Convertir en coche de flota',
  convertTitle: 'Convertir en flota',
  convertWarn1: (plate: string) =>
    `Vas a convertir el coche de sustitución ${plate} en un coche de flota. Solo debería hacerse si ya no se usará como sustituto.`,
  convertWarn2:
    'El tipo es definitivo: un coche de flota NO puede volver a ser de sustitución. Asegúrate de que no está cubriendo a ningún vehículo.',
  convertWarn3: (plate: string) =>
    `Confirmación final: ${plate} pasará a la flota de forma permanente. ¿Continuar?`,
  convertContinue: 'Continuar',
  convertConfirm: 'Convertir en flota',
  convertError: 'No se pudo convertir el vehículo (¿está cubriendo a algún coche?).',
  substituteNotePrefix: 'Estás creando un',
  substituteNoteStrong: 'vehículo de sustitución',
  substituteNoteSuffix:
    ': cubrirá temporalmente a coches de flota en avería/taller/ITV. Solo puede cubrir uno a la vez.',

  // Datos fijos del vehículo y su candado (edición)
  fixedTitle: 'Datos del vehículo',
  lockClosed: 'Bloqueado',
  lockOpen: 'Editable',
  lockHintClosed: 'Identifican al vehículo: pulsa para poder editarlos',
  lockHintOpen: 'Pulsa para volver a bloquearlos',
  unlockTitle: 'Vas a modificar datos sensibles del vehículo',
  unlockWarn:
    'La matrícula, el bastidor, la fecha de matriculación, la marca, el modelo, la versión y el año identifican al vehículo en contratos, seguros y multas. Cámbialos solo para corregir un error de alta: el resto de registros seguirán apuntando a este mismo coche. Todo cambio quedará auditado con tu usuario, la fecha y el valor anterior, y se verá en el histórico de la ficha.',
  unlockConfirm: 'Entiendo, quiero editarlos',

  // Secciones
  /** Nombre de la barra de pestañas del formulario (lectores de pantalla). */
  sectionsAria: 'Secciones del vehículo',
  identificationTitle: 'Identificación',
  technicalTitle: 'Características técnicas',
  usageTitle: 'Uso y asignación',
  propertyTitle: 'Propiedad y contrato',

  // Campos
  vin: 'Bastidor (VIN)',
  brand: 'Marca',
  model: 'Modelo',
  version: 'Versión',
  year: 'Año',
  registrationDate: 'Matriculación',
  fuel: 'Combustible',
  type: 'Tipo',
  size: 'Tamaño',
  segment: 'Segmento',
  vehUse: 'Uso pasajeros/mercancía',
  consumption: 'Consumo (l/100km)',
  kmStart: 'Odómetro inicial (km)',
  kmStartLockedTitle: 'El kilometraje se actualiza registrando lecturas',
  kmStartNote: 'El odómetro inicial crea la primera lectura de km del vehículo.',
  // Disparador del acordeón de ayuda de un campo bloqueado/sensible.
  whyLocked: '¿Por qué no se puede editar?',
  // Campo sensible: en edición no se toca aquí (descuadraría las proyecciones).
  kmStartEditInfo:
    'El odómetro inicial se fijó al dar de alta el vehículo. El kilometraje se actualiza registrando lecturas en «Kilometraje»; no se corrige aquí para no descuadrar las proyecciones ni el histórico.',
  businessUse: 'Tipo de uso',
  project: 'Proyecto',
  driver: 'Conductor',
  // Campo sensible: cambiarlo es un relevo, con aviso y rastro en el histórico.
  driverChangeWhat: '¿Qué pasa al cambiarlo?',
  driverEditInfo:
    'Es el conductor vigente. Si lo cambias, al guardar se cierra su asignación, se abre una nueva con fecha de hoy y el relevo queda en el histórico: lo mismo que hace «Cambiar conductor» en la ficha, que además deja elegir la fecha. Un conductor solo puede llevar un coche a la vez.',
  driverMultiuserInfo:
    'Un vehículo multiusuario no tiene conductor asociado: lo usa un número indeterminado de personas y de él responde su supervisor. Quita la marca de multiusuario para asignarle uno.',
  driverChangeTitle: 'Cambiar el conductor',
  driverChangeWarn: (plate: string, from: string, to: string) =>
    `Vas a cambiar el conductor de ${plate}: de ${from} a ${to}. Al guardar se cierra la asignación vigente, se abre una nueva con fecha de hoy y el relevo queda en el histórico. Si ${to} lleva otro coche, el cambio se rechazará al guardar.`,
  driverReleaseWarn: (plate: string, from: string) =>
    `Vas a dejar ${plate} sin conductor: al guardar se cierra la asignación de ${from} con fecha de hoy y queda en el histórico. El coche saldrá en «Vehículos sin conductor».`,
  driverChangeConfirm: 'Entendido, cambiarlo',
  driverSaveError: (detail: string) =>
    `La ficha se guardó, pero el cambio de conductor no: ${detail} Vuelve a intentarlo desde «Cambiar conductor».`,
  // Por qué el Proyecto está deshabilitado (acordeón bajo el desplegable).
  projectDisabledLabel: '¿Por qué no puedo elegir proyecto?',
  projectDisabledInfo:
    'El proyecto solo se asigna cuando el «Tipo de uso» es «Proyecto». Cambia el tipo de uso a «Proyecto» (arriba) y podrás elegirlo.',
  supervisor: 'Supervisor',
  businessUnit: 'Unidad de negocio',
  costCenter: 'CECO',
  country: 'País',
  property: 'Propiedad',
  company: 'Sociedad',
  insuranceExpiry: 'Vencimiento del seguro',
  /** Editando: conductor, supervisor y multiusuario van en el modal de la barra. */
  peopleElsewhere:
    'El conductor, el supervisor y la marca de multiusuario se cambian desde «Cambiar conductor / supervisor», en la barra de arriba: cada cambio es un gesto propio que queda en el histórico.',
  multiuser: 'Multiusuario (coche de pool)',
  multiuserWhat: '¿Qué es un coche multiusuario?',
  multiuserInfo:
    'Lo usa un número indeterminado de personas, así que no tiene conductor '
    + 'asociado: de él responde su supervisor, que es quien registra sus '
    + 'kilómetros y su combustible. En el histórico puedes anotar tantos '
    + 'conductores como haga falta —incluso a la vez—, pero el coche no les '
    + 'aparecerá a ellos.',
  multiuserNeedsSupervisor:
    'Necesita supervisor: es quien responde del coche y el único que puede '
    + 'registrar sus kilómetros y su combustible, así que sin él un '
    + 'multiusuario sería un coche al que no entra nadie. Al marcarla, el '
    + 'supervisor pasa a ser obligatorio.',
  multiuserSupervisorRequired:
    'Un multiusuario necesita supervisor: elige uno antes de guardar.',
  unlimitedKm: 'Km ilimitados (sin proyección)',
  unlimitedKmTitle: 'Sin proyección de km ni alertas de exceso',
  rentingCompany: 'Compañía de renting',
  contractNumber: 'Nº de contrato',
  contractTime: 'Duración (meses)',
  contractKm: 'Km contratados',
  monthFee: 'Cuota mensual (€)',
  penaltyPerKm: 'Penalización (€/km)',
  contractStart: 'Inicio del contrato',
  contractEnd: 'Fin previsto',

  // Placeholders / opciones vacías de selects
  chooseBrand: '— Elegir marca —',
  chooseModel: '— Elegir modelo —',
  chooseBrandFirst: 'Elige antes la marca',
  choose: '— Elegir —',
  projectOnlyUse: '— (solo uso Proyecto)',
  noCompany: '— Sin sociedad —',
  unassigned: 'Sin asignar',
  noSupervisor: 'Sin supervisor',

  // Alta rápida de modelo
  newModelButton: '+ Nuevo',
  newModelButtonTitle: 'Añadir un modelo nuevo a esta marca',
  newModelTitle: (brand: string) => `Nuevo modelo de ${brand}`,
  theBrandFallback: 'la marca',
  modelName: 'Nombre del modelo',
  createAndSelect: 'Crear y seleccionar',

  // Notas de contrato
  contractEditNote:
    'Editas el contrato vigente del vehículo. Cambiar la cuota se registra además como evento (G8).',
  contractCreateHint: 'Rellena inicio y fin previsto para crear el contrato del vehículo.',
  contractCreateNote: 'El contrato se crea junto al vehículo: si algo falla, no se guarda nada.',

  // Pie de formulario
  unsavedChanges: 'Hay cambios sin guardar.',
  noChangesYet: 'Sin cambios todavía.',
  cancel: 'Cancelar',
  saving: 'Guardando…',
  reviewChanges: 'Revisar cambios…',
  createVehicle: 'Crear vehículo',

  // Modal de preview (HU-1.4)
  confirmChanges: 'Confirmar cambios',
  noEffectiveChanges: 'El servidor no detecta cambios efectivos.',
  fieldCol: 'Campo',
  beforeCol: 'Antes',
  afterCol: 'Después',
  keepEditing: 'Seguir editando',
  saveChanges: 'Guardar cambios',

  // Errores (fallbacks de asErrorMessage)
  loadError: 'No se pudo cargar el vehículo.',
  previewError: 'No se pudo previsualizar los cambios.',
  createError: 'No se pudo crear el vehículo (no se ha guardado nada).',
  saveError: 'No se pudo guardar.',
  createModelError: 'No se pudo crear el modelo.',

  // GAP-1: el combustible viene del catálogo; para fichas legadas sin FK se
  // enseña el texto guardado.
  fuelLegacyNote: (texto: string) => `Guardado como texto: «${texto}». Elige uno del catálogo.`,
  fuelCard: 'Tarjeta de combustible',
  site: 'Sede',
  siteHint: 'Dónde vive el vehículo cuando no está asociado a una obra.',
  // Opciones de selects cerrados (el value viaja al back; la label es local)
  typeLabels: {
    car: 'Turismo',
    van: 'Furgoneta',
    truck: 'Camión',
    motorcycle: 'Motocicleta',
  },
  sizeLabels: {
    small: 'Pequeño',
    medium: 'Mediano',
    big: 'Grande',
  },
  segmentLabels: {
    mini: 'Mini',
    supermini: 'Supermini',
    med_low: 'Mediano inferior',
    med_sup: 'Mediano superior',
    executive: 'Ejecutivo',
    luxury: 'Lujo',
  },
  vehUseLabels: {
    passengers: 'Pasajeros',
    freight: 'Mercancía',
  },
  businessUseLabels: {
    personal: 'Personal',
    works: 'Obras',
    on_project: 'Proyecto',
  },
  propertyLabels: {
    propio: 'Propio',
    renting: 'Renting',
  },

  // Etiquetas legibles del diff del preview
  fieldLabels: {
    plate: 'Matrícula',
    vin: 'Bastidor (VIN)',
    brand: 'Marca',
    model: 'Modelo',
    version: 'Versión',
    year: 'Año',
    fuel: 'Combustible',
    type: 'Tipo',
    size: 'Tamaño',
    market_segment: 'Segmento',
    veh_use: 'Uso pasajeros/mercancía',
    consumption: 'Consumo',
    business_use: 'Tipo de uso',
    project: 'Proyecto',
    business_unit: 'Unidad de negocio',
    cost_center: 'CECO',
    country: 'País',
    site: 'Sede',
    fuel_ref: 'Combustible',
    fuel_card: 'Tarjeta de combustible',
    property: 'Propiedad',
    supervisor: 'Supervisor',
    driver: 'Conductor',
    registration_date: 'Matriculación',
    // Contrato (diff del preview cuando se edita en la misma pantalla).
    contract_number: 'Nº de contrato',
    contract_time: 'Duración (meses)',
    contract_km: 'Km contratados',
    renting: 'Compañía de renting',
    start_date: 'Inicio del contrato',
    planned_end_date: 'Fin previsto del contrato',
    month_fee: 'Cuota mensual',
    penalty_per_km: 'Penalización (€/km)',
  } as Record<string, string>,
  catalogsLoadError:
    'No se pudieron cargar todos los catálogos (marcas, proyectos, sociedades…): algún desplegable puede estar vacío.',
  catalogsRetry: 'Reintentar',
}

const en: typeof es = {
  newTitle: 'New vehicle',
  editTitle: (plate) => `Edit ${plate}`,
  plate: 'Plate',

  back: '← Back',
  editSubtitle: 'Edit the record; changes are reviewed before saving.',
  newSubtitle: 'Transactional creation: if anything fails, nothing is created.',
  loading: 'Loading…',

  historicBadge: 'historic',
  historicBadgeTitle: 'Changes to it are logged as an event',
  lockedBadge: 'locked',
  lockedBadgeTitle: 'Has its own flow; not edited here',

  conflictBanner: 'The record changed while you were editing (another session saved first).',
  conflictReload: 'Reload with current data',

  typeSectionTitle: 'Vehicle type',
  typeAria: 'Vehicle type',
  prevTab: 'Back',
  nextTab: 'Next',
  fleetOption: 'Fleet',
  substituteOption: '🔁 Substitution',
  substituteBadge: '🔁 Substitution',
  substituteVehicle: '🔁 Substitution vehicle',
  fleetVehicle: 'Fleet vehicle',
  typeFixedNote: '— the type is set at creation.',
  convertibleNote: 'It can be converted to fleet from its detail page.',
  convertBtn: 'Convert to fleet vehicle',
  convertTitle: 'Convert to fleet',
  convertWarn1: (plate) =>
    `You are about to convert the substitution vehicle ${plate} into a fleet vehicle. Do this only if it will no longer be used as a substitute.`,
  convertWarn2:
    'The type is permanent: a fleet vehicle CANNOT go back to being a substitute. Make sure it is not covering any vehicle.',
  convertWarn3: (plate) =>
    `Final confirmation: ${plate} will permanently become a fleet vehicle. Continue?`,
  convertContinue: 'Continue',
  convertConfirm: 'Convert to fleet',
  convertError: 'Could not convert the vehicle (is it covering a car?).',
  substituteNotePrefix: 'You are creating a',
  substituteNoteStrong: 'substitution vehicle',
  substituteNoteSuffix:
    ': it will temporarily cover fleet cars in breakdown/workshop/MOT. It can only cover one at a time.',

  fixedTitle: 'Vehicle data',
  lockClosed: 'Locked',
  lockOpen: 'Editable',
  lockHintClosed: 'They identify the vehicle: click to be able to edit them',
  lockHintOpen: 'Click to lock them again',
  unlockTitle: 'You are about to change sensitive vehicle data',
  unlockWarn:
    'The plate, VIN, registration date, brand, model, version and year identify the vehicle in contracts, insurance and fines. Change them only to fix a data-entry mistake: every other record will keep pointing at this same car. Every change is audited with your user, the date and the previous value, and shows in the vehicle history.',
  unlockConfirm: 'I understand, let me edit them',

  sectionsAria: 'Vehicle sections',
  identificationTitle: 'Identification',
  technicalTitle: 'Technical specs',
  usageTitle: 'Use and assignment',
  propertyTitle: 'Ownership and contract',

  vin: 'VIN',
  brand: 'Brand',
  model: 'Model',
  version: 'Version',
  year: 'Year',
  registrationDate: 'Registration date',
  fuel: 'Fuel',
  type: 'Type',
  size: 'Size',
  segment: 'Segment',
  vehUse: 'Passengers/freight use',
  consumption: 'Consumption (l/100km)',
  kmStart: 'Initial odometer (km)',
  kmStartLockedTitle: 'Mileage is updated by logging readings',
  kmStartNote: 'The initial odometer creates the vehicle’s first mileage reading.',
  whyLocked: 'Why can’t this be edited?',
  kmStartEditInfo:
    'The initial odometer was set when the vehicle was created. Mileage is updated by logging readings in “Mileage”; it is not edited here so projections and history stay consistent.',
  businessUse: 'Business use',
  project: 'Project',
  driver: 'Driver',
  driverChangeWhat: 'What happens if I change it?',
  driverEditInfo:
    'This is the current driver. If you change it, saving closes their assignment, opens a new one dated today and records the handover in the history: the same as “Change driver” on the detail page, which also lets you pick the date. A driver can only have one car at a time.',
  driverMultiuserInfo:
    'A pool car has no assigned driver: an undetermined number of people use it and its supervisor is responsible for it. Untick “Multi-user” to assign one.',
  driverChangeTitle: 'Change the driver',
  driverChangeWarn: (plate: string, from: string, to: string) =>
    `You are about to change the driver of ${plate}: from ${from} to ${to}. On save, the current assignment is closed, a new one dated today is opened and the handover is recorded in the history. If ${to} already has another car, the change will be rejected on save.`,
  driverReleaseWarn: (plate: string, from: string) =>
    `You are about to leave ${plate} without a driver: on save, ${from}’s assignment is closed as of today and recorded in the history. The car will show up under “Vehicles without a driver”.`,
  driverChangeConfirm: 'Got it, change it',
  driverSaveError: (detail: string) =>
    `The vehicle was saved, but the driver change was not: ${detail} Try again from “Change driver”.`,
  projectDisabledLabel: 'Why can’t I pick a project?',
  projectDisabledInfo:
    'The project is only assigned when “Business use” is “Project”. Set the business use to “Project” (above) to choose one.',
  supervisor: 'Supervisor',
  businessUnit: 'Business unit',
  costCenter: 'Cost center',
  country: 'Country',
  property: 'Ownership',
  company: 'Company',
  insuranceExpiry: 'Insurance expiry',
  peopleElsewhere:
    'The driver, the supervisor and the pool-car flag are changed from “Change driver / supervisor” in the bar above: each change is its own action and stays in the history.',
  multiuser: 'Multi-user (pool car)',
  multiuserWhat: 'What is a pool car?',
  multiuserInfo:
    'An undetermined number of people use it, so it has no assigned driver: '
    + 'its supervisor is responsible for it and the one who records its '
    + 'mileage and fuel. You can log as many drivers in the history as you '
    + 'need —even at the same time— but the car will not show up for them.',
  multiuserNeedsSupervisor:
    'It needs a supervisor: they are responsible for the car and the only '
    + 'one who can record its mileage and fuel, so without one a pool car '
    + 'would be a car nobody can reach. Ticking it makes the supervisor '
    + 'required.',
  multiuserSupervisorRequired: 'A pool car needs a supervisor: pick one before saving.',
  unlimitedKm: 'Unlimited km (no projection)',
  unlimitedKmTitle: 'No km projection or overage alerts',
  rentingCompany: 'Leasing company',
  contractNumber: 'Contract no.',
  contractTime: 'Term (months)',
  contractKm: 'Contracted km',
  monthFee: 'Monthly fee (€)',
  penaltyPerKm: 'Penalty (€/km)',
  contractStart: 'Contract start',
  contractEnd: 'Planned end',

  chooseBrand: '— Choose brand —',
  chooseModel: '— Choose model —',
  chooseBrandFirst: 'Choose the brand first',
  choose: '— Choose —',
  projectOnlyUse: '— (Project use only)',
  noCompany: '— No company —',
  unassigned: 'Unassigned',
  noSupervisor: 'No supervisor',

  newModelButton: '+ New',
  newModelButtonTitle: 'Add a new model to this brand',
  newModelTitle: (brand) => `New model for ${brand}`,
  theBrandFallback: 'the brand',
  modelName: 'Model name',
  createAndSelect: 'Create and select',

  contractEditNote:
    'You are editing the vehicle’s current contract. Changing the fee is also logged as an event (G8).',
  contractCreateHint: 'Fill in the start and planned end to create the vehicle’s contract.',
  contractCreateNote: 'The contract is created with the vehicle: if anything fails, nothing is saved.',

  unsavedChanges: 'Unsaved changes.',
  noChangesYet: 'No changes yet.',
  cancel: 'Cancel',
  saving: 'Saving…',
  reviewChanges: 'Review changes…',
  createVehicle: 'Create vehicle',

  confirmChanges: 'Confirm changes',
  noEffectiveChanges: 'The server detects no effective changes.',
  fieldCol: 'Field',
  beforeCol: 'Before',
  afterCol: 'After',
  keepEditing: 'Keep editing',
  saveChanges: 'Save changes',

  loadError: 'Could not load the vehicle.',
  previewError: 'Could not preview the changes.',
  createError: 'Could not create the vehicle (nothing was saved).',
  saveError: 'Could not save.',
  createModelError: 'Could not create the model.',

  fuelLegacyNote: (texto) => `Stored as text: “${texto}”. Pick one from the catalog.`,
  fuelCard: 'Fuel card',
  site: 'Site',
  siteHint: 'Where the vehicle lives when not assigned to a project site.',
  typeLabels: {
    car: 'Car',
    van: 'Van',
    truck: 'Truck',
    motorcycle: 'Motorcycle',
  },
  sizeLabels: {
    small: 'Small',
    medium: 'Medium',
    big: 'Large',
  },
  segmentLabels: {
    mini: 'Mini',
    supermini: 'Supermini',
    med_low: 'Lower medium',
    med_sup: 'Upper medium',
    executive: 'Executive',
    luxury: 'Luxury',
  },
  vehUseLabels: {
    passengers: 'Passengers',
    freight: 'Freight',
  },
  businessUseLabels: {
    personal: 'Personal',
    works: 'Works',
    on_project: 'Project',
  },
  propertyLabels: {
    propio: 'Owned',
    renting: 'Leasing',
  },

  fieldLabels: {
    plate: 'Plate',
    vin: 'VIN',
    brand: 'Brand',
    model: 'Model',
    version: 'Version',
    year: 'Year',
    fuel: 'Fuel',
    type: 'Type',
    size: 'Size',
    market_segment: 'Segment',
    veh_use: 'Passengers/freight use',
    consumption: 'Consumption',
    business_use: 'Business use',
    project: 'Project',
    business_unit: 'Business unit',
    cost_center: 'Cost center',
    country: 'Country',
    site: 'Site',
    fuel_ref: 'Fuel',
    fuel_card: 'Fuel card',
    property: 'Ownership',
    supervisor: 'Supervisor',
    driver: 'Driver',
    registration_date: 'Registration date',
    contract_number: 'Contract no.',
    contract_time: 'Term (months)',
    contract_km: 'Contracted km',
    renting: 'Leasing company',
    start_date: 'Contract start',
    planned_end_date: 'Contract planned end',
    month_fee: 'Monthly fee',
    penalty_per_km: 'Penalty (€/km)',
  } as Record<string, string>,
  catalogsLoadError:
    'Some catalogs (brands, projects, companies…) failed to load: a dropdown may be empty.',
  catalogsRetry: 'Retry',
}

const dict = { es, en }

export type VehicleFormCopy = typeof es

/** Copia del formulario de vehículo en el idioma activo (UX1). */
export function useVehicleFormCopy() {
  return dict[useAppLang()]
}
