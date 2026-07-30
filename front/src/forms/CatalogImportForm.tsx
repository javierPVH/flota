import { useState, type FormEvent } from 'react'
import { Button } from '../ui/buttons/index.ts'
import { TextInputField } from '../ui/fields/index.ts'
import { downloadCsvTemplateFile } from '../utils/csv-template.ts'
import styles from '../styles/_components/forms/catalog-create-form.module.sass'
import { cx } from '../utils/cx.ts'

/** Sube el CSV de importación al backend de la app (inyectado). */
export type CatalogImportUpload = (args: {
  entity: string
  file: File
  extraFields?: Record<string, string>
  endpoint?: string
}) => Promise<Response>

export interface CatalogImportFormDefinition {
  title: string
  entity: string
  headers: string[]
  headerFilename: string
  exampleRow?: string[]
  exampleFilename?: string
  alternateHeaders?: string[][]
  extraFields?: Record<string, string>
  endpoint?: string
}

export interface CatalogImportFormProps {
  definition: CatalogImportFormDefinition
  /** Ejecuta la subida real del CSV (inyectado por la app). */
  upload: CatalogImportUpload
  onCancel?: () => void
  onImported?: () => void
}


function toErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof Error && error.message) {
    return error.message
  }
  return fallbackMessage
}

function formatHeader(columns: string[]): string {
  return columns
    .map((column) => column.trim())
    .filter(Boolean)
    .join(', ')
}

function validateDefinition(definition: CatalogImportFormDefinition): string | null {
  const normalizedHeaders = definition.headers
    .map((header) => header.trim())
    .filter(Boolean)

  if (normalizedHeaders.length === 0) {
    return 'Cabecera no configurada.'
  }

  if (normalizedHeaders.length !== definition.headers.length) {
    return 'Cabecera invalida: contiene columnas vacias.'
  }

  if (definition.exampleRow && definition.exampleRow.length > normalizedHeaders.length) {
    return 'Ejemplo invalido: tiene mas columnas que la cabecera.'
  }

  if (definition.alternateHeaders) {
    const hasInvalidAlternate = definition.alternateHeaders.some((alternate) => (
      !alternate
      || alternate.length === 0
      || alternate.some((header) => !header.trim())
    ))
    if (hasInvalidAlternate) {
      return 'Cabecera alternativa invalida.'
    }
  }

  return null
}

export function CatalogImportForm({
  definition,
  upload,
  onCancel,
  onImported,
}: CatalogImportFormProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [fieldWarning, setFieldWarning] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const validationError = validateDefinition(definition)

  function clearMessages() {
    setFieldWarning(null)
    setErrorMessage(null)
    setSuccessMessage(null)
  }

  function handleHeaderDownload() {
    if (validationError) {
      setErrorMessage(validationError)
      setSuccessMessage(null)
      return
    }

    downloadCsvTemplateFile({
      filename: definition.headerFilename,
      headers: definition.headers,
    })
    setErrorMessage(null)
    setSuccessMessage(`Cabecera descargada: ${formatHeader(definition.headers)}.`)
  }

  function handleExampleDownload() {
    if (!definition.exampleFilename || !definition.exampleRow) {
      return
    }
    if (validationError) {
      setErrorMessage(validationError)
      setSuccessMessage(null)
      return
    }

    downloadCsvTemplateFile({
      filename: definition.exampleFilename,
      headers: definition.headers,
      exampleRow: definition.exampleRow,
    })
    setErrorMessage(null)
    setSuccessMessage(`Ejemplo descargado (${definition.exampleFilename}).`)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    clearMessages()

    if (validationError) {
      setErrorMessage(validationError)
      return
    }

    if (!selectedFile || isSubmitting) {
      setFieldWarning('Archivo obligatorio. Selecciona un CSV o Excel.')
      return
    }

    setIsSubmitting(true)
    try {
      const response = await upload({
        entity: definition.entity,
        file: selectedFile,
        extraFields: definition.extraFields,
        endpoint: definition.endpoint,
      })
      if (!response.ok) {
        throw new Error('La importacion no pudo completarse.')
      }

      setSuccessMessage('Importacion completada. Se recargaran los datos.')
      onImported?.()
    } catch (error) {
      setErrorMessage(toErrorMessage(error, 'La importacion no pudo completarse.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form className={cx(styles.formCard, styles.importFormCard)} onSubmit={handleSubmit} noValidate>
      <header className={styles.header}>
        <h3 className={styles.title}>{definition.title}</h3>
      </header>
      <hr className={styles.headerDivider} />

      <div className={styles.importInfo}>
        <span className={styles.importInfoLabel}>Cabecera esperada</span>
        <code className={styles.importCode}>{formatHeader(definition.headers)}</code>
      </div>

      {definition.alternateHeaders?.map((alternateHeader) => (
        <div key={`${definition.entity}-${alternateHeader.join('|')}`} className={styles.importInfo}>
          <span className={styles.importInfoLabel}>Cabecera alternativa</span>
          <code className={styles.importCode}>{formatHeader(alternateHeader)}</code>
        </div>
      ))}

      <div className={styles.importInlineActions}>
        <Button type="button" variant="secondary" size="sm" onClick={handleHeaderDownload}>
          Descargar CSV (solo cabecera)
        </Button>
        {definition.exampleFilename && definition.exampleRow ? (
          <Button type="button" variant="secondary" size="sm" onClick={handleExampleDownload}>
            Descargar ejemplo (1 fila)
          </Button>
        ) : null}
      </div>

      <TextInputField
        type="file"
        label="Archivo CSV o Excel"
        warningMessage={fieldWarning}
        onWarningClose={() => setFieldWarning(null)}
        required
        requiredVisual
        accept=".csv,.xls,.xlsx"
        onChange={(event) => {
          setSelectedFile(event.currentTarget.files?.[0] ?? null)
          setFieldWarning(null)
        }}
      />

      {selectedFile ? (
        <p className={styles.importFileName}>
          Archivo seleccionado: <code className={styles.importCode}>{selectedFile.name}</code>
        </p>
      ) : null}

      {(errorMessage || successMessage) && (
        <div className={styles.messages}>
          {errorMessage ? (
            <p className={cx(styles.message, styles.messageError)} role="alert">
              {errorMessage}
            </p>
          ) : null}
          {successMessage ? (
            <p className={cx(styles.message, styles.messageSuccess)} role="status">
              {successMessage}
            </p>
          ) : null}
        </div>
      )}

      <div className={styles.actions}>
        <Button type="button" variant="secondary" disabled={isSubmitting} onClick={onCancel}>
          Cerrar
        </Button>
        <Button type="submit" variant="primary" disabled={Boolean(validationError) || isSubmitting}>
          {isSubmitting ? 'Importando...' : 'Importar'}
        </Button>
      </div>
    </form>
  )
}
