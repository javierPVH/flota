import { useEmailTemplatesCopy } from '../translations/emailTemplates.ts'
import { TEMPLATE_VARIABLES, type TemplateVariable } from './templateVars.ts'

/**
 * Los marcadores `{{…}}`, con su nombre en claro, para pegarlos donde se esté
 * escribiendo. Vive aquí porque lo usan los DOS sitios donde se escribe el
 * texto de un correo —el gestor de plantillas de Ajustes y el modal de envío
 * del vehículo—: son la misma lista y la misma ayuda, y si se duplicaran, una
 * variable nueva aparecería solo en una.
 */
export function TemplateVars({
  onInsert,
  targetLabel,
}: {
  onInsert: (name: TemplateVariable) => void
  /** Dónde se va a pegar («Asunto» / «Cuerpo»); ausente si solo hay un sitio. */
  targetLabel?: string
}) {
  const t = useEmailTemplatesCopy()
  return (
    <div className="tpl-vars">
      <div className="tpl-vars-head">
        <strong>{t.variablesTitle}</strong>
        {targetLabel && <span className="tpl-vars-target">{targetLabel}</span>}
        <span className="muted">{t.variablesHint}</span>
      </div>
      <div className="tpl-vars-chips">
        {TEMPLATE_VARIABLES.map((name) => (
          <button
            key={name}
            type="button"
            className="tpl-var"
            title={t.variables[name].help}
            onClick={() => onInsert(name)}
          >
            <span className="tpl-var-name">{t.variables[name].label}</span>
            <code>{`{{${name}}}`}</code>
          </button>
        ))}
      </div>
    </div>
  )
}
