import { useAppLang } from '@flota/ui/i18n'

const es = {
  title: 'Informes',
  subtitle: 'Consulta y exportación por factura y por tipo de documento; descargas globales.',
  tabs: {
    invoices: 'Facturas',
    downloads: 'Descargas',
  },
  downloadsTitle: 'Descargas globales',
  vehicleColumn: 'Vehículo',
  downloads: {
    manage: 'Gestionar',
    preview: 'Previsualizar',
    export: 'Exportar CSV',
    columnsLabel: 'Columnas',
    loadError: 'No se pudieron cargar los datos.',
    emptyPreview: 'Sin datos para estos filtros.',
    previewTitle: (title: string) => `Previsualización · ${title}`,
    all: 'Todos',
    filterVehicle: 'Vehículo',
    filterType: 'Tipo',
    filterStatus: 'Estado',
    filterRole: 'Rol',
    filterBrand: 'Marca',
    filterLevel: 'Nivel',
    vehicleSearchPlaceholder: 'Matrícula, marca o modelo…',
    noResults: 'Sin resultados',
    cards: {
      invoices: { title: 'Facturas', description: 'Facturas de la flota (código, fecha, importe).' },
      documents: { title: 'Documentos', description: 'Documentos por tipo (permiso, seguro, contrato…).' },
      users: { title: 'Usuarios', description: 'Personas: conductores, supervisores y administración.' },
      km: { title: 'Kilometraje', description: 'Lecturas de odómetro por vehículo y fecha.' },
      fleet: { title: 'Flota', description: 'Inventario de vehículos: estado, conductor, ITV…' },
      alerts: { title: 'Alertas', description: 'Avisos con tipo, nivel, estado y vehículo.' },
      costs: { title: 'Costes', description: 'Facturación total por vehículo (nº de facturas e importe).' },
    },
    columns: {
      code: 'Código',
      date: 'Fecha',
      amount: 'Importe',
      name: 'Nombre',
      email: 'Email',
      dni: 'DNI',
      roles: 'Roles',
      license: 'Permiso',
      odometer: 'Odómetro',
      estimated: 'Estimada',
      brandModel: 'Marca / modelo',
      state: 'Estado',
      driver: 'Conductor',
      supervisor: 'Responsable',
      nextItv: 'Próxima ITV',
      type: 'Tipo',
      level: 'Nivel',
      message: 'Mensaje',
      invoiceCount: 'Nº facturas',
      billed: 'Facturado (€)',
    },
    yes: 'Sí',
    no: 'No',
    roleLabels: { admin: 'Administración', supervisor: 'Supervisión', driver: 'Conductor' } as Record<string, string>,
    docStatus: { valid: 'Vigente', expired: 'Caducado', pending_archive: 'Pendiente' } as Record<string, string>,
    alertStatus: { open: 'Abierta', resolved: 'Resuelta', dismissed: 'Descartada' } as Record<string, string>,
    alertLevel: { info: 'Informativa', warning: 'Aviso', critical: 'Crítica' } as Record<string, string>,
  },
  reports: {
    fleet: {
      title: 'Flota',
      description:
        'Inventario completo: matrícula, marca/modelo, estado, uso, conductor, supervisor, próxima ITV…',
    },
    alerts: {
      title: 'Alertas',
      description:
        'Alertas con tipo, nivel, estado, vehículo y fechas — para seguimiento y auditoría.',
    },
    costs: {
      title: 'Costes',
      description: 'Cuotas y facturación por vehículo, para conciliar con contabilidad.',
    },
  },
}

const en: typeof es = {
  title: 'Reports',
  subtitle: 'Browse and export by invoice and document type; global downloads.',
  tabs: {
    invoices: 'Invoices',
    downloads: 'Downloads',
  },
  downloadsTitle: 'Global downloads',
  vehicleColumn: 'Vehicle',
  downloads: {
    manage: 'Manage',
    preview: 'Preview',
    export: 'Export CSV',
    columnsLabel: 'Columns',
    loadError: 'Could not load the data.',
    emptyPreview: 'No data for these filters.',
    previewTitle: (title) => `Preview · ${title}`,
    all: 'All',
    filterVehicle: 'Vehicle',
    filterType: 'Type',
    filterStatus: 'Status',
    filterRole: 'Role',
    filterBrand: 'Make',
    filterLevel: 'Level',
    vehicleSearchPlaceholder: 'Plate, make or model…',
    noResults: 'No results',
    cards: {
      invoices: { title: 'Invoices', description: 'Fleet invoices (code, date, amount).' },
      documents: { title: 'Documents', description: 'Documents by type (registration, insurance, contract…).' },
      users: { title: 'Users', description: 'People: drivers, supervisors and administration.' },
      km: { title: 'Mileage', description: 'Odometer readings by vehicle and date.' },
      fleet: { title: 'Fleet', description: 'Vehicle inventory: status, driver, MOT…' },
      alerts: { title: 'Alerts', description: 'Alerts with type, level, status and vehicle.' },
      costs: { title: 'Costs', description: 'Total billing per vehicle (invoice count and amount).' },
    },
    columns: {
      code: 'Code',
      date: 'Date',
      amount: 'Amount',
      name: 'Name',
      email: 'Email',
      dni: 'ID',
      roles: 'Roles',
      license: 'Licence',
      odometer: 'Odometer',
      estimated: 'Estimated',
      brandModel: 'Make / model',
      state: 'Status',
      driver: 'Driver',
      supervisor: 'Manager',
      nextItv: 'Next MOT',
      type: 'Type',
      level: 'Level',
      message: 'Message',
      invoiceCount: 'Invoices',
      billed: 'Billed (€)',
    },
    yes: 'Yes',
    no: 'No',
    roleLabels: { admin: 'Administration', supervisor: 'Supervision', driver: 'Driver' },
    docStatus: { valid: 'Valid', expired: 'Expired', pending_archive: 'Pending' },
    alertStatus: { open: 'Open', resolved: 'Resolved', dismissed: 'Dismissed' },
    alertLevel: { info: 'Info', warning: 'Warning', critical: 'Critical' },
  },
  reports: {
    fleet: {
      title: 'Fleet',
      description:
        'Full inventory: plate, make/model, status, use, driver, supervisor, next MOT…',
    },
    alerts: {
      title: 'Alerts',
      description:
        'Alerts with type, level, status, vehicle and dates — for follow-up and audit.',
    },
    costs: {
      title: 'Costs',
      description: 'Fees and billing per vehicle, to reconcile with accounting.',
    },
  },
}

const dict = { es, en }

/** Copia de la página en el idioma activo (UX1). */
export function useReportsCopy() {
  return dict[useAppLang()]
}
