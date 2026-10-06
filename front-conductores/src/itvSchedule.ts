/** La PRIMERA ITV: cuándo empieza a tocar.
 *
 * En campo no se programa ninguna cita —eso es de gestión—, así que lo único
 * que este módulo decide es si el coche es todavía demasiado nuevo para tener
 * que pasar la ITV, que es lo que avisa el formulario de registro.
 *
 * Aquí vivía también la PROPUESTA de la próxima (la periodicidad legal por
 * tipo y edad, que alimentaba un botón «Calcular» junto al campo «Próxima
 * ITV»). Se retiró con el campo: la fecha de la siguiente inspección la pone
 * la gestión, y proponerla desde el móvil solo servía para que dos sitios
 * dijeran cosas distintas.
 */

/**
 * Edad a la que toca la PRIMERA ITV, en años y por tipo: un coche recién
 * matriculado no pasa ninguna. Turismos y motos, a los 4; furgonetas, a los
 * 2; camiones, al año —no son cuatro para todos, y decirle a quien supervisa
 * que a su furgoneta de tres años no le toca sería mandarla sin ITV—.
 *
 * Un tipo que no esté en la tabla no dice nada: callar es mejor que afirmar
 * que no hace falta.
 */
const FIRST_ITV_YEARS: Record<string, number> = {
  car: 4,
  motorcycle: 4,
  van: 2,
  truck: 1,
}

/** Suma meses a una fecha ISO sin salirse del mes: el 31 de enero + 1 mes es
 * el 28/29 de febrero, no el 3 de marzo (que es lo que hace `setMonth`). */
function addMonths(iso: string, months: number): string {
  const day = new Date(`${iso}T00:00:00`)
  const target = new Date(day.getFullYear(), day.getMonth() + months, 1)
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  target.setDate(Math.min(day.getDate(), lastDay))
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`
}

export interface ItvNotDueYet {
  /** Edad a la que le toca la primera, en años. */
  years: number
  /** El día en que la cumple, en ISO. */
  dueOn: string
}

/**
 * ¿Es el coche demasiado nuevo para tener que pasar la ITV? Devuelve a qué
 * edad le toca la primera y cuándo la cumple, o `null` si ya le toca —o si no
 * se puede afirmar: sin fecha de matriculación o con un tipo fuera de la
 * tabla—.
 *
 * Es informativo y NO apaga nada: la cita la pone la gestión y puede tener
 * sus motivos (una revisión voluntaria, un vehículo importado), así que lo
 * que hace el campo es leerlo y preguntar.
 */
export function itvNotDueYet(
  vehicle: { type?: string; registration_date?: string | null },
  todayIsoDate: string,
): ItvNotDueYet | null {
  const registration = vehicle.registration_date || null
  const years = FIRST_ITV_YEARS[vehicle.type ?? '']
  if (!registration || years === undefined) return null
  const dueOn = addMonths(registration, years * 12)
  // Fechas ISO: comparar como texto ya las ordena.
  return dueOn > todayIsoDate ? { years, dueOn } : null
}
