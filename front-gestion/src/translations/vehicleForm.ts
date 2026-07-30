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

  // Banner informativo (edición)
  bannerFieldsPrefix: 'Los campos',
  bannerHistoricNote: 'registran un evento al cambiar; los',
  bannerLockedNote:
    'tienen flujo propio (el kilometraje va por lecturas y el conductor por «Cambiar conductor»).',

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
  fleetOption: 'Flota',
  substituteOption: '🔁 Sustitución',
  substituteBadge: '🔁 Sustitución',
  substituteVehicle: '🔁 Vehículo de sustitución',
  fleetVehicle: 'Vehículo de flota',
  typeFixedNote: '— el tipo se fija al crear.',
  convertibleNote: 'Puede convertirse en flota desde su ficha.',
  substituteNotePrefix: 'Estás creando un',
  substituteNoteStrong: 'vehículo de sustitución',
  substituteNoteSuffix:
    ': cubrirá temporalmente a coches de flota en avería/taller/ITV. Solo puede cubrir uno a la vez.',

  // Secciones
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
  businessUse: 'Tipo de uso',
  project: 'Proyecto',
  driver: 'Conductor',
  driverLockedTitle: 'El conductor se cambia desde la ficha (Cambiar conductor)',
  supervisor: 'Supervisor',
  businessUnit: 'Unidad de negocio',
  costCenter: 'CECO',
  country: 'País',
  property: 'Propiedad',
  company: 'Sociedad',
  insuranceExpiry: 'Vencimiento del seguro',
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
    'El contrato vigente se consulta en la ficha; los cambios de cuota se registran como evento (G8) y los contratos tienen su propio CRUD.',
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

  // Opciones de selects cerrados (el value viaja al back; la label es local)
  fuelLabels: {
    gasoline: 'Gasolina',
    diesel: 'Diésel',
    LPG: 'GLP',
    hybrid: 'Híbrido',
    other: 'Otro',
  },
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
    property: 'Propiedad',
    supervisor: 'Supervisor',
    registration_date: 'Matriculación',
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

  bannerFieldsPrefix: 'Fields marked',
  bannerHistoricNote: 'log an event when changed;',
  bannerLockedNote:
    'ones have their own flow (mileage goes through readings and the driver through “Change driver”).',

  historicBadge: 'historic',
  historicBadgeTitle: 'Changes to it are logged as an event',
  lockedBadge: 'locked',
  lockedBadgeTitle: 'Has its own flow; not edited here',

  conflictBanner: 'The record changed while you were editing (another session saved first).',
  conflictReload: 'Reload with current data',

  typeSectionTitle: 'Vehicle type',
  typeAria: 'Vehicle type',
  fleetOption: 'Fleet',
  substituteOption: '🔁 Substitution',
  substituteBadge: '🔁 Substitution',
  substituteVehicle: '🔁 Substitution vehicle',
  fleetVehicle: 'Fleet vehicle',
  typeFixedNote: '— the type is set at creation.',
  convertibleNote: 'It can be converted to fleet from its detail page.',
  substituteNotePrefix: 'You are creating a',
  substituteNoteStrong: 'substitution vehicle',
  substituteNoteSuffix:
    ': it will temporarily cover fleet cars in breakdown/workshop/MOT. It can only cover one at a time.',

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
  businessUse: 'Business use',
  project: 'Project',
  driver: 'Driver',
  driverLockedTitle: 'The driver is changed from the detail page (Change driver)',
  supervisor: 'Supervisor',
  businessUnit: 'Business unit',
  costCenter: 'Cost center',
  country: 'Country',
  property: 'Ownership',
  company: 'Company',
  insuranceExpiry: 'Insurance expiry',
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
    'The current contract is shown on the detail page; fee changes are logged as an event (G8) and contracts have their own CRUD.',
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

  fuelLabels: {
    gasoline: 'Petrol',
    diesel: 'Diesel',
    LPG: 'LPG',
    hybrid: 'Hybrid',
    other: 'Other',
  },
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
    property: 'Ownership',
    supervisor: 'Supervisor',
    registration_date: 'Registration date',
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
