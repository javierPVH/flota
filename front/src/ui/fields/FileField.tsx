/**
 * [ES] Selector de archivo con aspecto del DS: el input nativo va invisible
 * ENCIMA del botón, así que se ve un botón de verdad («Elegir archivo…» + el
 * nombre de lo elegido) y el comportamiento sigue siendo el del navegador
 * (teclado, `accept`, cámara del móvil, arrastrar y soltar sobre el botón).
 * Sustituye al «Seleccionar archivo | Ningún archivo seleccionado» del sistema.
 *
 * [EN] File picker with the design-system look: the native input sits
 * invisible ON TOP of the button, so it looks like a real button while the
 * browser keeps doing the work (keyboard, `accept`, mobile camera, drop).
 */
import { useRef, type ChangeEvent, type ReactNode } from 'react'
import { Paperclip, X } from 'lucide-react'
import { FieldShell, type FieldContainerSize } from './FieldShell'
import styles from '../../styles/_components/fields/form-fields.module.sass'
import { cx } from '../../utils/cx.ts'
import { useUiCopy } from '../copy.ts'

export interface FileFieldProps {
  label?: ReactNode
  /** Lo ya elegido (el estado lo mantiene quien usa el campo): se pinta su
   * nombre, o el recuento cuando son varios. */
  value?: File | File[] | null
  /** Siempre una lista: con `multiple` llegan todos, y vacía al quitarlos. */
  onFiles: (files: File[]) => void
  accept?: string
  multiple?: boolean
  capture?: boolean | 'user' | 'environment'
  disabled?: boolean
  requiredVisual?: boolean
  /** Texto del botón; por defecto, el del diccionario del DS. */
  buttonLabel?: string
  /** Texto cuando no hay nada elegido; por defecto, el del diccionario. */
  emptyLabel?: string
  containerSize?: FieldContainerSize
  containerClassName?: string
  id?: string
  name?: string
  /** Por defecto, el `label` cuando es texto: así el campo es localizable por
   * su etiqueta (`getByLabelText`) aunque el label del shell no vaya asociado. */
  'aria-label'?: string
}

function asList(value: File | File[] | null | undefined): File[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

export function FileField({
  label,
  value,
  onFiles,
  accept,
  multiple = false,
  capture,
  disabled = false,
  requiredVisual = false,
  buttonLabel,
  emptyLabel,
  containerSize = 'fill',
  containerClassName,
  id,
  name,
  'aria-label': ariaLabel,
}: FileFieldProps) {
  const copy = useUiCopy().fileField
  const inputRef = useRef<HTMLInputElement>(null)
  const files = asList(value)

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    onFiles(Array.from(event.target.files ?? []))
  }

  function clear() {
    // El input se vacía a mano: sin esto, volver a elegir el MISMO archivo no
    // dispara `change` (el navegador lo considera sin cambios).
    if (inputRef.current) inputRef.current.value = ''
    onFiles([])
  }

  const chosen =
    files.length === 0 ? null : files.length === 1 ? files[0].name : copy.count(files.length)

  return (
    <FieldShell
      label={label}
      size={containerSize}
      disabled={disabled}
      requiredVisual={requiredVisual}
      className={containerClassName}
    >
      <div className={styles.fileRow}>
        <span className={cx(styles.filePick, disabled && styles.filePickDisabled)}>
          <Paperclip size={15} aria-hidden />
          {buttonLabel ?? copy.button}
          <input
            ref={inputRef}
            type="file"
            className={styles.fileInput}
            id={id}
            name={name}
            accept={accept}
            multiple={multiple}
            capture={capture}
            disabled={disabled}
            aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
            onChange={handleChange}
          />
        </span>
        <span className={cx(styles.fileName, chosen === null && styles.fileNameEmpty)} title={chosen ?? undefined}>
          {chosen ?? emptyLabel ?? copy.empty}
        </span>
        {chosen !== null && !disabled && (
          <button
            type="button"
            className={styles.fileClear}
            aria-label={copy.clear}
            title={copy.clear}
            onClick={clear}
          >
            <X size={14} aria-hidden />
          </button>
        )}
      </div>
    </FieldShell>
  )
}
