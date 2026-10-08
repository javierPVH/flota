/**
 * [ES] Control segmentado: una sola opción activa entre varias (vista, periodo,
 * modo). Mismo aspecto que el selector de idioma. Navegable con flechas.
 * [EN] Segmented control: one active option among several. Arrow-key navigation.
 */
import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import styles from '../../styles/_components/buttons/language-toggle-button.module.sass'
import { cx } from '../../utils/cx.ts'

export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
  disabled?: boolean
}

export interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<SegmentedOption<T>>
  value: T
  onChange: (next: T) => void
  /** Etiqueta accesible del grupo (texto de la app, por i18n). */
  ariaLabel: string
  className?: string
  /** Ocupa todo el ancho y reparte las opciones a partes iguales. */
  fullWidth?: boolean
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
  fullWidth = false,
}: SegmentedControlProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])

  function move(from: number, step: number) {
    const n = options.length
    for (let i = 1; i <= n; i++) {
      const next = (from + step * i + n) % n
      if (!options[next].disabled) {
        onChange(options[next].value)
        refs.current[next]?.focus()
        return
      }
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      move(index, 1)
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      move(index, -1)
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cx(styles.languageToggle, fullWidth && styles.fullWidth, className)}
    >
      {options.map((option, index) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            disabled={option.disabled}
            className={cx(styles.toggleOption, styles.segmentOption, active && styles.isActive)}
            onClick={() => onChange(option.value)}
            onKeyDown={(e) => onKeyDown(e, index)}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
