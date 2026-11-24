/**
 * Copy de **corregir la última lectura de km o el último consumo** desde la
 * app de campo.
 *
 * Para quien conduce esas anotaciones no se editan: una cifra mal tecleada se
 * arreglaba por teléfono. Ahora se PIDE desde el propio formulario, y hasta que
 * la administración la aprueba o la deniega se enseñan las dos cifras: la
 * original y la pendiente de cambio.
 */
import { useAppLang } from '@flota/ui/i18n'

const es = {
  /** El botón del formulario de km / de consumo. */
  button: 'Corregir la última lectura',
  buttonFuel: 'Corregir la última anotación',
  title: 'Corregir la última lectura de km',
  titleFuel: 'Corregir la última anotación de consumo',
  hint: 'Desde aquí se pide, no se guarda: administración aprobará la corrección o la denegará. Hasta entonces verás las dos, la original y la pendiente de cambio.',
  /** La anotación ANTERIOR a la que se corrige: la referencia de la cifra nueva. */
  previous: 'Lectura anterior',
  previousFuel: 'Anotación anterior',
  noPrevious: 'Es la primera lectura del coche: no hay ninguna anterior.',
  noPreviousFuel: 'Es la primera anotación del coche: no hay ninguna anterior.',
  original: 'Original',
  pending: 'Pendiente de cambio',
  pendingBadge: 'Corrección pendiente',
  /** Con una corrección viva no se pide otra. */
  pendingNote: 'Ya has pedido corregirla: administración la aprobará o la denegará.',
  date: 'Fecha',
  odometer: 'Odómetro (km)',
  consumption: 'Consumo medio (l/100km o kWh/100km)',
  note: 'Por qué (opcional)',
  nothing: 'No has cambiado nada: corrige la fecha o la cifra.',
  submit: 'Pedir la corrección',
  sending: 'Enviando…',
  ok: 'Corrección pedida. Administración la aprobará o la denegará; mientras tanto verás las dos lecturas.',
  error: 'No se pudo pedir la corrección.',
  close: 'Cerrar',
  cancel: 'Cancelar',
  /** «Mi perfil → Peticiones». */
  kindKm: 'Corrección de km',
  kindFuel: 'Corrección de consumo',
  status: { pending: 'Pendiente', done: 'Aprobada', rejected: 'Denegada', cancelled: 'Anulada' },
  /** Registrar una anotación nueva con una corrección esperando: la anula. */
  supersedeTitle: 'Tienes una corrección pendiente',
  supersedeKm:
    'Pediste corregir la última lectura de km y administración aún no lo ha decidido. Si registras una lectura nueva, esa corrección se anula: la lectura anterior se queda como está.',
  supersedeFuel:
    'Pediste corregir la última anotación de consumo y administración aún no lo ha decidido. Si anotas un consumo nuevo, esa corrección se anula: la anotación anterior se queda como está.',
  supersedeContinue: 'Registrar y anular la corrección',
  fields: { reading_date: 'Fecha', km_reading: 'Odómetro', avg_consumption: 'Consumo' },
}

type Copy = typeof es

const en: Copy = {
  button: 'Fix the last reading',
  buttonFuel: 'Fix the last entry',
  title: 'Fix the last mileage reading',
  titleFuel: 'Fix the last consumption entry',
  hint: 'This asks, it does not save: administration will approve or deny the correction. Until then you will see both, the original and the pending change.',
  previous: 'Previous reading',
  previousFuel: 'Previous entry',
  noPrevious: 'This is the first reading of the vehicle: there is none before it.',
  noPreviousFuel: 'This is the first entry of the vehicle: there is none before it.',
  original: 'Original',
  pending: 'Pending change',
  pendingBadge: 'Correction pending',
  pendingNote: 'You already asked to fix it: administration will approve or deny it.',
  date: 'Date',
  odometer: 'Odometer (km)',
  consumption: 'Average consumption (l/100km or kWh/100km)',
  note: 'Why (optional)',
  nothing: 'You changed nothing: fix the date or the figure.',
  submit: 'Ask for the correction',
  sending: 'Sending…',
  ok: 'Correction requested. Administration will approve or deny it; meanwhile you will see both readings.',
  error: 'The correction could not be requested.',
  close: 'Close',
  cancel: 'Cancel',
  kindKm: 'Mileage correction',
  kindFuel: 'Consumption correction',
  status: { pending: 'Pending', done: 'Approved', rejected: 'Denied', cancelled: 'Cancelled' },
  supersedeTitle: 'You have a pending correction',
  supersedeKm:
    'You asked to fix the last mileage reading and administration has not decided yet. If you register a new reading, that correction is cancelled: the previous reading stays as it is.',
  supersedeFuel:
    'You asked to fix the last consumption entry and administration has not decided yet. If you note a new consumption, that correction is cancelled: the previous entry stays as it is.',
  supersedeContinue: 'Register and cancel the correction',
  fields: { reading_date: 'Date', km_reading: 'Odometer', avg_consumption: 'Consumption' },
}

const dict = { es, en }

export function useReadingChangeCopy(): Copy {
  return dict[useAppLang()]
}
