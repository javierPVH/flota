/**
 * [ES] Formulario generico para popups de creacion de catalogos.
 * [EN] Generic form used by catalog creation popups.
 *
 * It maps declarative field definitions to reusable input components
 * and submits data to the Django catalog creation APIs.
 */
import { useMemo, useState, type FormEvent } from 'react'
import { Button } from '../ui/buttons/index.ts'
import {
  SelectField,
  TextAreaField,
  TextInputField,
  type SelectFieldOption,
} from '../ui/fields/index.ts'
import {
  type CatalogCreateData,
  type CatalogCreateEntity,
  type CatalogCreateSuccessResponse,
  type CatalogCreateSubmit,
} from './types.ts'
import styles from '../styles/_components/forms/catalog-create-form.module.sass'
import { getUiCopy, useUiCopy } from '../ui/copy.ts'
import { resolveLanguage } from '../utils/language.ts'
import { toErrorMessage } from '../utils/errors.ts'
import { cx } from '../utils/cx.ts'

export type CatalogCreateFieldKind =
  | 'text'
  | 'email'
  | 'url'
  | 'date'
  | 'number'
  | 'textarea'
  | 'select'

export interface CatalogCreateFieldDefinition {
  key: string
  label: string
  kind?: CatalogCreateFieldKind
  required?: boolean
  placeholder?: string
  helperText?: string
  defaultValue?: string
  options?: SelectFieldOption[]
  rows?: number
  disabled?: boolean
  fullWidth?: boolean
}

export interface CatalogEntityCreateFormProps {
  entity: CatalogCreateEntity
  /** Ejecuta la creación real contra el backend de la app (inyectado). */
  submit: CatalogCreateSubmit
  title: string
  description?: string
  submitLabel?: string
  fields: CatalogCreateFieldDefinition[]
  className?: string
  disabled?: boolean
  resetOnSuccess?: boolean
  apiBaseUrl?: string
  csrfToken?: string
  transformData?: (values: Record<string, string>) => CatalogCreateData
  optionsLoadError?: string | null
  onCreated?: (payload: CatalogCreateSuccessResponse) => void
  onCancel?: () => void
}


// Lectura puntual (no reactiva) de la copy para helpers a nivel de módulo.
function getComponentsCopy() {
  return getUiCopy(resolveLanguage())
}

function resolveSuccessLabel(payload: CatalogCreateSuccessResponse): string {
  if (typeof payload.label === 'string' && payload.label.trim()) {
    return payload.label
  }

  if (
    typeof payload.code === 'string'
    && payload.code.trim()
    && typeof payload.name === 'string'
    && payload.name.trim()
  ) {
    return `${payload.code} - ${payload.name}`
  }

  if (typeof payload.name === 'string' && payload.name.trim()) {
    return payload.name
  }

  return getComponentsCopy().catalogEntityCreateForm.createdLabelById(payload.id)
}

function isSpecialSelectFlag(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  return normalized === '__ignore__'
    || normalized === '__create__'
    || normalized === '__add__'
    || normalized === '__divider__'
    || normalized.startsWith('__divider_')
}

function isValidDateValue(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false
  }

  const date = new Date(value)
  return !Number.isNaN(date.getTime())
}

function isValidEmailValue(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function isValidUrlValue(value: string): boolean {
  try {
    // eslint-disable-next-line no-new
    new URL(value)
    return true
  } catch {
    return false
  }
}

function resolveFieldLabel(label: string): string {
  return label.trim() || getComponentsCopy().catalogEntityCreateForm.genericFieldFallbackLabel
}

function validateCatalogField(
  field: CatalogCreateFieldDefinition,
  rawValue: string,
): string | null {
  const fieldKind = field.kind || 'text'
  const value = rawValue.trim()
  const label = resolveFieldLabel(field.label)

  if (field.required) {
    if (!value) {
      return getComponentsCopy().catalogEntityCreateForm.requiredField(label)
    }

    if (fieldKind === 'select' && isSpecialSelectFlag(value)) {
      return getComponentsCopy().catalogEntityCreateForm.invalidSelectValue(label)
    }
  }

  if (!value) {
    return null
  }

  if (fieldKind === 'email' && !isValidEmailValue(value)) {
    return getComponentsCopy().catalogEntityCreateForm.invalidEmail
  }

  if (fieldKind === 'url' && !isValidUrlValue(value)) {
    return getComponentsCopy().catalogEntityCreateForm.invalidUrl
  }

  if (fieldKind === 'number' && !Number.isFinite(Number(value))) {
    return getComponentsCopy().catalogEntityCreateForm.invalidNumber
  }

  if (fieldKind === 'date' && !isValidDateValue(value)) {
    return getComponentsCopy().catalogEntityCreateForm.invalidDate
  }

  if (fieldKind === 'select' && isSpecialSelectFlag(value)) {
    return getComponentsCopy().catalogEntityCreateForm.invalidSelectValue(label)
  }

  return null
}

export function CatalogEntityCreateForm({
  entity,
  submit,
  title,
  submitLabel,
  fields,
  className,
  disabled = false,
  resetOnSuccess = false,
  apiBaseUrl,
  csrfToken,
  transformData,
  optionsLoadError,
  onCreated,
  onCancel,
}: CatalogEntityCreateFormProps) {
  const copy = useUiCopy()
  const resolvedSubmitLabel = submitLabel ?? copy.catalogEntityCreateForm.submitDefaultLabel
  const initialValues = useMemo(() => (
    fields.reduce<Record<string, string>>((acc, field) => {
      const hasExplicitDefault = field.defaultValue !== undefined
      if (hasExplicitDefault) {
        acc[field.key] = String(field.defaultValue ?? '')
        return acc
      }
      if ((field.kind || 'text') === 'select' && !field.required) {
        acc[field.key] = '__ignore__'
        return acc
      }
      acc[field.key] = ''
      return acc
    }, {})
  ), [fields])

  const [values, setValues] = useState<Record<string, string>>(initialValues)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [fieldWarnings, setFieldWarnings] = useState<Partial<Record<string, string>>>({})
  const hasOnlyTwoFields = fields.length === 2

  function dismissFieldWarning(key: string) {
    setFieldWarnings((current) => {
      if (!current[key]) {
        return current
      }

      const next = {
        ...current,
      }
      delete next[key]
      return next
    })
  }

  function updateValue(key: string, value: string) {
    setValues((current) => ({
      ...current,
      [key]: value,
    }))
    dismissFieldWarning(key)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (disabled || isSubmitting) {
      return
    }

    setErrorMessage(null)
    setSuccessMessage(null)

    const nextFieldWarnings: Partial<Record<string, string>> = {}
    fields.forEach((field) => {
      const warning = validateCatalogField(field, values[field.key] ?? '')
      if (warning) {
        nextFieldWarnings[field.key] = warning
      }
    })

    if (Object.keys(nextFieldWarnings).length > 0) {
      setFieldWarnings(nextFieldWarnings)
      setErrorMessage(copy.catalogEntityCreateForm.reviewError)
      return
    }

    setFieldWarnings({})
    setIsSubmitting(true)

    try {
      const payload = await submit(
        {
          entity,
          data: transformData
            ? transformData(values)
            : values,
        },
        {
          baseUrl: apiBaseUrl,
          csrfToken,
        },
      )

      const label = resolveSuccessLabel(payload)
      setSuccessMessage(copy.catalogEntityCreateForm.createdSuccess(label))

      if (resetOnSuccess) {
        setValues(initialValues)
      }

      setFieldWarnings({})

      onCreated?.(payload)
    } catch (error) {
      setErrorMessage(toErrorMessage(error, copy.catalogEntityCreateForm.createUnknownError))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form
      className={cx(styles.formCard, hasOnlyTwoFields && styles.formCardCompact, className)}
      onSubmit={handleSubmit}
      noValidate
    >
      <header className={styles.header}>
        <h3 className={styles.title}>{title}</h3>
      </header>
      <hr className={styles.headerDivider} />

      {(errorMessage || successMessage) && (
        <div className={styles.messages}>
          {errorMessage && (
            <p className={cx(styles.message, styles.messageError)} role="alert">
              {errorMessage}
            </p>
          )}
          {successMessage && (
            <p className={cx(styles.message, styles.messageSuccess)} role="status">
              {successMessage}
            </p>
          )}
        </div>
      )}

      <div className={styles.fieldsGrid}>
        {fields.map((field) => {
          const fieldKind = field.kind || 'text'
          const isFieldDisabled = disabled || isSubmitting || field.disabled
          const isFullWidth = field.fullWidth || fieldKind === 'textarea'

          return (
            <div
              className={isFullWidth ? styles.fieldSpanAll : undefined}
              key={`${entity}-${field.key}`}
            >
              {fieldKind === 'textarea' ? (
                <TextAreaField
                  label={field.label}
                  requiredVisual={Boolean(field.required)}
                  warningMessage={fieldWarnings[field.key]}
                  onWarningClose={() => dismissFieldWarning(field.key)}
                  value={values[field.key] ?? ''}
                  onChange={(event) => updateValue(field.key, event.target.value)}
                  required={field.required}
                  placeholder={field.placeholder}
                  rows={field.rows ?? 4}
                  disabled={isFieldDisabled}
                />
              ) : fieldKind === 'select' ? (
                <SelectField
                  label={field.label}
                  requiredVisual={Boolean(field.required)}
                  warningMessage={fieldWarnings[field.key] ?? optionsLoadError ?? undefined}
                  onWarningClose={() => dismissFieldWarning(field.key)}
                  value={values[field.key] ?? ''}
                  onValueChange={(nextValue) => updateValue(field.key, nextValue)}
                  required={field.required}
                  includeSelectFlag={Boolean(field.required)}
                  includeIgnoreFlag={!field.required}
                  disabled={isFieldDisabled}
                  options={field.options || []}
                  enableSearchFilter
                />
              ) : (
                <TextInputField
                  type={fieldKind}
                  label={field.label}
                  requiredVisual={Boolean(field.required)}
                  warningMessage={fieldWarnings[field.key]}
                  onWarningClose={() => dismissFieldWarning(field.key)}
                  value={values[field.key] ?? ''}
                  onChange={(event) => updateValue(field.key, event.target.value)}
                  required={field.required}
                  placeholder={field.placeholder}
                  disabled={isFieldDisabled}
                />
              )}
              {field.helperText && (
                <p className={styles.hint}>{field.helperText}</p>
              )}
            </div>
          )
        })}
      </div>

      <div className={styles.actions}>
        <Button
          variant="secondary"
          type="button"
          disabled={disabled || isSubmitting}
          onClick={() => {
            setErrorMessage(null)
            setSuccessMessage(null)
            setFieldWarnings({})
            if (onCancel) {
              onCancel()
              return
            }
            setValues(initialValues)
          }}
        >
          {copy.catalogEntityCreateForm.closeButton}
        </Button>
        <Button variant="primary" type="submit" disabled={disabled || isSubmitting}>
          {isSubmitting ? copy.catalogEntityCreateForm.creatingLabel : resolvedSubmitLabel}
        </Button>
      </div>
    </form>
  )
}


