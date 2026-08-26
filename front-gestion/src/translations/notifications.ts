import { useAppLang } from '@flota/ui/i18n'

const es = {
  title: 'Notificaciones',
  subtitle:
    'Programa el envío de informes y resúmenes por correo a quien quieras, y guárdalos en Google Drive si hace falta.',
  loading: 'Cargando…',
  loadError: 'No se pudieron cargar tus envíos programados.',
  empty: 'Todavía no tienes ningún envío programado.',
  emptyHint: 'Crea uno para recibir un informe o un resumen a la hora que te venga bien.',
  create: 'Nuevo envío',
  createTitle: 'Nuevo envío programado',
  editTitle: 'Editar envío programado',
  records: (n: number) => `${n} ${n === 1 ? 'envío' : 'envíos'}`,

  // Columnas de la tabla
  columns: {
    name: 'Nombre',
    content: 'Contenido',
    when: 'Cuándo',
    destination: 'Destino',
    nextRun: 'Próximo envío',
    lastRun: 'Último envío',
    actions: 'Acciones',
  },

  // Los cuatro bloques del formulario, en el orden en que se rellenan.
  steps: {
    what: 'Qué se envía',
    when: 'Cuándo se envía',
    where: 'A quién se envía',
    name: 'Cómo se llama',
  },

  // Resumen en vivo del pie del formulario: la frase que resume lo elegido.
  review: {
    label: 'Resumen:',
    recipients: (n: number) => (n === 1 ? 'a 1 destinatario' : `a ${n} destinatarios`),
    noRecipients: 'todavía sin destinatarios',
    drive: 'y a Google Drive',
    onlyDrive: 'solo a Google Drive',
    noDestination: 'sin destino',
    filtered: 'filtrado',
  },

  // Campos del formulario
  fields: {
    name: 'Nombre',
    namePlaceholder: 'p. ej. Informe de flota de los lunes',
    nameHint: 'Es el asunto del correo y el nombre del fichero adjunto.',
    content: 'Contenido',
    fmtNote: 'Se adjunta en CSV, que abre cualquier hoja de cálculo.',
    filtersHint: 'Los filtros son los mismos que en Informes; en blanco, sin filtrar.',
    frequency: 'Cada cuánto',
    weekday: 'Día de la semana',
    dayOfMonth: 'Día del mes',
    sendAt: 'Hora',
    enabled: 'Activo',
    enabledHint: 'Si lo desmarcas se guarda la configuración, pero no se envía nada.',
    sendEmail: 'Enviar por correo',
    recipients: 'Destinatarios',
    recipientsPlaceholder: 'persona@empresa.com, otra@empresa.com',
    recipientsHint:
      'Separados por comas. Se envía solo a estas direcciones: tu correo viene puesto, pero puedes quitarlo o cambiarlo.',
    nameWithDate: 'Añadir la fecha',
    nameWithTime: 'Añadir la hora',
    namePreview: (ejemplo: string) => `Quedará así: ${ejemplo}`,
    saveToDrive: 'Guardar una copia en Google Drive',
    driveFolder: 'Carpeta de Drive',
    driveFolderHint: 'Pega el enlace de la carpeta o su id.',
    summaryNoDrive: 'El resumen va en el cuerpo del correo, así que no se puede guardar en Drive.',
  },

  // Los mismos informes que la pantalla de Informes, con sus mismos nombres.
  content: {
    summary: 'Resumen de la flota',
    vehicles: 'Vehículos (completo)',
    fleet: 'Flota',
    kmreadings: 'Kilometraje',
    fuel: 'Consumo de combustible',
    documents: 'Documentos',
    alerts: 'Alertas',
    invoices: 'Facturas',
    costs: 'Costes',
    users: 'Conductores',
  },
  contentHint: {
    summary: 'Va en el cuerpo del correo: vehículos, alertas, ITV, seguros y coste del mes.',
    report:
      'Se envía como fichero adjunto, con los mismos datos y filtros que en Informes.',
  },
  frequency: {
    daily: 'Cada día',
    weekly: 'Cada semana',
    monthly: 'Cada mes',
  },
  weekdays: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'],
  // Un único formato: los envíos programados van siempre en CSV.
  fmt: { csv: 'CSV' },

  // Resúmenes de fila
  whenDaily: (hora: string) => `Cada día a las ${hora}`,
  whenWeekly: (dia: string, hora: string) => `Cada ${dia.toLowerCase()} a las ${hora}`,
  whenMonthly: (dia: number, hora: string) => `El día ${dia} de cada mes a las ${hora}`,
  destEmail: 'Correo',
  destDrive: 'Drive',
  destBoth: 'Correo y Drive',
  never: 'Todavía no',
  paused: 'En pausa',
  statusOk: 'Enviado',
  statusFailed: 'Falló',

  // Acciones
  save: 'Guardar',
  saving: 'Guardando…',
  cancel: 'Cancelar',
  edit: 'Editar',
  runNow: 'Enviar ahora',
  running: 'Enviando…',
  runOk: 'Envío realizado. Revisa tu correo.',
  runQueued: 'Envío encolado: saldrá en la próxima entrega de correo.',
  runError: 'No se pudo enviar.',
  enable: 'Activar',
  disable: 'Poner en pausa',
  delete: 'Eliminar',
  confirmDelete: (nombre: string) =>
    `¿Eliminar el envío «${nombre}»? Dejarás de recibirlo y se borra la configuración.`,
  deleteError: 'No se pudo eliminar.',
  saveError: 'No se pudo guardar.',

  // Avisos
  precisionNote:
    'Los envíos se despachan por tandas, así que pueden llegar unos minutos después de la hora.',
  driveOffNote:
    'Guardar en Drive requiere que la integración esté configurada en el servidor; si no lo está, el envío por correo se hace igual y el guardado se omite.',
}

const en: typeof es = {
  title: 'Notifications',
  subtitle:
    'Schedule reports and summaries by email to whoever needs them, and optionally save them to Google Drive.',
  loading: 'Loading…',
  loadError: 'Could not load your scheduled deliveries.',
  empty: 'You have no scheduled deliveries yet.',
  emptyHint: 'Create one to receive a report or a summary at the time that suits you.',
  create: 'New delivery',
  createTitle: 'New scheduled delivery',
  editTitle: 'Edit scheduled delivery',
  records: (n) => `${n} ${n === 1 ? 'delivery' : 'deliveries'}`,

  columns: {
    name: 'Name',
    content: 'Content',
    when: 'When',
    destination: 'Destination',
    nextRun: 'Next delivery',
    lastRun: 'Last delivery',
    actions: 'Actions',
  },

  steps: {
    what: 'What is sent',
    when: 'When it is sent',
    where: 'Who it is sent to',
    name: 'What it is called',
  },

  review: {
    label: 'Summary:',
    recipients: (n) => (n === 1 ? 'to 1 recipient' : `to ${n} recipients`),
    noRecipients: 'no recipients yet',
    drive: 'and to Google Drive',
    onlyDrive: 'to Google Drive only',
    noDestination: 'no destination',
    filtered: 'filtered',
  },

  fields: {
    name: 'Name',
    namePlaceholder: 'e.g. Monday fleet report',
    nameHint: 'It is the email subject and the attached file name.',
    content: 'Content',
    fmtNote: 'Attached as CSV, which any spreadsheet opens.',
    filtersHint: 'The filters are the same as in Reports; leave blank for no filter.',
    frequency: 'How often',
    weekday: 'Day of the week',
    dayOfMonth: 'Day of the month',
    sendAt: 'Time',
    enabled: 'Active',
    enabledHint: 'If you leave it unchecked the setup is saved, but nothing is sent.',
    sendEmail: 'Send by email',
    recipients: 'Recipients',
    recipientsPlaceholder: 'person@company.com, other@company.com',
    recipientsHint:
      'Comma separated. It is sent only to these addresses: your own is prefilled, but you can remove or change it.',
    nameWithDate: 'Add the date',
    nameWithTime: 'Add the time',
    namePreview: (ejemplo) => `It will look like: ${ejemplo}`,
    saveToDrive: 'Save a copy to Google Drive',
    driveFolder: 'Drive folder',
    driveFolderHint: 'Paste the folder link or its id.',
    summaryNoDrive: 'The summary goes in the email body, so it cannot be saved to Drive.',
  },

  content: {
    summary: 'Fleet summary',
    vehicles: 'Vehicles (full)',
    fleet: 'Fleet',
    kmreadings: 'Mileage',
    fuel: 'Fuel consumption',
    documents: 'Documents',
    alerts: 'Alerts',
    invoices: 'Invoices',
    costs: 'Costs',
    users: 'Drivers',
  },
  contentHint: {
    summary: 'Goes in the email body: vehicles, alerts, MOT, insurance and monthly cost.',
    report: 'Sent as a file attachment, with the same data and filters as in Reports.',
  },
  frequency: {
    daily: 'Every day',
    weekly: 'Every week',
    monthly: 'Every month',
  },
  weekdays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  fmt: { csv: 'CSV' },

  whenDaily: (hora) => `Every day at ${hora}`,
  whenWeekly: (dia, hora) => `Every ${dia.toLowerCase()} at ${hora}`,
  whenMonthly: (dia, hora) => `On day ${dia} of each month at ${hora}`,
  destEmail: 'Email',
  destDrive: 'Drive',
  destBoth: 'Email and Drive',
  never: 'Not yet',
  paused: 'Paused',
  statusOk: 'Sent',
  statusFailed: 'Failed',

  save: 'Save',
  saving: 'Saving…',
  cancel: 'Cancel',
  edit: 'Edit',
  runNow: 'Send now',
  running: 'Sending…',
  runOk: 'Sent. Check your email.',
  runQueued: 'Queued: it will go out with the next email delivery.',
  runError: 'Could not send.',
  enable: 'Activate',
  disable: 'Pause',
  delete: 'Delete',
  confirmDelete: (nombre) =>
    `Delete the delivery “${nombre}”? You will stop receiving it and the configuration is removed.`,
  deleteError: 'Could not delete.',
  saveError: 'Could not save.',

  precisionNote: 'Deliveries are dispatched in batches, so they may arrive a few minutes late.',
  driveOffNote:
    'Saving to Drive requires the integration to be configured on the server; if it is not, the email is still sent and the upload is skipped.',
}

const dict = { es, en }

/** Copia de la página en el idioma activo (UX1). */
export function useNotificationsCopy() {
  return dict[useAppLang()]
}
