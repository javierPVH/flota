/**
 * [ES] Normalización de fechas para serializadores de Django.
 *
 * El backend exige `YYYY-MM-DD`. Los CSV/Excel del cliente llegan con formatos
 * variados (DD/MM/YYYY europeo, DD.MM.YYYY, números de serie de Excel,
 * timestamps ISO con hora, etc.). Esta utilidad intenta interpretar la
 * mayoría y devolver una cadena válida; si no, marca el valor como inválido
 * para que el llamador lo reporte antes de enviar al backend.
 */

export interface NormalizedFecha {
  /** Fecha en formato YYYY-MM-DD si fue posible normalizar; `null` si la
   *  entrada estaba vacía; string original si quedó inválida. */
  value: string | null
  /** `true` si la entrada era vacía o se normalizó correctamente. */
  valid: boolean
  /** Texto original (sin tocar, sólo trim) — útil para reportar errores. */
  raw: string
}

/** Pad numérico a `width` posiciones con ceros a la izquierda. */
function pad(n: number, width: number): string {
  return String(n).padStart(width, '0')
}

/** ¿(y, m, d) forman una fecha calendario real? Excluye 31/02, 2025-13-01, etc. */
function isRealDate(y: number, m: number, d: number): boolean {
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return false
  if (m < 1 || m > 12 || d < 1 || d > 31) return false
  if (y < 1900 || y > 2999) return false
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y
    && dt.getUTCMonth() === m - 1
    && dt.getUTCDate() === d
}

function formatYmd(y: number, m: number, d: number): NormalizedFecha {
  if (!isRealDate(y, m, d)) return { value: `${y}-${m}-${d}`, valid: false, raw: '' }
  return { value: `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`, valid: true, raw: '' }
}

/** Excel almacena las fechas como nº de días desde 1899-12-30 (manteniendo
 *  el bug histórico que trata 1900 como bisiesto). Sólo aceptamos enteros o
 *  decimales en un rango razonable [1, 200000] (~ años 1900-2447). */
function fromExcelSerial(n: number): NormalizedFecha | null {
  if (!Number.isFinite(n) || n < 1 || n > 200000) return null
  const epoch = Date.UTC(1899, 11, 30)
  const ms = epoch + Math.floor(n) * 86400000
  const dt = new Date(ms)
  return formatYmd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
}

/**
 * Normaliza una fecha en formato variado al esperado por el backend.
 *
 * Formatos soportados:
 *   - `YYYY-MM-DD` (passthrough)
 *   - `YYYY/MM/DD`, `YYYY.MM.DD`
 *   - `DD/MM/YYYY`, `D/M/YYYY` (formato europeo común)
 *   - `DD-MM-YYYY`, `D-M-YYYY`
 *   - `DD.MM.YYYY`, `D.M.YYYY`
 *   - `DD/MM/YY` (asume siglo 20XX si YY < 70, 19XX si ≥ 70)
 *   - `YYYY-MM-DD HH:MM:SS` o `YYYY-MM-DDTHH:MM:SS[Z]` — se descarta la hora
 *   - Número de serie de Excel (entero o decimal positivo).
 */
export function normalizeFechaForDb(raw: unknown): NormalizedFecha {
  if (raw == null) return { value: null, valid: true, raw: '' }
  const s = String(raw).trim()
  if (!s) return { value: null, valid: true, raw: '' }

  // Excel serial (número puro, sin separadores de fecha).
  if (/^\d{1,6}(?:[.,]\d+)?$/.test(s)) {
    const n = Number(s.replace(',', '.'))
    const fromSerial = fromExcelSerial(n)
    if (fromSerial) return { ...fromSerial, raw: s }
    // Si el número está fuera del rango razonable, sigue como inválido.
    return { value: s, valid: false, raw: s }
  }

  // ISO con hora — quedarse con la parte de fecha.
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ]\d{1,2}:\d{1,2}(?::\d{1,2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/)
  if (iso) {
    return { ...formatYmd(Number(iso[1]), Number(iso[2]), Number(iso[3])), raw: s }
  }

  // YYYY[sep]MM[sep]DD con separadores /, ., -
  const ymd = s.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/)
  if (ymd) {
    return { ...formatYmd(Number(ymd[1]), Number(ymd[2]), Number(ymd[3])), raw: s }
  }

  // DD[sep]MM[sep]YYYY o DD[sep]MM[sep]YY con separadores /, ., -
  const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/)
  if (dmy) {
    const dd = Number(dmy[1])
    const mm = Number(dmy[2])
    let yyyy = Number(dmy[3])
    if (dmy[3].length === 2) {
      // Heurística estándar: <70 → 2000+, ≥70 → 1900+. Coincide con la regla
      // que aplica Excel y la mayoría de hojas de cálculo.
      yyyy = yyyy < 70 ? 2000 + yyyy : 1900 + yyyy
    }
    return { ...formatYmd(yyyy, mm, dd), raw: s }
  }

  return { value: s, valid: false, raw: s }
}
