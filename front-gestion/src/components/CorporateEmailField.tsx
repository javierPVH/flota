import { TextAreaField } from '@flota/ui/ui'
import { useAppLang } from '@flota/ui/i18n'
import { invalidCorporateEmails } from '../corporateEmail.ts'

export function CorporateEmailField({ value, onChange, domains }: { value: string; onChange: (value: string) => void; domains: string[] }) {
  const en = useAppLang() === 'en'
  const invalid = invalidCorporateEmails(value, domains)
  return <div className="es-custom-emails">
    <TextAreaField label={en ? 'Custom email addresses' : 'Correos personalizados'} value={value} onChange={e => onChange(e.target.value)} rows={1} aria-invalid={invalid || undefined} />
    <p className="muted">{en ? 'Separate addresses with commas, semicolons or new lines. Corporate domains only: ' : 'Separa los correos con comas, punto y coma o saltos de línea. Solo dominios corporativos: '}{domains.length ? domains.map(d => `@${d}`).join(', ') : (en ? 'No domains configured.' : 'No hay dominios configurados.')}</p>
    {invalid && <p className="form-error" role="alert">{en ? 'Enter valid corporate email addresses only.' : 'Introduce solo direcciones válidas de correo corporativo.'}</p>}
  </div>
}
