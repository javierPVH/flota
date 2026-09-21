/** Propuesta de próxima ITV: cada cuánto vuelve a tocar.
 *
 * La periodicidad legal española depende de la EDAD del vehículo (desde su
 * matriculación) y de lo que sea. Es una PROPUESTA para no teclear la fecha a
 * mano: manda siempre la del informe de la estación, y por eso el campo queda
 * editable después de calcularla.
 *
 * Tabla aplicada (turismos y motos, furgonetas ≤3.500 kg, camiones):
 * - Turismo: hasta 10 años, cada 2 años; a partir de 10, anual.
 * - Motocicleta: cada 2 años.
 * - Furgoneta: hasta 6 años, cada 2 años; de 6 a 10, anual; a partir de 10,
 *   cada 6 meses.
 * - Camión: hasta 10 años, anual; a partir de 10, cada 6 meses.
 * - Sin fecha de matriculación o de un tipo que no está en la tabla: anual,
 *   que es el intervalo más corto de los habituales — propone antes de tiempo
 *   en vez de tarde.
 */

/** Meses que se suman a la inspección, por tipo y edad del vehículo. */
function periodMonths(type: string, ageYears: number | null): number {
  if (type === 'motorcycle') return 24
  if (ageYears === null) return 12
  if (type === 'van') {
    if (ageYears > 10) return 6
    return ageYears >= 6 ? 12 : 24
  }
  if (type === 'truck') return ageYears > 10 ? 6 : 12
  if (type === 'car') return ageYears > 10 ? 12 : 24
  return 12
}

/** Años cumplidos entre dos fechas ISO (YYYY-MM-DD), en local. */
function yearsBetween(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00`)
  const to = new Date(`${toIso}T00:00:00`)
  let years = to.getFullYear() - from.getFullYear()
  const beforeAnniversary =
    to.getMonth() < from.getMonth() ||
    (to.getMonth() === from.getMonth() && to.getDate() < from.getDate())
  if (beforeAnniversary) years -= 1
  return years
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

export interface ItvProposal {
  /** Fecha propuesta, en ISO. */
  date: string
  /** Periodicidad aplicada, en meses (para decir de dónde sale la fecha). */
  months: number
}

/** Propone la próxima ITV a partir de la fecha de ESTA inspección. Devuelve
 * `null` si aún no hay fecha de inspección: sin ella no hay nada que calcular. */
export function proposeNextItv(
  vehicle: { type?: string; registration_date?: string | null },
  inspectionIso: string,
): ItvProposal | null {
  if (!inspectionIso) return null
  const registration = vehicle.registration_date || null
  const age = registration ? yearsBetween(registration, inspectionIso) : null
  const months = periodMonths(vehicle.type ?? '', age)
  return { date: addMonths(inspectionIso, months), months }
}
