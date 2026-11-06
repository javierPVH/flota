import { CorporateEmailField } from './CorporateEmailField.tsx'
import { customEmailList, invalidCorporateEmails } from '../corporateEmail.ts'
import { useEffect, useState } from 'react'
import { Button, Panel } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'
import { useAppLang } from '@flota/ui/i18n'
import { getEmailSettings, updateIncidentEmailSettings } from '../api.ts'

type Notice = { enabled: boolean; to_driver: boolean; to_supervisor: boolean; admin_ids: number[] }
export function IncidentEmailSettingsPanel({ kind, onEditTemplate }: { kind: 'incident' | 'accident'; onEditTemplate: (key: string) => void }) {
  const en = useAppLang() === 'en'
  const [config, setConfig] = useState<Notice | null>(null)
  const [admins, setAdmins] = useState<Array<{ id: number; name: string; email: string }>>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [extraRecipients, setExtraRecipients] = useState('')
  const [domains, setDomains] = useState<string[]>([])
  useEffect(() => {
    let alive = true
    getEmailSettings().then(row => {
      if (!alive) return
      const data = row as unknown as Record<string, unknown>
      const g = (field: string) => data[`${kind}_notice_${field}`]
      setConfig({ enabled: Boolean(g('enabled')), to_driver: Boolean(g('to_driver')), to_supervisor: Boolean(g('to_supervisor')), admin_ids: (g('admin_ids') as number[]) ?? [] })
      setAdmins(row.admin_options)
      setDomains(row.corporate_email_domains ?? [])
      setExtraRecipients((data[`${kind}_notice_extra_recipients`] as string) ?? '')
    }).catch(err => { if (alive) setError(asErrorMessage(err, 'Error al cargar los ajustes')) })
    return () => { alive = false }
  }, [kind])
  const nobody = config && !config.to_driver && !config.to_supervisor && config.admin_ids.length === 0 && customEmailList(extraRecipients).length === 0
  return <section className="email-settings es-notice-settings">
    {error && <p role="alert" className="form-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {config && <form className="es-notice-form" onSubmit={async e => {
      e.preventDefault(); setSaving(true); setError(''); setNotice('')
      const form: Record<string, unknown> = { [`${kind}_notice_extra_recipients`]: extraRecipients }
      for (const field of ['enabled', 'to_driver', 'to_supervisor', 'admin_ids'] as const) form[`${kind}_notice_${field}`] = config[field]
      try { await updateIncidentEmailSettings(form); setNotice(en ? 'Settings saved.' : 'Ajustes guardados.') }
      catch (err) { setError(asErrorMessage(err, 'No se pudieron guardar los ajustes')) }
      finally { setSaving(false) }
    }}>
      <Panel>
        {en ? 'Send one email when a new report is registered. Editing or resolving it does not send another email.' : 'Envía un correo al registrar un nuevo parte. Editarlo o resolverlo no genera otro envío.'}
      </Panel>
      <label className="baja-toggle es-toggle es-toggle-main es-notice-activation">
        <input type="checkbox" aria-label={en ? 'Enable email notices' : 'Activar avisos por correo'} checked={config.enabled} onChange={e => setConfig({ ...config, enabled: e.target.checked })} />
        <span>
          <strong>{en ? 'Enable email notices' : 'Activar avisos por correo'}</strong>
          <span className="muted">{en ? 'Notify the recipients selected below.' : 'Notifica a los destinatarios que selecciones a continuación.'}</span>
        </span>
      </label>
      <fieldset className="es-fieldset" disabled={!config.enabled}>
        <legend>{en ? 'Recipients' : 'A quién se avisa'}</legend>
        <div className="es-recipients">
          <label className="baja-toggle es-toggle es-notice-recipient">
            <input type="checkbox" checked={config.to_driver} onChange={e => setConfig({ ...config, to_driver: e.target.checked })} />
            <span><strong>{en ? 'Driver (supervisor when unassigned)' : 'Conductor (supervisor si no hay conductor)'}</strong></span>
          </label>
          <label className="baja-toggle es-toggle es-notice-recipient">
            <input type="checkbox" checked={config.to_supervisor} onChange={e => setConfig({ ...config, to_supervisor: e.target.checked })} />
            <span><strong>{en ? 'Supervisor' : 'Supervisor'}</strong></span>
          </label>
        </div>
        <div className="es-admins-head"><strong>{en ? 'Administrators' : 'Administradores'}</strong><span className="muted"> · {en ? 'Select who will also receive the notice.' : 'Selecciona quién recibirá también el aviso.'}</span></div>
        <div className="es-admins">{admins.map(a => <label key={a.id} className={`es-admin${config.admin_ids.includes(a.id) ? ' is-active' : ''}`}><input type="checkbox" checked={config.admin_ids.includes(a.id)} onChange={e => setConfig({ ...config, admin_ids: e.target.checked ? [...config.admin_ids, a.id] : config.admin_ids.filter(id => id !== a.id) })} /><span><strong>{a.name}</strong><span className="muted">{a.email}</span></span></label>)}</div>
        {admins.length === 0 && <p className="muted">{en ? 'No administrators with an email address are available.' : 'No hay administradores con correo disponibles.'}</p>}
        <CorporateEmailField value={extraRecipients} onChange={setExtraRecipients} domains={domains} />
        {nobody && <p className="form-error">{en ? 'Choose at least one recipient.' : 'Elige al menos un destinatario.'}</p>}
      </fieldset>
      <footer className="es-notice-footer">
        <div className="form-actions"><Button type="button" onClick={() => onEditTemplate(`${kind}_notice`)}>{en ? 'Edit email template' : 'Editar plantilla del correo'}</Button><Button type="submit" variant="primary" disabled={saving || invalidCorporateEmails(extraRecipients, domains) || Boolean(config.enabled && nobody)}>{saving ? (en ? 'Saving...' : 'Guardando...') : (en ? 'Save' : 'Guardar')}</Button></div>
      </footer>
    </form>}
  </section>
}
