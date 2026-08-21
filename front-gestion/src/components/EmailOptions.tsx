import { useVehiclesCopy } from '../translations/vehicles.ts'
import type { NoticeLang } from '../emailPrefs.ts'

const LANGS: NoticeLang[] = ['es', 'en', 'both']

/**
 * Cómo se compone el correo: si se usa la plantilla y en qué idioma.
 *
 * Va en los dos sitios desde los que se manda un aviso —el modal de correo y el
 * comunicado del modal de estado—, así que vive aquí para que se comporten y se
 * lean igual. El idioma solo tiene sentido con plantilla: el texto libre lo
 * escribe una persona, y nadie lo traduce por ella.
 */
export function EmailOptions({
  useTemplate,
  onUseTemplateChange,
  lang,
  onLangChange,
  missingEnglish = false,
}: {
  useTemplate: boolean
  onUseTemplateChange: (value: boolean) => void
  lang: NoticeLang
  onLangChange: (value: NoticeLang) => void
  /** La plantilla elegida no tiene versión inglesa y se está pidiendo en inglés. */
  missingEnglish?: boolean
}) {
  const t = useVehiclesCopy().email
  const langLabel: Record<NoticeLang, string> = {
    es: t.langEs,
    en: t.langEn,
    both: t.langBoth,
  }

  return (
    <div className="email-options">
      <label className="switch">
        <input
          type="checkbox"
          role="switch"
          checked={useTemplate}
          onChange={(e) => onUseTemplateChange(e.target.checked)}
        />
        <span className="switch-track" aria-hidden />
        <span>{t.useTemplate}</span>
      </label>

      <div className="email-lang">
        <span className="email-lang-label">{t.langLabel}</span>
        <div className="seg-switch" role="group" aria-label={t.langLabel}>
          {LANGS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={lang === value}
              className={lang === value ? 'is-active' : ''}
              disabled={!useTemplate}
              onClick={() => onLangChange(value)}
            >
              {langLabel[value]}
            </button>
          ))}
        </div>
      </div>

      {!useTemplate && <p className="muted email-options-note">{t.useTemplateOffHint}</p>}
      {useTemplate && missingEnglish && (
        <p className="email-options-note tone-warn">{t.langNoEnglish}</p>
      )}
    </div>
  )
}
