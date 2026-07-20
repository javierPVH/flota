import { read, utils, type WorkBook } from 'xlsx'

/** Spreadsheet extensions that need client-side conversion to CSV. */
const EXCEL_EXTENSIONS = new Set(['.xlsx', '.xls', '.xlsb', '.xlsm', '.ods', '.fods', '.numbers'])

/** Returns true when the file extension belongs to a spreadsheet format. */
export function isSpreadsheet(file: File): boolean {
  const dot = file.name.lastIndexOf('.')
  if (dot === -1) return false
  return EXCEL_EXTENSIONS.has(file.name.slice(dot).toLowerCase())
}

export interface SheetInfo {
  name: string
  rows: number
}

export interface ParsedWorkbook {
  file: File
  workbook: WorkBook
  sheets: SheetInfo[]
}

/** Read a File into a SheetJS workbook. */
export async function parseWorkbook(file: File): Promise<ParsedWorkbook> {
  const buffer = await file.arrayBuffer()
  let workbook: WorkBook
  try {
    workbook = read(buffer, { type: 'array' })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('Encrypted') || msg.includes('password')) {
      throw new Error(`El archivo "${file.name}" está protegido con contraseña. Quita la protección y vuelve a intentarlo.`)
    }
    throw new Error(`No se pudo leer "${file.name}": ${msg}`)
  }
  const sheets: SheetInfo[] = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name]
    const range = utils.decode_range(sheet['!ref'] ?? 'A1')
    return { name, rows: range.e.r - range.s.r + 1 }
  })
  return { file, workbook, sheets }
}

/** Convert a single sheet of a workbook to a CSV File object. */
export function sheetToCsvFile(parsed: ParsedWorkbook, sheetName: string): File {
  const sheet = parsed.workbook.Sheets[sheetName]
  const csv = utils.sheet_to_csv(sheet)
  const baseName = parsed.file.name.replace(/\.[^.]+$/, '')
  const blob = new Blob([csv], { type: 'text/csv' })
  return new File([blob], `${baseName}.csv`, { type: 'text/csv' })
}

/**
 * Process a list of files: CSV files pass through unchanged,
 * single-sheet spreadsheets are auto-converted, multi-sheet spreadsheets
 * are returned via `onMultiSheet` callback so the UI can ask the user.
 *
 * Returns the final File[] ready to upload (all CSV).
 */
export async function convertFilesToCsv(
  files: File[],
  onMultiSheet: (parsed: ParsedWorkbook) => Promise<string>,
): Promise<File[]> {
  const result: File[] = []

  for (const file of files) {
    if (!isSpreadsheet(file)) {
      result.push(file)
      continue
    }

    const parsed = await parseWorkbook(file)

    if (parsed.sheets.length === 1) {
      const csv = sheetToCsvFile(parsed, parsed.sheets[0].name)
      result.push(csv)
    } else {
      const chosenSheet = await onMultiSheet(parsed)
      result.push(sheetToCsvFile(parsed, chosenSheet))
    }
  }

  return result
}
