import type { ReactNode } from 'react'

export interface SettingsSubtabItem {
  key: string
  label: string
  /** Contador opcional (p. ej. nº de registros del grupo). */
  badge?: ReactNode
  /** Sufijo tenue opcional (p. ej. "· genérica"). */
  suffix?: string
  /**
   * Grupo al que pertenece la pestaña. Cuando los items llevan grupo, la fila
   * pinta un rótulo delante del primero de cada grupo y un filete entre
   * grupos: con diez pestañas seguidas no se distinguía qué era un ajuste,
   * qué una plantilla y qué una traza.
   */
  group?: string
}

/**
 * Sub-pestañas de una sección de Ajustes. Mismo lenguaje visual que las
 * pestañas principales (subrayado), pero como segundo nivel — más integradas
 * que las antiguas "chips". Se usan en Catálogos, Borrado definitivo y Plantillas.
 */
export function SettingsSubtabs({
  items,
  active,
  onChange,
  ariaLabel,
}: {
  items: SettingsSubtabItem[]
  active: string
  onChange: (key: string) => void
  ariaLabel?: string
}) {
  const grouped = items.some((item) => item.group)
  return (
    <div className={`settings-subtabs${grouped ? ' is-grouped' : ''}`} role="tablist" aria-label={ariaLabel}>
      {items.map((item, i) => {
        const startsGroup = grouped && item.group !== items[i - 1]?.group
        return (
          <span key={item.key} className={`settings-subtab-slot${startsGroup ? ' starts-group' : ''}`}>
            {startsGroup && item.group && (
              <span className="settings-subtab-group" aria-hidden>
                {item.group}
              </span>
            )}
            <button
              type="button"
              role="tab"
              aria-selected={active === item.key}
              className={`settings-subtab${active === item.key ? ' is-active' : ''}`}
              onClick={() => onChange(item.key)}
            >
              <span className="settings-subtab-label">{item.label}</span>
              {item.suffix && <span className="settings-subtab-suffix">{item.suffix}</span>}
              {item.badge != null && <span className="settings-subtab-badge">{item.badge}</span>}
            </button>
          </span>
        )
      })}
    </div>
  )
}
