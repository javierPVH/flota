import type { ReactNode } from 'react'

/** El color de una posición cuando está elegida: permitir (verde), pedir
 * (ámbar), no permitir (rojo) o ninguno (el de marca). */
export type AccessTone = 'ok' | 'ask' | 'no'

export interface AccessOption<V extends string> {
  value: V
  label: string
  /** El dibujo se reconoce antes que el rótulo. */
  icon?: ReactNode
  tone?: AccessTone
  /** Texto que se pinta AUNQUE el conmutador vaya solo con iconos (la
   * posición «según el tipo» del modal, que sin palabras no se entiende). */
  text?: string
}

/** La leyenda de los iconos: una caja destacada con cada icono y lo que
 * significa, encima de los conmutadores que van sin rótulo. */
export function AccessLegend({
  title,
  options,
}: {
  title: string
  options: Array<AccessOption<string>>
}) {
  return (
    <div className="doc-access-legend" role="group" aria-label={title}>
      <span className="doc-access-legend-title">{title}</span>
      <ul>
        {options.map((opt) => (
          <li key={opt.value} className={opt.tone ? `tone-${opt.tone}` : undefined}>
            {opt.icon}
            <span>{opt.label}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Conmutador de posiciones fijas con icono y color: una cosa o la otra. Lo
 * usan Documentos → Ajustes (una fila por tipo) y el modal «Acceso» de un
 * documento (con «según el tipo» delante). Es un `radiogroup`: la posición
 * elegida es la que lleva `aria-checked`.
 */
export function SegSwitch<V extends string>({
  label,
  value,
  options,
  onChange,
  iconsOnly = false,
  disabled = false,
  disabledHint,
}: {
  label: string
  value: V
  options: Array<AccessOption<V>>
  onChange: (v: V) => void
  /** Solo el icono (el rótulo queda como nombre accesible y `title`): la
   * tabla de Ajustes, que lleva la leyenda encima. */
  iconsOnly?: boolean
  /** Un mando que no aplica (lo que no se lista no se ve ni se baja): sus
   * posiciones se quedan a la vista pero apagadas, y el porqué en el `title`. */
  disabled?: boolean
  disabledHint?: string
}) {
  return (
    <div
      className={`seg-switch seg-graphic${iconsOnly ? ' seg-icons' : ''}`}
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      title={disabled ? disabledHint : undefined}
    >
      {options.map((opt) => {
        const active = value === opt.value
        const cls = [active ? 'is-active' : '', opt.tone ? `tone-${opt.tone}` : '']
          .filter(Boolean)
          .join(' ')
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            className={cls}
            aria-label={iconsOnly ? opt.label : undefined}
            title={disabled ? disabledHint : iconsOnly ? opt.label : undefined}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
          >
            {opt.icon}
            {iconsOnly ? opt.text && <span>{opt.text}</span> : <span>{opt.label}</span>}
          </button>
        )
      })}
    </div>
  )
}
