import { useAppLang } from '@flota/ui/i18n'

/**
 * Copia de la pantalla «Documentos» (`/documentos`): el listado de todos los
 * documentos de la flota y de las personas, por tipo, y sus ajustes de
 * acceso. Vivía como pestaña de Informes y la usa también `DocumentsReport`,
 * que es su tabla.
 */
const es = {
  title: 'Documentos',
  subtitle:
    'Todos los documentos de la flota y de las personas: quién subió cada uno, cuándo caduca, en qué estado está y quién puede leerlo.',
  /** Pestañas principales: los ajustes de acceso y el listado. */
  tabs: {
    documents: 'Documentos',
    settings: 'Ajustes',
  },
  /** Sub-pestañas por tipo: «Todos» y un tipo cada vez, con recuentos. */
  typeTabs: 'Tipo de documento',
  allTypes: 'Todos',
  typeColumn: 'Tipo',
  vehicleColumn: 'Vehículo',
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

  /** Columna «Acceso» del listado: quién lee ese documento y cómo (lo que
   * dice Ajustes para su tipo, o su ajuste propio), por rol. */
  access: {
    /** Dos columnas: quién lee de cada rol de campo (la administración lo
     * lee todo y no ocupa columna). */
    supervisorColumn: 'Acceso · Supervisión',
    driverColumn: 'Acceso · Conductor',
    supervisorReads: 'Lee',
    supervisorNo: 'No lee',
    driverNone: 'No lista',
    driverOwn: 'Los suyos',
    driverAll: 'Todos',
    viewByRequest: 'Lectura con solicitud',
    viewDenied: 'Lectura no permitida',
    downloadByRequest: 'Descarga con solicitud',
    downloadDenied: 'Descarga no permitida',
    deleteDenied: 'Borrado no permitido',
    /** Chapa de la fila con algún ajuste propio (pisa a su tipo). */
    adjusted: 'Ajustado',
    title: 'Quién puede leer este documento y qué puede hacer con él (lo de su tipo en Ajustes, o su ajuste propio)',
    edit: (type: string) => `Acceso de ${type}`,
    /** El modal de la fila: el ajuste por documento. */
    modal: {
      title: (type: string) => `Acceso · ${type}`,
      intro:
        'Lo que vale para este documento. «Según el tipo» es lo que tengas configurado en Documentos → Ajustes para su tipo de documento (el icono dice lo que es hoy); cualquier otra posición lo pisa solo en este documento.',
      inherit: (value: string) => `Según el tipo (${value})`,
      inheritShort: 'Según el tipo',
      supervisor: 'La supervisión lo lee',
      list: 'Lo que lista el conductor',
      view: 'Cómo lo ve el conductor',
      download: 'Cómo se lo baja el conductor',
      remove: 'Cómo pide el conductor su borrado',
      save: 'Guardar',
      saving: 'Guardando…',
      cancel: 'Cancelar',
      saveError: 'No se pudo guardar el acceso del documento.',
    },
  },

  /** Pestaña «Ajustes»: quién lee cada tipo de documento y cómo. */
  settings: {
    title: 'Quién lee cada tipo de documento',
    intro:
      'Para cada tipo, qué roles pueden leer sus documentos y cómo. La administración lo lee todo y no se cambia. La supervisión se puede apagar por tipo. Al conductor se le decide qué lista (solo lo que subió él, o también lo de otros usuarios) y si ve y se baja el archivo directamente, previa solicitud (que la gestión concede en Solicitudes) o nunca.',
    ownNote:
      'Lo que uno sube lo lee siempre, y cada persona sigue viendo sus documentos personales: estos ajustes no tapan a nadie sus propios papeles.',
    supervisorsNote:
      'La supervisión lee lo que lista, pero se descarga un documento y pide su borrado siempre previa solicitud; por eso no tiene más mandos. La papelera de la app de campo nunca borra: pide, y al conductor se le puede cerrar incluso eso.',
    typeColumn: 'Tipo de documento',
    adminColumn: 'Administración',
    adminAlways: 'Siempre',
    adminFixed: 'La administración lee todos los documentos; no se puede cambiar.',
    supervisorColumn: 'Supervisión',
    supervisorReads: 'Lo lee',
    supervisorAria: (type: string) => `${type} · lo lee la supervisión`,
    /** El grupo de columnas del conductor. */
    driversGroup: 'Conductores',
    listColumn: 'Listar documentos',
    listAria: (type: string) => `${type} · lo que lista el conductor`,
    /** El conmutador de qué lista: nada, lo suyo o todo. */
    driverOptions: {
      none: 'No listar ninguno',
      own: 'Solo los subidos por el conductor actual',
      all: 'También los subidos por otros usuarios',
    },
    viewColumn: 'Lectura',
    viewAria: (type: string) => `${type} · cómo lo ve el conductor`,
    downloadColumn: 'Descarga',
    downloadAria: (type: string) => `${type} · cómo se lo baja el conductor`,
    /** Directamente o pidiéndolo: el conmutador de lectura y descarga. */
    actionOptions: {
      allow: 'Permitir',
      request: 'Enviar solicitud',
      deny: 'No permitir',
    },
    deletionColumn: 'Borrado',
    deletionAria: (type: string) => `${type} · cómo pide el conductor su borrado`,
    legend: 'Leyenda de los iconos',
    notListedHint: 'No aplica: el conductor no lista este documento.',
    yes: 'Sí',
    no: 'No',
    save: 'Guardar cambios',
    saving: 'Guardando…',
    saved: 'Ajustes guardados. Valen desde la siguiente lectura.',
    pending: (n: number) => (n === 1 ? '1 tipo cambiado sin guardar' : `${n} tipos cambiados sin guardar`),
    loadError: 'No se pudieron cargar los ajustes de acceso.',
    saveError: 'No se pudieron guardar los ajustes.',
  },
}

const en: typeof es = {
  title: 'Documents',
  subtitle:
    'Every document of the fleet and of the people: who uploaded each one, when it expires, its status and who can read it.',
  tabs: {
    documents: 'Documents',
    settings: 'Settings',
  },
  typeTabs: 'Document type',
  allTypes: 'All',
  typeColumn: 'Type',
  vehicleColumn: 'Vehicle',
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

  access: {
    supervisorColumn: 'Access · Supervision',
    driverColumn: 'Access · Driver',
    supervisorReads: 'Reads',
    supervisorNo: 'Does not read',
    driverNone: 'Lists none',
    driverOwn: 'Own uploads',
    driverAll: 'All',
    viewByRequest: 'View on request',
    viewDenied: 'No viewing',
    downloadByRequest: 'Download on request',
    downloadDenied: 'No download',
    deleteDenied: 'No deletion',
    adjusted: 'Adjusted',
    title: 'Who can read this document and what they can do with it (its type in Settings, or its own adjustment)',
    edit: (type) => `Access of ${type}`,
    modal: {
      title: (type) => `Access · ${type}`,
      intro:
        'What applies to this document. “As the type” is whatever you have configured in Documents → Settings for its document type (the icon shows what it is today); any other position overrides it in this document only.',
      inherit: (value) => `As the type (${value})`,
      inheritShort: 'As the type',
      supervisor: 'Supervision reads it',
      list: 'What the driver lists',
      view: 'How the driver views it',
      download: 'How the driver downloads it',
      remove: 'How the driver asks for its deletion',
      save: 'Save',
      saving: 'Saving…',
      cancel: 'Cancel',
      saveError: 'Could not save the document access.',
    },
  },

  settings: {
    title: 'Who reads each document type',
    intro:
      'For each type, which roles can read its documents and how. Administration reads everything and cannot be changed. Supervision can be switched off per type. For the driver you decide what they list (only what they uploaded, or also what other users uploaded) and whether they view and download the file directly, on request (which management grants in Requests) or never.',
    ownNote:
      'Whatever someone uploads they always read, and everyone keeps seeing their own personal documents: these settings never hide anyone their own papers.',
    supervisorsNote:
      'Supervision reads what it lists, but downloads a document and asks for its deletion always on request; that is why it has no further controls. The trash in the field app never deletes: it asks, and for the driver even that can be closed.',
    typeColumn: 'Document type',
    adminColumn: 'Administration',
    adminAlways: 'Always',
    adminFixed: 'Administration reads every document; this cannot be changed.',
    supervisorColumn: 'Supervision',
    supervisorReads: 'Reads it',
    supervisorAria: (type) => `${type} · supervision reads it`,
    driversGroup: 'Drivers',
    listColumn: 'List documents',
    listAria: (type) => `${type} · what the driver lists`,
    driverOptions: {
      none: 'List none',
      own: 'Only those uploaded by the current driver',
      all: 'Also those uploaded by other users',
    },
    viewColumn: 'View',
    viewAria: (type) => `${type} · how the driver views it`,
    downloadColumn: 'Download',
    downloadAria: (type) => `${type} · how the driver downloads it`,
    actionOptions: {
      allow: 'Allow',
      request: 'Send a request',
      deny: 'Do not allow',
    },
    deletionColumn: 'Deletion',
    deletionAria: (type) => `${type} · how the driver asks for its deletion`,
    legend: 'Icon legend',
    notListedHint: 'Not applicable: the driver does not list this document.',
    yes: 'Yes',
    no: 'No',
    save: 'Save changes',
    saving: 'Saving…',
    saved: 'Settings saved. They apply from the next read.',
    pending: (n) => (n === 1 ? '1 type changed, unsaved' : `${n} types changed, unsaved`),
    loadError: 'Could not load the access settings.',
    saveError: 'Could not save the settings.',
  },
}

const dict = { es, en }

/** Copia de la pantalla en el idioma activo (UX1). */
export function useDocumentsCopy() {
  return dict[useAppLang()]
}
