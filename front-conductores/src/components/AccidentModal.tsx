import { useState, type FormEvent } from 'react'
import { Camera, Pencil, Plus, Trash2, User } from 'lucide-react'
import { Button, SelectField, TextAreaField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { createIncident, uploadDocument } from '../api.ts'
import { DEFAULT_PRIORITY, priorityOptions } from '../incidentPriority.ts'
import type { IncidentInput } from '../api.ts'
import { todayIso } from '../format.ts'
import { useLang } from '../i18n.tsx'
import { enqueueIncidentWithFiles, isNetworkError, newClientRef, safeEnqueue } from '../offline/queue.ts'
import { compressImage } from '../offline/images.ts'
import type { Vehicle } from '../types.ts'
import { SupervisorModal } from './SupervisorModal.tsx'

/** El parte, en el orden en que se cuenta un accidente — los MISMOS cuatro
 * pasos que en gestión (`AccidentReportForm`) y el mismo recorrido que el modal
 * de incidencia: en una sola pantalla eran treinta campos de scroll, y en un
 * móvil al borde de la carretera eso no se rellena. */
type Step = 'where' | 'damage' | 'people' | 'report'
const STEPS: Step[] = ['where', 'damage', 'people', 'report']

const isPostalCode = (value: string) => /^[0-9]{5}$/.test(value)

const nowLocalDateTime = () => {
  const now = new Date()
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
  return now.toISOString().slice(0, 16)
}

type ThirdParty = {
  full_name: string
  plate: string
  brand: string
  model: string
  phone: string
  insurer: string
  policy_number: string
  damage_description: string
}
type InjuredPerson = { full_name: string; phone: string; email: string; plate: string; seat: string }

const emptyThirdParty = (): ThirdParty => ({
  full_name: '', plate: '', brand: '', model: '', phone: '', insurer: '',
  policy_number: '', damage_description: '',
})
const emptyInjuredPerson = (): InjuredPerson => ({
  full_name: '', phone: '', email: '', plate: '', seat: 'driver',
})

/** Parte guiado de accidente para el supervisor. Mantiene el mismo contrato
 * (`Incident.details.report_version = 1`) que Gestión y NewIncidentPage, de
 * modo que el back materializa AccidentReport, AccidentThirdParty y
 * AccidentInjured sin un flujo alternativo. */
export function AccidentModal({
  vehicle,
  onClose,
  onSaved,
}: {
  vehicle: Vehicle
  onClose: () => void
  onSaved?: () => void
}) {
  const { t } = useLang()
  const a = t.newIncident
  // Los rótulos de moverse son los del modal de incidencia: es el mismo gesto.
  const b = t.breakdown
  const [step, setStep] = useState<Step>('where')
  const [cameBack, setCameBack] = useState(false)
  const [details, setDetails] = useState({
    street: '', street_number: '', postal_code: '', locality: '', province: '',
    occurred_at: '', phone: '', workshop_postal_code: '', damage_description: '',
    police_report_reference: '',
  })
  // Prioridad del parte: la marca quien lo abre (gestión tría por ella).
  const [priority, setPriority] = useState<string>(DEFAULT_PRIORITY)
  const [thirdParties, setThirdParties] = useState<ThirdParty[]>([])
  const [injuredPeople, setInjuredPeople] = useState<InjuredPerson[]>([])
  // Implicado que se está rellenando en su modal (nuevo si `index` es null).
  const [editor, setEditor] = useState<
    | { kind: 'third'; index: number | null; draft: ThirdParty }
    | { kind: 'injured'; index: number | null; draft: InjuredPerson }
    | null
  >(null)
  const [reportFile, setReportFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  // R5-50: UNA referencia por captura (parte y archivo), no por pulsación: el
  // reintento manual tras un 502/504 manda la misma y el back no duplica.
  const [refs] = useState(() => ({ incident: newClientRef(), document: newClientRef() }))
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  // Lo obligatorio de cada paso, que es lo que exige «Continuar». Va a mano y
  // no por `checkValidity`: los pasos que no se ven no están montados, así que
  // el navegador no puede validarlos (igual que en el modal de incidencia).
  const whereValid = Boolean(
    details.street.trim() &&
    isPostalCode(details.postal_code) &&
    details.locality.trim() &&
    details.province.trim() &&
    details.occurred_at &&
    details.phone.trim(),
  )
  const damageValid = Boolean(
    details.damage_description.trim() &&
    (!details.workshop_postal_code || isPostalCode(details.workshop_postal_code)),
  )
  const stepValid: Record<Step, boolean> = {
    where: whereValid,
    damage: damageValid,
    // Terceros y heridos son opcionales: un accidente sin implicados existe.
    people: true,
    report: true,
  }
  const current = STEPS.indexOf(step)
  const nextStep = STEPS[current + 1]
  const previousStep = STEPS[current - 1]
  const stepLabels: Record<Step, string> = {
    where: a.stepWhere,
    damage: a.stepDamage,
    people: a.stepPeople,
    report: a.stepReport,
  }

  function goTo(next: Step) {
    setCameBack(STEPS.indexOf(next) < current)
    setStep(next)
    setError('')
  }

  const setDetail = (name: keyof typeof details, value: string) =>
    setDetails((current) => ({ ...current, [name]: value }))

  /** Abre el modal del implicado: sin índice es uno nuevo, con índice se
   * modifica una COPIA — cancelar tiene que dejar la lista como estaba. */
  const openThird = (index: number | null) =>
    setEditor({
      kind: 'third',
      index,
      draft: index === null ? emptyThirdParty() : { ...thirdParties[index] },
    })
  const openInjured = (index: number | null) =>
    setEditor({
      kind: 'injured',
      index,
      draft: index === null ? emptyInjuredPerson() : { ...injuredPeople[index] },
    })
  const patchThird = (patch: Partial<ThirdParty>) =>
    setEditor((current) =>
      current?.kind === 'third' ? { ...current, draft: { ...current.draft, ...patch } } : current,
    )
  const patchInjured = (patch: Partial<InjuredPerson>) =>
    setEditor((current) =>
      current?.kind === 'injured' ? { ...current, draft: { ...current.draft, ...patch } } : current,
    )

  /** Guarda el implicado del modal: lo añade o sustituye al que se editaba. */
  function saveEditor() {
    if (editor === null) return
    const { index } = editor
    if (editor.kind === 'third') {
      const person = editor.draft
      setThirdParties((rows) =>
        index === null ? [...rows, person] : rows.map((row, i) => (i === index ? person : row)),
      )
    } else {
      const person = editor.draft
      setInjuredPeople((rows) =>
        index === null ? [...rows, person] : rows.map((row, i) => (i === index ? person : row)),
      )
    }
    setEditor(null)
  }

  // Mínimo de cada ficha, el mismo que exige gestión: sin nombre (y matrícula,
  // en el tercero) la fila no dice nada y no hay a quién reclamar.
  const editorValid =
    editor === null
      ? false
      : editor.kind === 'third'
        ? Boolean(editor.draft.full_name.trim() && editor.draft.plate.trim())
        : Boolean(editor.draft.full_name.trim())

  /** Intro dentro del formulario: antes del último paso AVANZA, no comunica
   * (mismo criterio que el alta de vehículo de gestión). */
  function onFormSubmit(event: FormEvent) {
    event.preventDefault()
    if (nextStep !== undefined) {
      if (stepValid[step]) goTo(nextStep)
      return
    }
    void submit()
  }

  async function submit() {
    setSaving(true)
    setError('')
    const payload: IncidentInput & { client_ref: string } = {
      vehicle: vehicle.id,
      type: 'accident',
      priority,
      date: details.occurred_at ? details.occurred_at.slice(0, 10) : todayIso(),
      description: details.damage_description.trim(),
      workshop_postal_code: details.workshop_postal_code,
      details: {
        report_version: 1,
        street: details.street,
        street_number: details.street_number,
        postal_code: details.postal_code,
        locality: details.locality,
        province: details.province,
        occurred_at: details.occurred_at,
        phone: details.phone,
        damage_description: details.damage_description.trim(),
        police_report_reference: details.police_report_reference,
        third_parties: thirdParties,
        injured_people: injuredPeople,
      },
      // R3-34: misma referencia en el intento directo y en el reenvío offline.
      client_ref: refs.incident,
    }
    try {
      const incident = await createIncident(payload)
      let notice = t.accidentModal.saved
      if (reportFile) {
        const docPayload = {
          vehicle: vehicle.id,
          incident: incident.id,
          type: 'accident_report',
          client_ref: refs.document,
        }
        try {
          await uploadDocument(docPayload, reportFile)
        } catch (err) {
          // R3-27: sin red, el archivo del parte va a la cola de documentos en
          // vez de quedarse en un aviso y no llegar nunca.
          if (
            isNetworkError(err) &&
            (await safeEnqueue({
              kind: 'document',
              payload: docPayload,
              file: reportFile,
              fileName: reportFile.name,
              fileType: reportFile.type,
            }))
          ) {
            notice = t.accidentModal.savedUploadQueued(reportFile.name)
          } else {
            notice = t.accidentModal.savedUploadFailed(reportFile.name)
          }
        }
      }
      setDone(notice)
      onSaved?.()
    } catch (err) {
      // R3-27: el escenario natural de un accidente en obra es SIN cobertura —
      // el parte entero (dirección, terceros, heridos, archivo) queda en la
      // cola en vez de perderse el formulario al cerrar.
      if (
        isNetworkError(err) &&
        (await enqueueIncidentWithFiles(
          payload,
          reportFile ? [{ file: reportFile, type: 'accident_report' }] : [],
        ))
      ) {
        setDone(t.accidentModal.queued)
        onSaved?.()
      } else {
        setError(asErrorMessage(err, a.createError))
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <SupervisorModal
      open
      // Como el modal de incidencia: cuatro pasos y rejillas de dos columnas,
      // que con el ancho de serie se leen estrechas en tableta.
      wide
      title={t.accidentModal.title(vehicle.plate)}
      onClose={onClose}
      footer={done ? (
        <Button type="button" onClick={onClose}>{t.accidentModal.close}</Button>
      ) : (
        <>
          {previousStep === undefined ? (
            <Button type="button" variant="secondary" onClick={onClose}>{t.common.cancel}</Button>
          ) : (
            <Button type="button" onClick={() => goTo(previousStep)}>{b.back}</Button>
          )}
          {nextStep === undefined ? (
            <Button type="button" onClick={() => void submit()} disabled={saving}>
              {saving ? a.submitting : t.accidentModal.submit}
            </Button>
          ) : (
            <Button type="button" onClick={() => goTo(nextStep)} disabled={!stepValid[step]}>
              {b.next}
            </Button>
          )}
        </>
      )}
    >
      {done ? <p className="reminder-done" role="status">{done}</p> : (
        <form className="modal-form" onSubmit={onFormSubmit}>
          <div className="flow-steps" aria-hidden>
            {STEPS.map((key, index) => (
              <span
                key={key}
                className={`flow-step${index === current ? ' is-current' : index < current ? ' is-done' : ''}`}
              >
                {stepLabels[key]}
              </span>
            ))}
          </div>
          <div key={step} className={`step-pane${cameBack ? ' from-left' : ''}`}>
          {step === 'where' && <>
          <p className="update-hint">{a.accidentData}</p>
          <div className="incident-grid">
            <TextInputField label={a.street} aria-label={a.street} value={details.street} onChange={(e) => setDetail('street', e.target.value)} required requiredVisual />
            <TextInputField label={a.streetNumber} aria-label={a.streetNumber} value={details.street_number} onChange={(e) => setDetail('street_number', e.target.value)} />
            <TextInputField label={a.postalCode} aria-label={a.postalCode} inputMode="numeric" pattern="[0-9]{5}" maxLength={5} value={details.postal_code} onChange={(e) => setDetail('postal_code', e.target.value)} required requiredVisual />
            <TextInputField label={a.locality} aria-label={a.locality} value={details.locality} onChange={(e) => setDetail('locality', e.target.value)} required requiredVisual />
            <TextInputField label={a.province} aria-label={a.province} value={details.province} onChange={(e) => setDetail('province', e.target.value)} required requiredVisual />
            <TextInputField label={a.accidentAt} aria-label={a.accidentAt} type="datetime-local" max={nowLocalDateTime()} value={details.occurred_at} onChange={(e) => setDetail('occurred_at', e.target.value)} required requiredVisual />
            <TextInputField label={a.phone} aria-label={a.phone} type="tel" value={details.phone} onChange={(e) => setDetail('phone', e.target.value)} required requiredVisual />
            <SelectField label={t.priority.label} aria-label={t.priority.label} options={priorityOptions(t.priority)} value={priority} onValueChange={setPriority} required requiredVisual />
          </div>
          </>}

          {step === 'damage' && <>
          <TextAreaField label={a.damageDescription} aria-label={a.damageDescription} rows={4} value={details.damage_description} onChange={(e) => setDetail('damage_description', e.target.value)} required requiredVisual />
          {/* El CP del taller vive con los daños: es a dónde iría el coche. */}
          <TextInputField label={a.workshopPostalCodeOptional} aria-label={a.workshopPostalCodeOptional} inputMode="numeric" pattern="[0-9]{5}" maxLength={5} value={details.workshop_postal_code} onChange={(e) => setDetail('workshop_postal_code', e.target.value)} />
          </>}

          {step === 'people' && <>
          <p className="update-hint">{a.peopleHint}</p>
          {/* Cada implicado se rellena en SU modal y aquí solo se lee: siete
              campos por persona, repetidos en línea, tapaban el paso entero. */}
          <RepeatableHeader title={a.thirdParties} addLabel={a.add} onAdd={() => openThird(null)} />
          {thirdParties.length === 0 ? (
            <p className="empty-note">{a.noThirdParties}</p>
          ) : (
            <ul className="doc-list">
              {thirdParties.map((row, index) => (
                <PersonRow
                  key={`third-${index}`}
                  name={row.full_name || a.unnamed}
                  detail={[row.plate, [row.brand, row.model].filter(Boolean).join(' '), row.insurer]
                    .filter(Boolean)
                    .join(' · ')}
                  editLabel={a.edit(row.full_name || a.unnamed)}
                  removeLabel={a.removeThirdParty(row.full_name || a.unnamed)}
                  onEdit={() => openThird(index)}
                  onRemove={() => setThirdParties((rows) => rows.filter((_, i) => i !== index))}
                />
              ))}
            </ul>
          )}

          <RepeatableHeader title={a.injuredPeople} addLabel={a.add} onAdd={() => openInjured(null)} />
          {injuredPeople.length === 0 ? (
            <p className="empty-note">{a.noInjured}</p>
          ) : (
            <ul className="doc-list">
              {injuredPeople.map((row, index) => (
                <PersonRow
                  key={`injured-${index}`}
                  name={row.full_name || a.unnamed}
                  detail={[row.seat === 'driver' ? a.driver : a.passenger, row.plate, row.phone]
                    .filter(Boolean)
                    .join(' · ')}
                  editLabel={a.edit(row.full_name || a.unnamed)}
                  removeLabel={a.removeInjured(row.full_name || a.unnamed)}
                  onEdit={() => openInjured(index)}
                  onRemove={() => setInjuredPeople((rows) => rows.filter((_, i) => i !== index))}
                />
              ))}
            </ul>
          )}
          </>}

          {step === 'report' && <>
          <p className="update-hint">{a.reportHint}</p>
          <TextInputField label={a.policeReportReference} aria-label={a.policeReportReference} value={details.police_report_reference} onChange={(e) => setDetail('police_report_reference', e.target.value)} />
          {/* Misma caja de selección que el modal de Incidencia. */}
          <label className={`photo-attach${reportFile ? ' has-file' : ''}`}>
            <Camera size={18} aria-hidden />
            {reportFile ? reportFile.name : a.accidentReport}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
              // R5-54: la foto se comprime al elegirla (los PDF no se tocan).
              onChange={async (e) => {
                const f = e.target.files?.[0]
                setReportFile(f ? await compressImage(f) : null)
              }}
            />
          </label>
          </>}
          {error && <div role="alert" className="form-error">{error}</div>}
          </div>
        </form>
      )}

      {/* La ficha del implicado, en su propio modal: se rellena entera y se
          guarda, o se cancela y la lista se queda como estaba. */}
      {editor !== null && (
        <SupervisorModal
          open
          wide
          title={editor.kind === 'third' ? a.thirdPartyTitle : a.injuredTitle}
          onClose={() => setEditor(null)}
          footer={(
            <>
              <Button type="button" variant="secondary" onClick={() => setEditor(null)}>{t.common.cancel}</Button>
              <Button type="button" onClick={saveEditor} disabled={!editorValid}>{a.save}</Button>
            </>
          )}
        >
          <div className="modal-form">
            <p className="update-hint">
              {editor.kind === 'third' ? a.thirdPartyRequired : a.injuredRequired}
            </p>
            {editor.kind === 'third' ? (
              <>
                <div className="incident-grid">
                  <TextInputField label={a.fullName} aria-label={a.fullName} value={editor.draft.full_name} onChange={(e) => patchThird({ full_name: e.target.value })} required requiredVisual />
                  <TextInputField label={a.plate} aria-label={a.plate} value={editor.draft.plate} onChange={(e) => patchThird({ plate: e.target.value })} required requiredVisual />
                  <TextInputField label={a.brand} aria-label={a.brand} value={editor.draft.brand} onChange={(e) => patchThird({ brand: e.target.value })} />
                  <TextInputField label={a.model} aria-label={a.model} value={editor.draft.model} onChange={(e) => patchThird({ model: e.target.value })} />
                  <TextInputField label={a.phone} aria-label={a.phone} type="tel" value={editor.draft.phone} onChange={(e) => patchThird({ phone: e.target.value })} />
                  <TextInputField label={a.insurer} aria-label={a.insurer} value={editor.draft.insurer} onChange={(e) => patchThird({ insurer: e.target.value })} />
                  <TextInputField label={a.policyNumber} aria-label={a.policyNumber} value={editor.draft.policy_number} onChange={(e) => patchThird({ policy_number: e.target.value })} />
                </div>
                <TextAreaField label={a.damageDescription} aria-label={a.damageDescription} rows={2} value={editor.draft.damage_description} onChange={(e) => patchThird({ damage_description: e.target.value })} />
              </>
            ) : (
              <div className="incident-grid">
                <TextInputField label={a.fullName} aria-label={a.fullName} value={editor.draft.full_name} onChange={(e) => patchInjured({ full_name: e.target.value })} required requiredVisual />
                <TextInputField label={a.phone} aria-label={a.phone} type="tel" value={editor.draft.phone} onChange={(e) => patchInjured({ phone: e.target.value })} />
                <TextInputField label={a.email} aria-label={a.email} type="email" value={editor.draft.email} onChange={(e) => patchInjured({ email: e.target.value })} />
                <TextInputField label={a.plate} aria-label={a.plate} value={editor.draft.plate} onChange={(e) => patchInjured({ plate: e.target.value })} />
                <SelectField label={a.seat} aria-label={a.seat} options={[{ value: 'driver', label: a.driver }, { value: 'passenger', label: a.passenger }]} value={editor.draft.seat} onValueChange={(seat) => patchInjured({ seat })} />
              </div>
            )}
          </div>
        </SupervisorModal>
      )}
    </SupervisorModal>
  )
}

function RepeatableHeader({ title, addLabel, onAdd }: { title: string; addLabel: string; onAdd: () => void }) {
  return <div className="incident-repeat-head"><h3>{title}</h3><button type="button" className="incident-add" onClick={onAdd}><Plus size={16} aria-hidden /> {addLabel}</button></div>
}

/** Un implicado ya añadido: quién es, lo justo para reconocerlo y sus dos
 * acciones. Misma fila que la lista de documentos (`doc-item`). */
function PersonRow({
  name,
  detail,
  editLabel,
  removeLabel,
  onEdit,
  onRemove,
}: {
  name: string
  detail: string
  editLabel: string
  removeLabel: string
  onEdit: () => void
  onRemove: () => void
}) {
  return (
    <li className="doc-item">
      <User size={18} aria-hidden className="doc-icon" />
      <div className="doc-info">
        <strong>{name}</strong>
        {detail && <span className="doc-sub">{detail}</span>}
      </div>
      <button type="button" className="doc-remove" aria-label={editLabel} onClick={onEdit}>
        <Pencil size={18} aria-hidden />
      </button>
      <button type="button" className="doc-remove" aria-label={removeLabel} onClick={onRemove}>
        <Trash2 size={18} aria-hidden />
      </button>
    </li>
  )
}
