/**
 * Genera y descarga en el cliente un CSV de plantilla (cabeceras + fila de ejemplo).
 *
 * Nota: los valores se unen con comas sin escapado. Es suficiente para
 * cabeceras/plantillas controladas; si algún valor pudiera contener comas,
 * comillas o saltos de línea, hay que añadir escapado RFC-4180 antes.
 */
export function downloadCsvTemplateFile({
  filename,
  headers,
  exampleRow,
}: {
  filename: string
  headers: string[]
  exampleRow?: string[]
}): void {
  const rows: string[] = [headers.join(',')]

  if (exampleRow) {
    rows.push(exampleRow.join(','))
  }

  const csvContent = rows.join('\n')
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)

  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
