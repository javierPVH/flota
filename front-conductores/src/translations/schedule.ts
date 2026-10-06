/**
 * Copy de **programar** desde la app de campo: la próxima ITV y el
 * mantenimiento preventivo de un coche del grupo.
 *
 * Hasta ahora citar era solo de gestión (`ScheduleItvMaintenanceModal` en el
 * escritorio) y el campo únicamente REGISTRABA lo ya hecho. Quien supervisa
 * responde de sus coches, así que también cita los suyos; el back lo acota a su
 * grupo. Se dice en los dos idiomas lo mismo que allí —es la misma cita— y lo
 * que no se decide en campo no se pregunta: ni el calendario del taller ni
 * retirar la cita, que sigue siendo de administración.
 */
import { useAppLang } from '@flota/ui/i18n'

const es = {
  itv: {
    button: 'Programar ITV',
    title: (plate: string) => `Programar ITV · ${plate}`,
    /** Ya tiene cita: esto la CORRIGE, no añade una segunda. */
    current: (date: string) => `Ahora está citada el ${date}. Guardar la corrige: la cita es una.`,
    none: 'Este coche no tiene ninguna ITV citada.',
    date: 'Fecha de la ITV',
    dateHint: 'La que te haya dado la estación. Se puede corregir después.',
    postalCode: 'CP preferente',
    postalCodeHint:
      'Opcional: desde dónde buscar estación. No es la estación, es la zona.',
    postalCodeInvalid: 'Indica un código postal de 5 cifras.',
    dateRequired: 'Indica la fecha de la ITV.',
    submit: 'Programar',
    saving: 'Programando…',
    saved: (date: string) => `ITV citada el ${date}. El aviso saldrá cuando se acerque.`,
    error: 'No se pudo programar la ITV.',
  },
  maintenance: {
    button: 'Programar mantenimiento',
    title: (plate: string) => `Programar mantenimiento · ${plate}`,
    /** Un coche tiene UNO a la vez: el back rechaza el segundo, así que en vez
     * de dejar guardar para enseñar un error se dice antes. */
    already: 'Este coche ya tiene un mantenimiento programado:',
    alreadyHint:
      'Solo puede haber uno a la vez. Márcalo como realizado cuando toque, o pide a administración que lo cambie.',
    program: 'Qué mantenimiento',
    programHint: 'Del catálogo común de la flota. El «cada cuánto» se copia de aquí.',
    programRequired: 'Elige qué mantenimiento se programa.',
    programEmpty:
      'No hay ningún programa en el catálogo. Lo da de alta administración en Ajustes.',
    fromDate: 'Contando desde (fecha)',
    fromDateHint: 'El último realizado. Si nunca se ha hecho, vale la fecha de hoy.',
    fromKm: 'Contando desde (km)',
    fromKmHint:
      'El odómetro del último realizado. Si nunca se ha hecho, el actual del coche: contar desde 0 abriría ya un aviso de «objetivo superado».',
    fromKmRequired: 'Indica desde qué kilometraje cuenta el ciclo.',
    loadKm: (km: string) => `Cargar los del coche (${km})`,
    postalCode: 'CP preferente',
    postalCodeHint: 'Opcional: desde dónde buscar taller cuando toque.',
    submit: 'Programar',
    saving: 'Programando…',
    saved: 'Mantenimiento programado. El aviso saldrá cuando se acerque el ciclo.',
    error: 'No se pudo programar el mantenimiento.',
    loading: 'Cargando el catálogo…',
  },
  /** El mismo pie en los dos. */
  cancel: 'Cancelar',
  close: 'Cerrar',
}

type Copy = typeof es

const en: Copy = {
  itv: {
    button: 'Schedule MOT',
    title: (plate) => `Schedule MOT · ${plate}`,
    current: (date) => `Currently booked for ${date}. Saving corrects it: there is only one.`,
    none: 'This vehicle has no MOT booked.',
    date: 'MOT date',
    dateHint: 'The one the test centre gave you. It can be corrected later.',
    postalCode: 'Preferred postcode',
    postalCodeHint: 'Optional: where to look for a test centre. The area, not the centre.',
    postalCodeInvalid: 'Enter a 5-digit postcode.',
    dateRequired: 'Enter the MOT date.',
    submit: 'Schedule',
    saving: 'Scheduling…',
    saved: (date) => `MOT booked for ${date}. The alert will come up as it approaches.`,
    error: 'The MOT could not be scheduled.',
  },
  maintenance: {
    button: 'Schedule service',
    title: (plate) => `Schedule service · ${plate}`,
    already: 'This vehicle already has a service scheduled:',
    alreadyHint:
      'There can only be one at a time. Mark it as done when it is due, or ask the back office to change it.',
    program: 'Which service',
    programHint: "From the fleet's shared catalogue. The interval is copied from it.",
    programRequired: 'Choose which service to schedule.',
    programEmpty: 'The catalogue is empty. The back office adds programmes in Settings.',
    fromDate: 'Counting from (date)',
    fromDateHint: 'The last one done. If it never was, today will do.',
    fromKm: 'Counting from (km)',
    fromKmHint:
      "The odometer at the last one. If it never was, the vehicle's current reading: counting from 0 would open a \"target passed\" alert right away.",
    fromKmRequired: 'Enter the mileage the cycle counts from.',
    loadKm: (km) => `Use the vehicle's (${km})`,
    postalCode: 'Preferred postcode',
    postalCodeHint: 'Optional: where to look for a garage when it is due.',
    submit: 'Schedule',
    saving: 'Scheduling…',
    saved: 'Service scheduled. The alert will come up as the cycle approaches.',
    error: 'The service could not be scheduled.',
    loading: 'Loading the catalogue…',
  },
  cancel: 'Cancel',
  close: 'Close',
}

const dict = { es, en }

export function useScheduleCopy(): Copy {
  return dict[useAppLang()]
}
