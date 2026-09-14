import type { ReactNode } from 'react'

import type { Paso } from './opsWizard.ts'

/**
 * La barra de pasos y el panel de cada paso, compartidos por los modales que
 * van en asistente (estado del vehículo y envío de correo).
 */

/**
 * Un paso del formulario: caja con su borde de color, enseñada solo cuando es
 * el paso activo. El contenido de los demás **sigue montado** (oculto): así no
 * se pierde lo escrito y la validación nativa sigue viendo sus campos.
 *
 * `data-section` es lo que permite saltar al paso del campo inválido cuando el
 * navegador bloquea el envío desde un paso que no está a la vista.
 */
export function OpsSection({
  tone,
  accent,
  hidden,
  children,
}: {
  tone: string
  /** Color del borde cuando lo decide el contenido, no el tono de la sección. */
  accent?: 'ok' | 'bad'
  hidden: boolean
  children: ReactNode
}) {
  return (
    <section
      className={`ops-acc is-panel tone-${tone}${accent ? ` is-${accent}` : ''}`}
      data-section={tone}
      hidden={hidden}
    >
      <div className="ops-acc-body">{children}</div>
    </section>
  )
}

/**
 * Indicador de avance: por dónde vas y qué queda. NO se pulsa —se va y se
 * vuelve con los botones del pie—, que es lo que garantiza que ningún paso se
 * salte sin rellenarlo.
 */
export function OpsSteps<K extends string>({
  pasos,
  activo,
  label,
  bloqueado,
}: {
  pasos: Array<Paso<K>>
  activo: K
  /** Nombre de la barra para lectores de pantalla. */
  label: string
  /** Por qué un paso está apagado (va en su `title`). */
  bloqueado: string
}) {
  return (
    <div className="ops-steps" role="tablist" aria-label={label}>
      {pasos.map((p, i) => (
        <div
          key={p.key}
          role="tab"
          aria-selected={activo === p.key}
          aria-disabled={p.off}
          title={p.off ? bloqueado : undefined}
          className={`ops-step${activo === p.key ? ' is-active' : ''}${p.off ? ' is-off' : ''}`}
        >
          <span className="ops-step-n" aria-hidden>
            {i + 1}
          </span>
          {p.label}
        </div>
      ))}
    </div>
  )
}
