/** Tipos del asistente de importación masiva (IMPORTACION_MASIVA.md §5.1). */

/**
 * Campo destino de la BD. Las etiquetas/hints salen de las traducciones
 * (`useBulkImportCopy().fields[entity]`); los ALIAS de auto-mapeo viven en el
 * BACK (una sola fuente), no aquí.
 */
export interface ImportField {
  key: string
  required?: boolean
}
