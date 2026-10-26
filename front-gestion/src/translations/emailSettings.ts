/**
 * Copia de Ajustes → Correo → «Recordatorio de km» y «Aspecto del correo»
 * (`EmailSettingsPanel`): la parametrización del recordatorio y la caja
 * corporativa que envuelve todos los correos.
 */
import { useAppLang } from '@flota/ui/i18n'

const es = {
  reminderTab: 'Recordatorio de km',
  layoutTab: 'Aspecto del correo',
  loading: 'Cargando…',
  save: 'Guardar',
  saving: 'Guardando…',
  saved: 'Ajustes guardados. El job los aplica en su siguiente pasada.',
  loadError: 'No se pudieron cargar los ajustes del correo.',
  previewError: 'No se pudo generar la vista previa.',
  reminder: {
    title: 'Cuándo y cuántas veces se avisa al conductor',
    intro:
      'Cada mes, el conductor cuyo coche no tenga lectura de km recibe la alerta en la app y un correo. Aquí se decide en qué días del mes se reclama y cuántos correos recibe mientras siga sin registrarla. El aviso dice siempre cuántos días lleva el coche sin lectura.',
    fromDay: 'Se empieza a reclamar el día',
    fromDayHint: 'Del mes en curso (1-28). Ese día se abre el aviso y sale el primer correo.',
    untilDay: 'Se sigue reclamando hasta el día',
    untilDayHint: 'Del mes siguiente (1-28). Con 0, el plazo acaba a fin de mes.',
    emails: 'Correos por ventana',
    emailsHint:
      'De 1 a 6. Se reparten a partes iguales: el primero al abrirse el plazo y el último el último día. Quien registre la lectura deja de recibirlos.',
    scheduleTitle: 'Con estos ajustes, este mes los correos saldrían:',
    scheduleEmpty: 'Con ese plazo solo cabe un correo.',
    previewTitle: 'Así es el correo que recibirá',
    previewMissing:
      'No hay plantilla «Lectura de km pendiente» definida: se enviará la genérica. Créala en su pestaña para personalizarla.',
    editTemplate: 'Editar la plantilla',
    variablesHint:
      'En la plantilla puedes usar {{dias_sin_lectura}}, {{ultima_lectura}} y {{periodo}} además de {{matricula}} y {{conductor}}.',
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
    previewTitle: 'Vista previa con la plantilla seleccionada',
    previewTemplate: 'Plantilla de ejemplo',
    previewEmpty: 'Define una plantilla para ver la vista previa.',
  },
}

const en: typeof es = {
  reminderTab: 'Mileage reminder',
  layoutTab: 'Email look',
  loading: 'Loading…',
  save: 'Save',
  saving: 'Saving…',
  saved: 'Settings saved. The job applies them on its next run.',
  loadError: 'The email settings could not be loaded.',
  previewError: 'The preview could not be generated.',
  reminder: {
    title: 'When and how often the driver is reminded',
    intro:
      'Every month, the driver of a vehicle with no mileage reading gets the alert in the app and an email. Here you decide on which days of the month it is claimed and how many emails they get while the reading is still missing. The notice always says how many days the vehicle has gone without a reading.',
    fromDay: 'Start claiming on day',
    fromDayHint: 'Of the current month (1-28). The alert opens and the first email goes out that day.',
    untilDay: 'Keep claiming until day',
    untilDayHint: 'Of the next month (1-28). With 0, the deadline is the end of the month.',
    emails: 'Emails per window',
    emailsHint:
      '1 to 6, spread evenly: the first when the window opens and the last on the final day. Whoever records the reading stops getting them.',
    scheduleTitle: 'With these settings, this month the emails would go out on:',
    scheduleEmpty: 'That window only fits one email.',
    previewTitle: 'This is the email they will receive',
    previewMissing:
      'There is no «Mileage reading pending» template: the generic one will be sent. Create it in its tab to customise it.',
    editTemplate: 'Edit the template',
    variablesHint:
      'In the template you can use {{dias_sin_lectura}}, {{ultima_lectura}} and {{periodo}} besides {{matricula}} and {{conductor}}.',
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
    previewTitle: 'Preview with the selected template',
    previewTemplate: 'Sample template',
    previewEmpty: 'Define a template to see the preview.',
  },
}

export function useEmailSettingsCopy() {
  const lang = useAppLang()
  return lang === 'en' ? en : es
}
