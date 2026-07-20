/**
 * [ES] Selector de idioma de dos estados (ES/EN) con un unico valor activo.
 * [EN] Two-state language selector (ES/EN) with a single active value.
 * Supports disabled state and optional toggle behavior on active click.
 */
import type { HTMLAttributes } from 'react'
import styles from '../../styles/_components/buttons/language-toggle-button.module.sass'
import { cx } from '../../utils/cx.ts'
import { useUiCopy } from '../copy.ts'

export type LanguageToggleValue = 'es' | 'en'

export interface LanguageToggleButtonProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  activeLanguage?: LanguageToggleValue
  onChange?: (next: LanguageToggleValue) => void
  /**
   * [ES] Si es true, al pulsar la opcion ya activa alterna al otro idioma.
   * [EN] If true, clicking the currently active option toggles to the other language.
   */
  toggleOnSameOptionClick?: boolean
  disabled?: boolean
  esLabel?: string
  enLabel?: string
}



export function LanguageToggleButton({
  activeLanguage = 'es',
  onChange,
  toggleOnSameOptionClick = true,
  disabled = false,
  esLabel,
  enLabel,
  className,
  ...props
}: LanguageToggleButtonProps) {
  const copy = useUiCopy()
  const resolvedEsLabel = esLabel ?? copy.languageToggleButton.esLabel
  const resolvedEnLabel = enLabel ?? copy.languageToggleButton.enLabel

  function handleChange(next: LanguageToggleValue) {
    if (disabled) {
      return
    }

    if (next === activeLanguage) {
      if (!toggleOnSameOptionClick) {
        return
      }
      onChange?.(activeLanguage === 'es' ? 'en' : 'es')
      return
    }

    onChange?.(next)
  }

  return (
    <div
      className={cx(styles.languageToggle, disabled && styles.isDisabled, className)}
      role="tablist"
      aria-label={copy.languageToggleButton.ariaLabel}
      {...props}
    >
      <button
        type="button"
        role="tab"
        className={cx(styles.toggleOption, activeLanguage === 'es' && styles.isActive)}
        aria-selected={activeLanguage === 'es'}
        disabled={disabled}
        onClick={() => handleChange('es')}
      >
        {resolvedEsLabel}
      </button>
      <button
        type="button"
        role="tab"
        className={cx(styles.toggleOption, activeLanguage === 'en' && styles.isActive)}
        aria-selected={activeLanguage === 'en'}
        disabled={disabled}
        onClick={() => handleChange('en')}
      >
        {resolvedEnLabel}
      </button>
    </div>
  )
}
