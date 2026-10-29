import { useState } from 'react'
import { Badge, Button } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import {
  updateDocumentTypeAccess,
  type DocumentTypeAccess,
  type DocumentTypeAccessInput,
} from '../api.ts'
import { useDocumentsCopy } from '../translations/documents.ts'
import { usePanelsCopy } from '../translations/panels.ts'
import { AccessLegend, SegSwitch } from './AccessSwitch.tsx'
import { useAccessOptions } from './accessOptions.tsx'

/** Lo editable de una fila: la supervisión y los cuatro mandos del conductor
 * (qué lista, cómo lo ve, cómo se lo baja, cómo pide su borrado). */
type Draft = DocumentTypeAccessInput

const draftOf = (rules: DocumentTypeAccess[]) =>
  Object.fromEntries(
    rules.map((r) => [
      r.type,
      {
        supervisor_read: r.supervisor_read,
        driver_read: r.driver_read,
        driver_view: r.driver_view,
        driver_download: r.driver_download,
        driver_delete: r.driver_delete,
      },
    ]),
  ) as Record<string, Draft>

const same = (a: Draft, b: Draft) =>
  a.supervisor_read === b.supervisor_read &&
  a.driver_read === b.driver_read &&
  a.driver_view === b.driver_view &&
  a.driver_download === b.driver_download &&
  a.driver_delete === b.driver_delete

/**
 * Documentos → Ajustes: quién lee cada TIPO de documento y cómo, una fila
 * por tipo.
 *
 * La administración lo lee todo y se enseña como fija —una columna que diga
 * «siempre» en todas las filas informa de que no es un olvido—; la
 * supervisión se enciende o se apaga; y el conductor tiene su grupo de
 * columnas: qué **lista** (`DriverDocumentRead`), cómo **ve** el archivo y
 * cómo **se lo baja** (`DriverActionMode`: directamente, enviando una
 * solicitud que la gestión concede, o nunca) y cómo pide su **borrado**
 * (con solicitud o no permitido: nunca directo). Cada posición es solo su
 * icono, con su color al elegirla (`SegSwitch` en `iconsOnly`), y la
 * leyenda de encima dice qué es cada uno. Se edita en local y se guarda de
 * una vez: solo viajan las filas que cambian, cada una a su `PATCH`, y al
 * terminar la página recarga la regla (que es también la que pinta la
 * columna «Acceso» del listado).
 */
export function DocumentAccessSettings({
  rules,
  loading,
  error,
  onSaved,
}: {
  rules: DocumentTypeAccess[]
  loading: boolean
  error: string
  /** Tras guardar: la página vuelve a pedir las reglas. */
  onSaved: () => void
}) {
  const t = useDocumentsCopy().settings
  const typeLabels = usePanelsCopy().documents.typeOptions
  const [draft, setDraft] = useState<Record<string, Draft>>(() => draftOf(rules))
  // El borrador sigue a las reglas que llegan (la carga y cada guardado):
  // se ajusta durante el render, el patrón de «estado que depende de una
  // prop», y no en un efecto.
  const [applied, setApplied] = useState(rules)
  if (applied !== rules) {
    setApplied(rules)
    setDraft(draftOf(rules))
  }
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)

  const saved = draftOf(rules)
  const changed = rules.filter((r) => draft[r.type] && !same(draft[r.type], saved[r.type]))

  const set = (type: string, patch: Partial<Draft>) => {
    setNotice(null)
    setDraft((prev) => ({ ...prev, [type]: { ...prev[type], ...patch } }))
  }

  const save = async () => {
    if (!changed.length || saving) return
    setSaving(true)
    setNotice(null)
    try {
      await Promise.all(changed.map((r) => updateDocumentTypeAccess(r.type, draft[r.type])))
      setNotice({ tone: 'success', text: t.saved })
      onSaved()
    } catch (err) {
      setNotice({ tone: 'danger', text: asErrorMessage(err, t.saveError) })
    } finally {
      setSaving(false)
    }
  }

  const options = useAccessOptions()

  return (
    <section className="doc-access">
      <h3 className="doc-access-title">{t.title}</h3>
      <p className="reports-hint">{t.intro}</p>
      <p className="reports-hint">{t.ownNote}</p>
      <p className="reports-hint">{t.supervisorsNote}</p>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {loading && !error && <p className="loading-state">…</p>}

      {/* La leyenda de los iconos: los mandos de abajo van sin rótulo. */}
      {rules.length > 0 && <AccessLegend title={t.legend} options={options.legend} />}
      {rules.length > 0 && (
        <div className="report-table-wrap">
          <table className="report-table doc-access-table">
            <thead>
              <tr>
                <th rowSpan={2}>{t.typeColumn}</th>
                <th rowSpan={2}>{t.adminColumn}</th>
                <th rowSpan={2}>{t.supervisorColumn}</th>
                {/* El grupo del conductor: lo que lista y lo que hace con ello. */}
                <th colSpan={4} className="doc-access-group">
                  {t.driversGroup}
                </th>
              </tr>
              <tr>
                <th>{t.listColumn}</th>
                <th>{t.viewColumn}</th>
                <th>{t.downloadColumn}</th>
                <th>{t.deletionColumn}</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => {
                const label = typeLabels[r.type] ?? r.type_display
                const row = draft[r.type] ?? saved[r.type]
                const dirty = !same(row, saved[r.type])
                return (
                  <tr key={r.type} className={dirty ? 'is-dirty' : undefined}>
                    <th scope="row">{label}</th>
                    <td>
                      <span title={t.adminFixed}>
                        <Badge tone="neutral">{t.adminAlways}</Badge>
                      </span>
                    </td>
                    <td>
                      <label className="baja-toggle">
                        <input
                          type="checkbox"
                          aria-label={t.supervisorAria(label)}
                          checked={row.supervisor_read}
                          onChange={(e) => set(r.type, { supervisor_read: e.target.checked })}
                        />
                        {t.supervisorReads}
                      </label>
                    </td>
                    <td>
                      <SegSwitch
                        label={t.listAria(label)}
                        value={row.driver_read}
                        options={options.list}
                        onChange={(value) => set(r.type, { driver_read: value })}
                        iconsOnly
                      />
                    </td>
                    {/* Lo que no se lista no se ve, no se baja ni se pide
                        borrar: esos tres mandos se apagan con «No listar». */}
                    <td>
                      <SegSwitch
                        label={t.viewAria(label)}
                        value={row.driver_view}
                        options={options.action}
                        onChange={(value) => set(r.type, { driver_view: value })}
                        iconsOnly
                        disabled={row.driver_read === 'none'}
                        disabledHint={t.notListedHint}
                      />
                    </td>
                    <td>
                      <SegSwitch
                        label={t.downloadAria(label)}
                        value={row.driver_download}
                        options={options.action}
                        onChange={(value) => set(r.type, { driver_download: value })}
                        iconsOnly
                        disabled={row.driver_read === 'none'}
                        disabledHint={t.notListedHint}
                      />
                    </td>
                    <td>
                      {/* La papelera del campo nunca borra: pide, o ni eso. */}
                      <SegSwitch
                        label={t.deletionAria(label)}
                        value={row.driver_delete}
                        options={options.remove}
                        onChange={(value) => set(r.type, { driver_delete: value })}
                        iconsOnly
                        disabled={row.driver_read === 'none'}
                        disabledHint={t.notListedHint}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="doc-access-foot">
        <span className="muted">{changed.length ? t.pending(changed.length) : ''}</span>
        {notice && (
          <span className={notice.tone === 'danger' ? 'form-error' : 'muted'} role="status">
            {notice.text}
          </span>
        )}
        <Button variant="primary" disabled={!changed.length || saving} onClick={save}>
          {saving ? t.saving : t.save}
        </Button>
      </div>
    </section>
  )
}
