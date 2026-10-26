import type { ReactNode } from 'react'

export interface SettingsSubtabItem {
  key: string
  label: string
  /** Contador opcional (p. ej. nº de registros del grupo). */
  badge?: ReactNode
  /** Sufijo tenue opcional (p. ej. "· genérica"). */
  suffix?: string
}

/**
 * Sub-pestañas de una sección de Ajustes. Mismo lenguaje visual que las
 * pestañas principales (subrayado), pero como segundo nivel — más integradas
 * que las antiguas "chips". Se usan en Catálogos, Borrado definitivo y Plantillas.
 *
 * `variant="pills"` es el TERCER nivel (Ajustes → Correo: las subpestañas de
 * un grupo): chips redondeados, el activo relleno en el color de marca, para
 * que no se confundan con el subrayado del nivel de arriba.
 */
export function SettingsSubtabs({
  items,
  active,
  onChange,
  ariaLabel,
  variant = 'underline',
}: {
  items: SettingsSubtabItem[]
  active: string
  onChange: (key: string) => void
  ariaLabel?: string
  variant?: 'underline' | 'pills'
}) {
  return (
    <div
      className={variant === 'pills' ? 'settings-pills' : 'settings-subtabs'}
      role="tablist"
      aria-label={ariaLabel}
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="tab"
          aria-selected={active === item.key}
          className={`${variant === 'pills' ? 'settings-pill' : 'settings-subtab'}${active === item.key ? ' is-active' : ''}`}
          onClick={() => onChange(item.key)}
        >
          <span className="settings-subtab-label">{item.label}</span>
          {item.suffix && <span className="settings-subtab-suffix">{item.suffix}</span>}
          {item.badge != null && <span className="settings-subtab-badge">{item.badge}</span>}
        </button>
      ))}
    </div>
  )
}
