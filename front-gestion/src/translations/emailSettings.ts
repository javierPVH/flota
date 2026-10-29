/**
 * Copia de Ajustes → Correo → «Recordatorio de km» y «Aspecto del correo»
 * (`EmailSettingsPanel`): la parametrización del recordatorio y la caja
 * corporativa que envuelve todos los correos. También los rótulos de los
 * grupos de pestañas de esa pantalla.
 */
import { useAppLang } from '@flota/ui/i18n'

const es = {
  reminderTab: 'Recordatorio de km',
  fuelTab: 'Recordatorio de combustible',
  itvTab: 'Recordatorio de ITV',
  maintenanceTab: 'Recordatorio de mantenimiento',
  layoutTab: 'Aspecto del correo',
  /** Grupos de la fila de pestañas de Ajustes → Correo. */
  groups: {
    log: 'Trazas',
    settings: 'Configuración',
    templates: 'Plantillas por tipo de correo',
  },
  /** Chapa de cada plantilla en su pestaña: qué versión está en uso. */
  tabGeneric: 'genérica',
  tabCustom: 'personalizada',
  loading: 'Cargando…',
  save: 'Guardar',
  saving: 'Guardando…',
  saved: 'Ajustes guardados. El job los aplica en su siguiente pasada.',
  loadError: 'No se pudieron cargar los ajustes del correo.',
  previewError: 'No se pudo generar la vista previa.',
  reminder: {
    title: 'Cuándo y cuántas veces se avisa al conductor',
    intro:
      'Cada mes, el conductor cuyo coche no tenga lectura de km recibe la alerta en la app y un correo. Aquí se decide en qué días del mes se reclama y con qué cadencia se le escribe mientras siga sin registrarla. El aviso dice siempre cuántos días lleva el coche sin lectura.',
    enabled: 'Recordatorio activo',
    enabledOn: 'se abren los avisos y salen los correos en las fechas de abajo.',
    enabledOff: 'no se abrirán avisos ni saldrán correos; los abiertos se cierran solos cuando llega la lectura.',
    scheduleOff: 'El recordatorio está apagado: este calendario no se aplicará hasta que lo actives y guardes.',
    windowTitle: 'Plazo de reclamación',
    /** El conmutador: por plazo (con su cadencia) o por días concretos. */
    byTitle: 'Cómo se fijan los días',
    byWindow: 'Plazo de reclamación',
    byDays: 'Días concretos',
    days: 'Días en que sale el correo',
    daysHint:
      'Días del mes separados por comas (solo cifras y comas), de menor a mayor. Cada mes sale un correo esos días; el día que un mes no tiene (el 31 en abril) no manda correo ese mes.',
    daysErrors: {
      empty: 'Escribe al menos un día (por ejemplo «5, 20, 28»).',
      range: 'Solo días del mes, del 1 al 31, separados por comas.',
      order: (day: number, prev: number) =>
        `El ${day} no puede ir después del ${prev}: escribe los días de menor a mayor.`,
    },
    /** El calendario: los días de la lista que ese mes no tiene. */
    scheduleMissing: (days: string, month: string) =>
      `${month} no tiene el día ${days}: ese día no sale correo.`,
    scheduleNone: (month: string) =>
      `${month} no tiene ninguno de esos días: ese mes no sale ningún correo.`,
    scheduleNoList: 'Escribe al menos un día para ver el calendario.',
    scheduleWindowDays: 'del primer al último día de la lista',
    /** Se recuerda antes de que el conductor pueda registrar (ventana N8a). */
    beforeWindow: (start: number) =>
      `El registro de km de campo se abre el día ${start} de cada mes: los correos anteriores reclaman una lectura que el conductor todavía no puede dar.`,
    cadenceOff: 'Con días concretos no hay cadencia: sale un correo cada día de la lista.',
    recipientsTitle: 'A quién se avisa',
    toDriver: 'Al conductor del coche',
    toDriverHint: 'Sin conductor (coche multiusuario o sin asignar), al supervisor del coche.',
    toSupervisor: 'Al supervisor del coche',
    toSupervisorHint: 'Además del conductor, al supervisor del coche.',
    adminsTitle: 'A estos administradores',
    adminsHint: 'Cada recordatorio les llega también a ellos. Solo administradores activos con correo.',
    adminsEmpty: 'No hay administradores con correo.',
    nobody: 'Elige al menos un destinatario: conductor, supervisor o algún administrador.',
    fromDay: 'Desde el día',
    fromDayHint: 'del mes en curso (1-28). Ese día se abre el aviso y sale el primer correo.',
    untilDay: 'hasta el día',
    untilDayHint: 'del mes siguiente (1-28). Con 0, el plazo acaba a fin de mes.',
    cadenceTitle: 'Cadencia de los correos',
    modes: {
      count: 'Un número de correos',
      countHint: 'repartidos a partes iguales: el primero al abrirse el plazo y el último el último día.',
      daily: 'Todos los días',
      dailyHint: 'un correo cada día del plazo.',
      odd: 'Los días impares',
      oddHint: 'los días 1, 3, 5… del calendario dentro del plazo.',
      even: 'Los días pares',
      evenHint: 'los días 2, 4, 6… del calendario dentro del plazo.',
    },
    emails: 'Correos por ventana',
    emailsMax: (n: number) => `Como mucho ${n}: los días que tiene el plazo en el mes más corto.`,
    emailsTooMany: (n: number) => `No caben más de ${n} correos en ese plazo.`,
    stopHint: 'Quien registre la lectura deja de recibirlos.',
    scheduleTitle: 'Así quedaría este mes',
    scheduleSummary: (n: number, from: string, until: string) =>
      n === 1
        ? `1 correo, el ${from}.`
        : `${n} correos entre el ${from} y el ${until}.`,
    scheduleWindow: 'plazo',
    scheduleEmail: 'día con correo',
    scheduleToday: 'hoy',
    scheduleDates: 'Fechas',
    templateTitle: 'Correo que recibirá el conductor',
    usingCustom: 'Se envía tu versión personalizada.',
    usingGeneric: 'Se envía la versión genérica: personalízala si quieres cambiar el texto.',
    customBadge: 'Personalizada',
    genericBadge: 'Genérica',
    editTemplate: 'Editar la plantilla',
    customise: 'Personalizar el correo',
    variablesHint:
      'En la plantilla puedes usar {{dias_sin_lectura}}, {{ultima_lectura}}, {{periodo}} y {{enlace_app}} además de {{matricula}} y {{conductor}}.',
  },
  /** Lo que cambia en el recordatorio de combustible respecto al de km: la
   * anotación es mensual igual, así que los mandos son los mismos. */
  fuel: {
    intro:
      'Cada mes, el conductor cuyo coche no tenga anotación de consumo recibe la alerta en la app y un correo. Aquí se decide en qué días del mes se reclama y con qué cadencia se le escribe mientras siga sin anotarlo. El aviso dice siempre cuántos días lleva el coche sin anotación.',
    enabledOn: 'se abren los avisos y salen los correos en las fechas de abajo.',
    enabledOff: 'no se abrirán avisos ni saldrán correos; los abiertos se cierran solos cuando llega la anotación.',
    stopHint: 'Quien anote el consumo deja de recibirlos.',
    variablesHint:
      'En la plantilla puedes usar {{dias_sin_lectura}} (días sin anotación), {{ultima_lectura}} (la última anotación), {{periodo}} y {{enlace_app}} además de {{matricula}} y {{conductor}}.',
  },
  /** Los recordatorios por vencimiento (ITV y mantenimiento): los días antes
   * y después de la fecha límite en que sale correo. */
  deadline: {
    title: 'Cuándo se avisa',
    intro: {
      itv: 'La cita de ITV de cada coche abre su aviso en la app. Con este recordatorio, además, sale un correo los días que elijas antes y después de la fecha límite, mientras la ITV siga sin registrarse.',
      maintenance:
        'El mantenimiento programado de cada coche abre su aviso en la app cuando se acerca por fecha. Con este recordatorio, además, sale un correo los días que elijas antes y después de la fecha límite, mientras el mantenimiento siga sin registrarse. Un plan solo por kilómetros no tiene fecha límite y no manda correo.',
    } as Record<string, string>,
    enabled: 'Recordatorio activo',
    enabledOn: 'sale un correo cada uno de esos días mientras el aviso siga abierto.',
    enabledOff: 'no saldrá ningún correo; el aviso de la app sigue abriéndose igual.',
    daysBefore: 'Días antes del vencimiento',
    daysBeforeHint:
      'Separados por comas, de 0 a 365 (0 = el mismo día). Por ejemplo «30, 15, 7, 1»: un correo a 30 días, otro a 15, otro a 7 y otro el día anterior.',
    daysAfter: 'Días después del vencimiento',
    daysAfterHint:
      'Separados por comas, de 1 a 365. Por ejemplo «1, 7, 15»: si se pasa la fecha sin registrarlo, un correo al día siguiente, a la semana y a los quince días.',
    daysError: 'Solo números de días separados por comas, dentro del rango.',
    daysNone: 'Escribe algún día antes o después del vencimiento: si no, no hay nada que mandar.',
    summaryTitle: 'Así quedaría',
    summaryOff: 'El recordatorio está apagado: no saldrá ningún correo hasta que lo actives y guardes.',
    summaryBefore: (n: number, days: string) =>
      n === 0
        ? 'Antes del vencimiento no sale ningún correo.'
        : n === 1
          ? `Antes del vencimiento, 1 correo: ${days}.`
          : `Antes del vencimiento, ${n} correos: ${days}.`,
    summaryAfter: (n: number, days: string) =>
      n === 0
        ? 'Pasada la fecha no sale ningún correo.'
        : n === 1
          ? `Pasada la fecha sin registrarlo, 1 correo: ${days}.`
          : `Pasada la fecha sin registrarlo, ${n} correos: ${days}.`,
    dayBefore: (d: number) => (d === 0 ? 'el mismo día' : d === 1 ? '1 día antes' : `${d} días antes`),
    dayAfter: (d: number) => (d === 1 ? '1 día después' : `${d} días después`),
    exampleTitle: (due: string) => `Ejemplo con un vencimiento el ${due}`,
    stopHint: 'Quien registre la ITV o el mantenimiento deja de recibirlos.',
    templateTitle: 'Correo que se enviará',
    variablesHint:
      'En la plantilla puedes usar {{fecha_vencimiento}}, {{mensaje}} (el texto del aviso) y {{enlace_app}} además de {{matricula}} y {{conductor}}.',
  },
  layout: {
    title: 'La caja corporativa de todos los correos',
    intro:
      'Toda plantilla sale dentro de la misma caja: cabecera con el logotipo y el color de marca, el cuerpo y un pie fijo. Lo que se cambia aquí cambia en todos los correos: alertas, comunicados, informes programados y pruebas.',
    enabled: 'Usar la maquetación corporativa',
    enabledHint: 'Apagada, el correo sale con el cuerpo de la plantilla a secas.',
    brandName: 'Nombre que encabeza y firma el correo',
    brandColor: 'Color de marca',
    brandColorHint: 'La franja bajo la cabecera. Formato #RRGGBB.',
    footer: 'Pie del correo',
    footerHint: 'Texto fijo al final de todos los correos (sin HTML).',
    logo: 'Logotipo',
    logoHint: 'PNG o JPG de hasta 300 KB. Va embebido en el correo, no como enlace.',
    logoChoose: 'Cambiar logotipo',
    logoDefault: 'Volver al logotipo por defecto',
    logoCustom: 'Logotipo personalizado',
    logoFactory: 'Logotipo por defecto',
    sectionHeader: 'Cabecera',
    sectionLogo: 'Logotipo',
    sectionFooter: 'Pie',
    logoFile: (name: string) => `Nuevo: ${name} (sin guardar)`,
    previewTitle: 'Vista previa',
    previewLive: 'Se actualiza mientras editas. Guarda para que los correos salgan así.',
    previewTemplate: 'Plantilla de ejemplo',
    previewGeneric: (name: string) => `${name} · genérica`,
    previewEmpty: 'No hay plantillas que previsualizar.',
  },
}

const en: typeof es = {
  reminderTab: 'Mileage reminder',
  fuelTab: 'Fuel reminder',
  itvTab: 'MOT reminder',
  maintenanceTab: 'Maintenance reminder',
  layoutTab: 'Email look',
  groups: {
    log: 'Log',
    settings: 'Settings',
    templates: 'Templates by email type',
  },
  tabGeneric: 'generic',
  tabCustom: 'custom',
  loading: 'Loading…',
  save: 'Save',
  saving: 'Saving…',
  saved: 'Settings saved. The job applies them on its next run.',
  loadError: 'The email settings could not be loaded.',
  previewError: 'The preview could not be generated.',
  reminder: {
    title: 'When and how often the driver is reminded',
    intro:
      'Every month, the driver of a vehicle with no mileage reading gets the alert in the app and an email. Here you decide on which days of the month it is claimed and how often they are written to while the reading is still missing. The notice always says how many days the vehicle has gone without a reading.',
    enabled: 'Reminder on',
    enabledOn: 'alerts open and emails go out on the dates below.',
    enabledOff: 'no alerts will open and no emails will go out; open ones close by themselves when the reading arrives.',
    scheduleOff: 'The reminder is off: this calendar will not apply until you turn it on and save.',
    windowTitle: 'Claim period',
    byTitle: 'How the days are set',
    byWindow: 'Claim period',
    byDays: 'Specific days',
    days: 'Days the email goes out',
    daysHint:
      'Days of the month separated by commas (digits and commas only), in ascending order. Every month an email goes out on those days; a day the month does not have (the 31st in April) sends nothing that month.',
    daysErrors: {
      empty: 'Write at least one day (for example "5, 20, 28").',
      range: 'Only days of the month, 1 to 31, separated by commas.',
      order: (day: number, prev: number) =>
        `${day} cannot come after ${prev}: write the days in ascending order.`,
    },
    scheduleMissing: (days: string, month: string) =>
      `${month} has no day ${days}: no email goes out that day.`,
    scheduleNone: (month: string) => `${month} has none of those days: no email goes out that month.`,
    scheduleNoList: 'Write at least one day to see the calendar.',
    scheduleWindowDays: 'from the first to the last day of the list',
    beforeWindow: (start: number) =>
      `Field mileage entry opens on day ${start} of each month: emails before that claim a reading the driver cannot give yet.`,
    cadenceOff: 'With specific days there is no cadence: one email goes out on each listed day.',
    recipientsTitle: 'Who is reminded',
    toDriver: 'The vehicle driver',
    toDriverHint: 'With no driver (pool vehicle or unassigned), the vehicle supervisor.',
    toSupervisor: 'The vehicle supervisor',
    toSupervisorHint: 'Besides the driver, the vehicle supervisor.',
    adminsTitle: 'These administrators',
    adminsHint: 'Every reminder also reaches them. Only active administrators with an email.',
    adminsEmpty: 'There are no administrators with an email.',
    nobody: 'Choose at least one recipient: driver, supervisor or an administrator.',
    fromDay: 'From day',
    fromDayHint: 'of the current month (1-28). The alert opens and the first email goes out that day.',
    untilDay: 'until day',
    untilDayHint: 'of the next month (1-28). With 0, the period ends at the end of the month.',
    cadenceTitle: 'Email cadence',
    modes: {
      count: 'A number of emails',
      countHint: 'spread evenly: the first when the period opens and the last on its final day.',
      daily: 'Every day',
      dailyHint: 'one email each day of the period.',
      odd: 'Odd days',
      oddHint: 'calendar days 1, 3, 5… within the period.',
      even: 'Even days',
      evenHint: 'calendar days 2, 4, 6… within the period.',
    },
    emails: 'Emails per window',
    emailsMax: (n: number) => `At most ${n}: the days the period has in the shortest month.`,
    emailsTooMany: (n: number) => `No more than ${n} emails fit in that period.`,
    stopHint: 'Whoever records the reading stops getting them.',
    scheduleTitle: 'This is how this month would look',
    scheduleSummary: (n: number, from: string, until: string) =>
      n === 1 ? `1 email, on ${from}.` : `${n} emails between ${from} and ${until}.`,
    scheduleWindow: 'period',
    scheduleEmail: 'day with an email',
    scheduleToday: 'today',
    scheduleDates: 'Dates',
    templateTitle: 'Email the driver will receive',
    usingCustom: 'Your custom version is sent.',
    usingGeneric: 'The generic version is sent: customise it to change the text.',
    customBadge: 'Custom',
    genericBadge: 'Generic',
    editTemplate: 'Edit the template',
    customise: 'Customise the email',
    variablesHint:
      'In the template you can use {{dias_sin_lectura}}, {{ultima_lectura}}, {{periodo}} and {{enlace_app}} besides {{matricula}} and {{conductor}}.',
  },
  fuel: {
    intro:
      'Each month, the driver whose car has no fuel consumption entry gets the alert in the app and an email. Here you decide on which days of the month it is claimed and how often they are written to while they still have not logged it. The alert always says how many days the car has gone without an entry.',
    enabledOn: 'alerts open and emails go out on the dates below.',
    enabledOff: 'no alerts will open and no emails will go out; open ones close by themselves when the entry arrives.',
    stopHint: 'Whoever logs the consumption stops receiving them.',
    variablesHint:
      'In the template you can use {{dias_sin_lectura}} (days without an entry), {{ultima_lectura}} (the last entry), {{periodo}} and {{enlace_app}} besides {{matricula}} and {{conductor}}.',
  },
  deadline: {
    title: 'When to notify',
    intro: {
      itv: 'Each car’s MOT appointment opens its alert in the app. With this reminder, an email also goes out on the days you choose before and after the deadline, while the MOT remains unlogged.',
      maintenance:
        'Each car’s scheduled maintenance opens its alert in the app as the date approaches. With this reminder, an email also goes out on the days you choose before and after the deadline, while the maintenance remains unlogged. A plan by mileage only has no deadline and sends no email.',
    } as Record<string, string>,
    enabled: 'Reminder on',
    enabledOn: 'an email goes out on each of those days while the alert stays open.',
    enabledOff: 'no email will go out; the app alert still opens as usual.',
    daysBefore: 'Days before the deadline',
    daysBeforeHint:
      'Comma-separated, 0 to 365 (0 = the same day). For example “30, 15, 7, 1”: an email 30 days before, another at 15, another at 7 and one the day before.',
    daysAfter: 'Days after the deadline',
    daysAfterHint:
      'Comma-separated, 1 to 365. For example “1, 7, 15”: if the date passes unlogged, an email the next day, a week later and fifteen days later.',
    daysError: 'Only numbers of days separated by commas, within the range.',
    daysNone: 'Enter some day before or after the deadline: otherwise there is nothing to send.',
    summaryTitle: 'This is how it would go',
    summaryOff: 'The reminder is off: no email will go out until you turn it on and save.',
    summaryBefore: (n: number, days: string) =>
      n === 0
        ? 'No email goes out before the deadline.'
        : n === 1
          ? `Before the deadline, 1 email: ${days}.`
          : `Before the deadline, ${n} emails: ${days}.`,
    summaryAfter: (n: number, days: string) =>
      n === 0
        ? 'No email goes out once the date has passed.'
        : n === 1
          ? `Past the date without logging it, 1 email: ${days}.`
          : `Past the date without logging it, ${n} emails: ${days}.`,
    dayBefore: (d: number) => (d === 0 ? 'the same day' : d === 1 ? '1 day before' : `${d} days before`),
    dayAfter: (d: number) => (d === 1 ? '1 day after' : `${d} days after`),
    exampleTitle: (due: string) => `Example with a deadline on ${due}`,
    stopHint: 'Whoever logs the MOT or the maintenance stops receiving them.',
    templateTitle: 'Email that will be sent',
    variablesHint:
      'In the template you can use {{fecha_vencimiento}}, {{mensaje}} (the alert text) and {{enlace_app}} besides {{matricula}} and {{conductor}}.',
  },
  layout: {
    title: 'The corporate frame of every email',
    intro:
      'Every template goes out inside the same frame: a header with the logo and brand colour, the body and a fixed footer. What you change here changes in every email: alerts, notices, scheduled reports and tests.',
    enabled: 'Use the corporate layout',
    enabledHint: 'Off, the email goes out with the bare template body.',
    brandName: 'Name heading and signing the email',
    brandColor: 'Brand colour',
    brandColorHint: 'The stripe under the header. #RRGGBB format.',
    footer: 'Email footer',
    footerHint: 'Fixed text at the end of every email (no HTML).',
    logo: 'Logo',
    logoHint: 'PNG or JPG up to 300 KB. Embedded in the email, not linked.',
    logoChoose: 'Change logo',
    logoDefault: 'Back to the default logo',
    logoCustom: 'Custom logo',
    logoFactory: 'Default logo',
    sectionHeader: 'Header',
    sectionLogo: 'Logo',
    sectionFooter: 'Footer',
    logoFile: (name: string) => `New: ${name} (unsaved)`,
    previewTitle: 'Preview',
    previewLive: 'Updates as you edit. Save so emails go out like this.',
    previewTemplate: 'Sample template',
    previewGeneric: (name: string) => `${name} · generic`,
    previewEmpty: 'There are no templates to preview.',
  },
}

export function useEmailSettingsCopy() {
  const lang = useAppLang()
  return lang === 'en' ? en : es
}
