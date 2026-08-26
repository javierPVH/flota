import { useAppLang } from '@flota/ui/i18n'

const es = {
  title: 'Informes',
  subtitle:
    'Descarga el documento completo de vehículos o el listado de usuarios, y consulta los documentos y las facturas de la flota.',
  tabs: {
    downloads: 'Descargas',
    invoices: 'Facturas',
    documents: 'Documentos',
  },
  vehicleColumn: 'Vehículo',

  /** Pestaña «Documentos»: un tipo cada vez (o todos), con recuentos. */
  docs: {
    allTypes: 'Todos',
    typeColumn: 'Tipo',
    hint: 'Elige un tipo para ver quién subió cada documento, cuándo caduca y en qué estado está. El titular puede ser un coche o un usuario (el permiso de conducir es de una persona).',
    loadError: 'No se pudieron cargar los documentos.',
    filterByStatus: (label: string) => `Ver solo: ${label}`,
    clearStatusFilter: 'Quitar el filtro de estado',
    statusSummary: 'De un vistazo',
    /** Titular del documento: coche o usuario (exactamente uno). */
    ownerColumn: 'Titular',
    /** Dos búsquedas por persona DISTINTAS: de quién es el documento (titular
     * personal o conductor actual del coche) y quién lo subió (columna «Por»). */
    userFilterLabel: 'Titular o conductor',
    uploaderFilterLabel: 'Subido por',
    allUsers: 'Todos',
    driverColumn: 'Conductor',
    groupByPlate: 'Agrupar por matrícula',
    /** Título del grupo de documentos personales (sin coche). */
    groupPersonal: (name: string) => `${name} · personal`,
    groupDocsColumn: 'Documentos',
    groupExpiredColumn: 'Caducados',
    userSearchPlaceholder: 'Nombre o usuario…',
    newDocument: 'Nuevo documento',
    ownerHint:
      'El titular es un coche o un usuario (solo uno): el permiso de conducir es de una persona; la ficha técnica, del coche.',
    ownerVehicleLabel: 'Coche (titular)',
    ownerUserLabel: 'Usuario (titular)',
    ownerNone: '— Ninguno —',
    ownerRequired: 'Elige el titular: un coche o un usuario.',
  },

  /** Pestaña «Descargas»: dos documentos, vehículos (completo) y personas. */
  downloads: {
    lead: 'Elige qué te llevas: el documento completo de vehículos o el listado de usuarios. Ajusta los filtros, comprueba el resultado y descarga.',
    kindLabel: 'Contenido de la descarga',
    kindVehiclesHint: 'Toda la información relacionada, en un único Excel',
    kindUsersHint: 'Directorio completo con estado y roles',
    filtersLabel: 'Filtros',
    filtersActive: (n: number) => `${n} activo${n === 1 ? '' : 's'}`,
    clearFilters: 'Quitar filtros',
    goTo: (where: string) => `Ir a ${where}`,
    preview: 'Ver datos',
    downloadXlsx: 'Descargar Excel',
    downloadCsv: 'Descargar CSV',
    loading: 'Cargando…',
    loadError: 'No se pudieron cargar los datos.',
    emptyPreview: 'Sin datos para estos filtros.',
    previewTitle: (title: string) => `${title} · vista previa`,
    rows: (n: number) => `${n} registro${n === 1 ? '' : 's'}`,
    rowsHint: 'Registros que entran en el documento con los filtros actuales',
    all: 'Todos',
    /** Etiquetas de filtro; también las usa Ajustes → Notificaciones. */
    filterType: 'Tipo',
    filterStatus: 'Estado',
    filterRole: 'Rol',
    filterBrand: 'Marca',
    filterModel: 'Modelo',
    filterCategory: 'Tipo de flota',
    filterLevel: 'Nivel',
    cards: {
      vehicles: {
        title: 'Vehículos',
        description:
          'Un solo documento con todo lo relacionado con cada coche: una fila resumen por vehículo (súper registro) y una hoja de detalle por cada bloque activado.',
        manage: 'Vehículos',
        previewNote:
          'Esto es el documento tal cual se descargará, con tus filtros y campos: una pestaña por hoja y el súper registro completo.',
        csvNote:
          'El CSV es un único fichero plano: el súper registro, con todo lo del coche conectado en su fila. Las hojas de detalle van en el Excel.',
      },
      users: {
        title: 'Usuarios',
        description:
          'El listado de usuarios: roles, permiso de conducir y si están activos o desactivados.',
        manage: 'Usuarios',
      },
    },
    /** Hojas del documento completo, en el orden en que van en el Excel. */
    sheetsLabel: 'El documento incluye',
    sheetsHint:
      'Pulsa un bloque para quitarlo o añadirlo, arrástralo para cambiar su orden en el documento (hojas y columnas del resumen lo siguen) y usa la «?» para ver sus columnas. La ficha va siempre.',
    sheetsRestore: 'Restablecer',
    sheetsFixedHint: 'La ficha es el registro base: no se puede quitar.',
    sheetColumnsTitle: (name: string) => `Columnas de «${name}»`,
    sheetColumnsAria: (name: string) => `Ver las columnas de ${name}`,
    sheetColumnsSummary: 'En el resumen por coche (hoja «Vehículos»)',
    sheetColumnsDetail: 'En su hoja de detalle (solo en el Excel)',
    sheets: {
      vehicles: 'Ficha completa',
      contracts: 'Contratos',
      assignments: 'Asignaciones',
      usage: 'Reparto de uso',
      links: 'Sustituciones',
      km: 'Kilometraje',
      fuel: 'Consumo de combustible',
      events: 'Eventos',
      incidents: 'Incidencias',
      requests: 'Solicitudes',
      documents: 'Documentos',
      alerts: 'Alertas',
      invoices: 'Facturas',
      allocations: 'Imputaciones',
      costs: 'Costes',
      maintenance: 'Mantenimiento',
    },
    columns: {
      username: 'Usuario',
      name: 'Nombre',
      email: 'Email',
      phone: 'Teléfono',
      dni: 'DNI',
      roles: 'Roles',
      license: 'Permiso',
      fuelCard: 'Tarjeta de combustible',
      dateJoined: 'Fecha de alta',
      active: 'Activo',
    },
    yes: 'Sí',
    no: 'No',
    /** Valores de los filtros nuevos (los comparte Notificaciones). */
    statusVehicle: { in_service: 'Activos', retired: 'Desactivados / de baja' } as Record<string, string>,
    statusUser: { active: 'Activos', inactive: 'Desactivados' } as Record<string, string>,
    categoryLabels: { fleet: 'Flota', substitute: 'Sustitución' } as Record<string, string>,
    roleLabels: { admin: 'Administración', supervisor: 'Supervisión', driver: 'Conductor' } as Record<string, string>,
    docStatus: { valid: 'Vigente', expired: 'Caducado', pending_archive: 'Pendiente' } as Record<string, string>,
    alertStatus: { open: 'Abierta', resolved: 'Resuelta' } as Record<string, string>,
    alertLevel: { info: 'Informativa', warning: 'Aviso', critical: 'Crítica' } as Record<string, string>,
  },
}

const en: typeof es = {
  title: 'Reports',
  subtitle:
    'Download the full vehicle document or the user listing, and browse fleet documents and invoices.',
  tabs: {
    downloads: 'Downloads',
    invoices: 'Invoices',
    documents: 'Documents',
  },
  vehicleColumn: 'Vehicle',

  docs: {
    allTypes: 'All',
    typeColumn: 'Type',
    hint: 'Pick a type to see who uploaded each document, when it expires and its status. The owner can be a car or a user (the driving licence belongs to a person).',
    loadError: 'Could not load documents.',
    filterByStatus: (label) => `Show only: ${label}`,
    clearStatusFilter: 'Clear the status filter',
    statusSummary: 'At a glance',
    ownerColumn: 'Owner',
    userFilterLabel: 'Owner or driver',
    uploaderFilterLabel: 'Uploaded by',
    allUsers: 'All',
    driverColumn: 'Driver',
    groupByPlate: 'Group by plate',
    groupPersonal: (name) => `${name} · personal`,
    groupDocsColumn: 'Documents',
    groupExpiredColumn: 'Expired',
    userSearchPlaceholder: 'Name or username…',
    newDocument: 'New document',
    ownerHint:
      'The owner is a car or a user (just one): the driving licence belongs to a person; the datasheet, to the car.',
    ownerVehicleLabel: 'Car (owner)',
    ownerUserLabel: 'User (owner)',
    ownerNone: '— None —',
    ownerRequired: 'Pick the owner: a car or a user.',
  },

  downloads: {
    lead: 'Pick what to take with you: the full vehicle document or the user listing. Set the filters, check the result and download.',
    kindLabel: 'Download contents',
    kindVehiclesHint: 'All related information in one Excel workbook',
    kindUsersHint: 'Full directory with status and roles',
    filtersLabel: 'Filters',
    filtersActive: (n) => `${n} active`,
    clearFilters: 'Clear filters',
    goTo: (where) => `Go to ${where}`,
    preview: 'View data',
    downloadXlsx: 'Download Excel',
    downloadCsv: 'Download CSV',
    loading: 'Loading…',
    loadError: 'Could not load the data.',
    emptyPreview: 'No data for these filters.',
    previewTitle: (title) => `${title} · preview`,
    rows: (n) => `${n} record${n === 1 ? '' : 's'}`,
    rowsHint: 'Records included in the document with the current filters',
    all: 'All',
    filterType: 'Type',
    filterStatus: 'Status',
    filterRole: 'Role',
    filterBrand: 'Make',
    filterModel: 'Model',
    filterCategory: 'Fleet type',
    filterLevel: 'Level',
    cards: {
      vehicles: {
        title: 'Vehicles',
        description:
          'A single document with everything related to each car: one summary row per vehicle (super record) plus a detail sheet per enabled block.',
        manage: 'Vehicles',
        previewNote:
          'This is the document exactly as it will download, with your filters and fields: one tab per sheet and the full super record.',
        csvNote:
          'The CSV is a single flat file: the super record, with everything about the car joined into its row. Detail sheets ship in the Excel.',
      },
      users: {
        title: 'Users',
        description:
          'The user listing: roles, driving licence and whether they are active or deactivated.',
        manage: 'Users',
      },
    },
    sheetsLabel: 'The document includes',
    sheetsHint:
      'Click a block to drop it or add it back, drag it to change its order in the document (sheets and summary columns follow it), and use the “?” to see its columns. The record always ships.',
    sheetsRestore: 'Reset',
    sheetsFixedHint: 'The record is the base register: it cannot be removed.',
    sheetColumnsTitle: (name) => `Columns of “${name}”`,
    sheetColumnsAria: (name) => `See the columns of ${name}`,
    sheetColumnsSummary: 'In the per-car summary (“Vehículos” sheet)',
    sheetColumnsDetail: 'In its detail sheet (Excel only)',
    sheets: {
      vehicles: 'Full record',
      contracts: 'Contracts',
      assignments: 'Assignments',
      usage: 'Usage split',
      links: 'Substitutions',
      km: 'Mileage',
      fuel: 'Fuel consumption',
      events: 'Events',
      incidents: 'Incidents',
      requests: 'Requests',
      documents: 'Documents',
      alerts: 'Alerts',
      invoices: 'Invoices',
      allocations: 'Allocations',
      costs: 'Costs',
      maintenance: 'Maintenance',
    },
    columns: {
      username: 'Username',
      name: 'Name',
      email: 'Email',
      phone: 'Phone',
      dni: 'ID',
      roles: 'Roles',
      license: 'Licence',
      fuelCard: 'Fuel card',
      dateJoined: 'Joined',
      active: 'Active',
    },
    yes: 'Yes',
    no: 'No',
    statusVehicle: { in_service: 'Active', retired: 'Retired' },
    statusUser: { active: 'Active', inactive: 'Deactivated' },
    categoryLabels: { fleet: 'Fleet', substitute: 'Substitute' },
    roleLabels: { admin: 'Administration', supervisor: 'Supervision', driver: 'Driver' },
    docStatus: { valid: 'Valid', expired: 'Expired', pending_archive: 'Pending' },
    alertStatus: { open: 'Open', resolved: 'Resolved' },
    alertLevel: { info: 'Info', warning: 'Warning', critical: 'Critical' },
  },
}

const dict = { es, en }

/** Copia de la página en el idioma activo (UX1). */
export function useReportsCopy() {
  return dict[useAppLang()]
}
