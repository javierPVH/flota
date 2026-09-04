import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useOutletContext, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Plus, Trash2 } from 'lucide-react'
import { Button, PageHeader, SelectField, TextAreaField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { createIncident, fetchVehicleSummary, listVehicles, uploadDocument } from '../api.ts'
import type { IncidentInput } from '../api.ts'
import { useAuth } from '../auth.ts'
import type { LayoutContext } from '../components/Layout.tsx'
import { fmtKm, todayIso } from '../format.ts'
import { useLang } from '../i18n.tsx'
import {
  enqueueIncidentWithFiles,
  isNetworkError,
  newClientRef,
  safeEnqueue,
} from '../offline/queue.ts'
import type { Incident, Vehicle } from '../types.ts'

const INCIDENT_TYPES = ['general', 'tires', 'maintenance']
const nowLocalDateTime = () => {
  const now = new Date()
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
  return now.toISOString().slice(0, 16)
}

type ThirdParty = {
  plate: string; brand: string; model: string; full_name: string; phone: string
  insurer: string; policy_number: string; damage_description: string
}
type InjuredPerson = { full_name: string; phone: string; email: string; plate: string; seat: string }

const emptyThirdParty = (): ThirdParty => ({
  plate: '', brand: '', model: '', full_name: '', phone: '', insurer: '',
  policy_number: '', damage_description: '',
})
const emptyInjuredPerson = (): InjuredPerson => ({
  full_name: '', phone: '', email: '', plate: '', seat: 'driver',
})

/** Alta unificada de avería: general, neumáticos o propuesta de mejora. */
export function NewIncidentPage() {
  const { user } = useAuth()
  const { t, language } = useLang()
  const isSupervisor = user?.roles.includes('supervisor') ?? false
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const origin = isSupervisor && params.get('desde') === 'grupo' ? '/grupo' : '/'
  const requestedType = params.get('tipo') ?? ''
  // Modo "Mi vehículo" del supervisor: el alta queda acotada a su pareja
  // (coche propio + sustitución). Conductor: sin recorte. Modo Flota: el
  // selector pide al back SOLO los coches que supervisa (los roles se suman;
  // sin filtro un supervisor-admin vería toda la flota).
  const ctx = useOutletContext<LayoutContext | null>()
  const ownIds = ctx && !ctx.fleetMode ? (ctx.ownPair?.ids ?? null) : null
  const supervisedBy = ctx?.fleetMode ? user?.id ?? null : null
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [form, setForm] = useState({
    vehicle: params.get('vehiculo') ?? '',
    type: INCIDENT_TYPES.includes(requestedType) ? requestedType : 'general',
    date: todayIso(), description: '', mileage: '', workshopPostalCode: '',
  })
  const [details, setDetails] = useState<Record<string, string>>({
    preferred_at: '', change_reason: '', wheel_scope: 'front', front_measure: '',
    rear_measure: '', wheel: 'front_left', tire_measure: '', street: '',
    street_number: '', postal_code: '', locality: '', province: '', occurred_at: '',
    phone: '', damage_description: '', police_report_reference: '',
  })
  const [thirdParties, setThirdParties] = useState<ThirdParty[]>([])
  const [injuredPeople, setInjuredPeople] = useState<InjuredPerson[]>([])
  const [photos, setPhotos] = useState<File[]>([])
  const [accidentReport, setAccidentReport] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // R3-27: la incidencia YA creada cuando falló alguna subida — reintentar no
  // debe crear una segunda idéntica, solo terminar las subidas pendientes.
  const [created, setCreated] = useState<Incident | null>(null)
  const [pendingUploads, setPendingUploads] = useState<Array<{ file: File; type: string }> | null>(
    null,
  )
  // R3-27: sin cobertura el parte queda encolado — pantalla de confirmación.
  const [queuedDone, setQueuedDone] = useState(false)

  useEffect(() => {
    let alive = true
    listVehicles(supervisedBy !== null ? { supervisor: supervisedBy } : {})
      .then((page) => {
        if (!alive) return
        setVehicles(page.results)
        if (!params.get('vehiculo') && page.results.length === 1) {
          setForm((current) => ({ ...current, vehicle: String(page.results[0].id) }))
        }
      })
      .catch(() => alive && setVehicles([]))
    return () => { alive = false }
  }, [params, supervisedBy])

  const selectable = useMemo(
    () => (ownIds ? vehicles.filter((v) => ownIds.includes(v.id)) : vehicles),
    [vehicles, ownIds],
  )
  // El recorte puede dejar UNA opción (se elige sola) o invalidar la elegida.
  useEffect(() => {
    if (!ownIds) return
    setForm((current) => {
      if (current.vehicle && !ownIds.includes(Number(current.vehicle))) {
        return { ...current, vehicle: '' }
      }
      if (!current.vehicle && selectable.length === 1) {
        return { ...current, vehicle: String(selectable[0].id) }
      }
      return current
    })
  }, [ownIds, selectable])

  // Odómetro conocido del coche elegido: precarga «Kilometraje actual» — el
  // mismo dato que ya enseña el tablero, para no bajar a mirar el cuadro. El
  // campo SIGUE al coche: al cambiarlo se repone con el suyo.
  // Indexado por coche: sin selección no hay km que enseñar, y volver a uno ya
  // consultado no arrastra el número del anterior.
  const [kmByVehicle, setKmByVehicle] = useState<Record<string, number | null>>({})
  const kmCurrent = form.vehicle ? kmByVehicle[form.vehicle] ?? null : null
  useEffect(() => {
    if (!form.vehicle) return
    const chosen = form.vehicle
    let alive = true
    fetchVehicleSummary(Number(chosen))
      .then((summary) => {
        if (!alive) return
        const km = summary.km_current ?? null
        setKmByVehicle((rows) => ({ ...rows, [chosen]: km }))
        setForm((current) => ({ ...current, mileage: km != null ? String(km) : '' }))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [form.vehicle])

  const setDetail = (name: string, value: string) => setDetails((current) => ({ ...current, [name]: value }))
  const updateThirdParty = (index: number, patch: Partial<ThirdParty>) => setThirdParties(
    (rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row),
  )
  const updateInjuredPerson = (index: number, patch: Partial<InjuredPerson>) => setInjuredPeople(
    (rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row),
  )

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!form.vehicle) return
    setSaving(true)
    setError('')
    const incidentDetails: Record<string, unknown> = form.type === 'accident'
      ? { ...details, report_version: 1, third_parties: thirdParties, injured_people: injuredPeople }
      : form.type === 'tires' ? { ...details, report_version: 1 }
        : form.type === 'breakdown' ? { report_version: 1 } : {}
    const description = form.type === 'accident' ? details.damage_description : form.description
    const date = form.type === 'accident' && details.occurred_at ? details.occurred_at.slice(0, 10) : form.date
    // En un reintento solo quedan las subidas que fallaron; la primera vez, todas.
    const uploads = pendingUploads ?? [
      ...(form.type === 'maintenance' ? [] : photos.map((file) => ({ file, type: 'damage_photos' }))),
      ...(form.type === 'accident' && accidentReport
        ? [{ file: accidentReport, type: 'accident_report' }] : []),
    ]
    try {
      let incident = created
      if (!incident) {
        const payload: IncidentInput & { client_ref: string } = {
          vehicle: Number(form.vehicle), type: form.type, date, description,
          mileage: form.mileage ? Number(form.mileage) : null,
          workshop_postal_code: form.workshopPostalCode, details: incidentDetails,
          // R3-34: misma referencia en el intento directo y en el reenvío.
          client_ref: newClientRef(),
        }
        try {
          incident = await createIncident(payload)
        } catch (err) {
          // R3-27: sin cobertura, el parte ENTERO (con sus adjuntos) queda en
          // la cola en vez de perderse el formulario.
          if (isNetworkError(err) && (await enqueueIncidentWithFiles(payload, uploads))) {
            setQueuedDone(true)
            return
          }
          throw err
        }
        // R3-27: guardar el id — si una subida falla, el reintento no debe
        // crear una segunda incidencia idéntica.
        setCreated(incident)
      }
      const failed: Array<{ file: File; type: string }> = []
      for (const upload of uploads) {
        const docPayload = {
          vehicle: incident.vehicle,
          type: upload.type,
          incident: incident.id,
          client_ref: newClientRef(),
        }
        try {
          await uploadDocument(docPayload, upload.file)
        } catch (err) {
          // R3-27: sin red, el adjunto va a la cola de documentos (llegará al
          // reconectar); cualquier otro fallo queda pendiente de reintento.
          if (
            isNetworkError(err) &&
            (await safeEnqueue({
              kind: 'document',
              payload: docPayload,
              file: upload.file,
              fileName: upload.file.name,
              fileType: upload.file.type,
            }))
          ) {
            continue
          }
          failed.push(upload)
        }
      }
      setPendingUploads(failed)
      if (failed.length) {
        setError(t.newIncident.uploadFailed(failed.map((upload) => upload.file.name).join(', ')))
        return
      }
      navigate(origin, { replace: true })
    } catch (err) {
      setError(asErrorMessage(err, t.newIncident.createError))
    } finally {
      setSaving(false)
    }
  }

  const title = t.newIncident.titleBreakdown

  // R3-27: el parte quedó guardado en el dispositivo — decirlo claramente, que
  // no parezca que ya se comunicó.
  if (queuedDone) {
    return (
      <div className="km-saved">
        <CheckCircle2 size={52} aria-hidden className="km-saved-queued" />
        <h2>{t.newIncident.queuedTitle}</h2>
        <p className="km-saved-detail" role="status">{t.newIncident.queuedNote}</p>
        <Button onClick={() => navigate(origin, { replace: true })}>{t.newIncident.back}</Button>
      </div>
    )
  }

  return (
    <div className="field-page">
      <PageHeader
        breadcrumb={<Link to={origin} className="back-link"><ArrowLeft size={16} aria-hidden /> {t.newIncident.back}</Link>}
        title={title}
      />
      <form className="modal-form" onSubmit={handleSubmit}>
        {selectable.length > 1 && <SelectField
          label={t.newIncident.vehicle}
          options={[{ value: '', label: t.newIncident.choose }, ...selectable.map((vehicle) => ({
            value: String(vehicle.id), label: `${vehicle.plate} · ${vehicle.brand} ${vehicle.model}`,
          }))]}
          value={form.vehicle}
          onValueChange={(vehicle) => setForm((current) => ({ ...current, vehicle }))}
          required
          requiredVisual
        />}
        <div className="incident-grid breakdown-kind-date">
          <SelectField
            label={t.newIncident.type}
            options={INCIDENT_TYPES.map((value) => ({ value, label: t.newIncident.types[value] ?? value }))}
            value={form.type}
            onValueChange={(type) => setForm((current) => ({ ...current, type }))}
            required
            requiredVisual
          />
          <TextInputField label={t.newIncident.date} type="date" max={todayIso()} value={form.date} onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))} required requiredVisual />
        </div>

        {form.type === 'tires' && <section className="incident-section" aria-labelledby="tires-data-title">
          <h2 id="tires-data-title">{t.newIncident.tiresData}</h2>
          <TextInputField label={t.newIncident.mileage} type="number" min={0} value={form.mileage} onChange={(event) => setForm((current) => ({ ...current, mileage: event.target.value }))} required requiredVisual />
          {kmCurrent != null && (
            <p className="update-hint">{t.newIncident.mileageFromReading(fmtKm(kmCurrent, language))}</p>
          )}
          <SelectField label={t.newIncident.changeReason} options={[
            { value: '', label: t.newIncident.choose }, { value: 'wear', label: t.newIncident.wear },
            { value: 'puncture', label: t.newIncident.puncture },
          ]} value={details.change_reason} onValueChange={(value) => setDetail('change_reason', value)} required requiredVisual />
          {details.change_reason === 'wear' && <>
            <SelectField label={t.newIncident.whichWheels} options={[
              { value: 'front', label: t.newIncident.front }, { value: 'rear', label: t.newIncident.rear },
              { value: 'all', label: t.newIncident.allWheels },
            ]} value={details.wheel_scope} onValueChange={(value) => setDetail('wheel_scope', value)} required requiredVisual />
            <div className="incident-grid">
              {(details.wheel_scope === 'front' || details.wheel_scope === 'all') && <TextInputField label={t.newIncident.frontMeasure} placeholder="205/55 R16" value={details.front_measure} onChange={(event) => setDetail('front_measure', event.target.value)} required requiredVisual />}
              {(details.wheel_scope === 'rear' || details.wheel_scope === 'all') && <TextInputField label={t.newIncident.rearMeasure} placeholder="205/55 R16" value={details.rear_measure} onChange={(event) => setDetail('rear_measure', event.target.value)} required requiredVisual />}
            </div>
          </>}
          {details.change_reason === 'puncture' && <div className="incident-grid">
            <SelectField label={t.newIncident.whichWheel} options={[
              { value: 'front_left', label: t.newIncident.frontLeft }, { value: 'front_right', label: t.newIncident.frontRight },
              { value: 'rear_left', label: t.newIncident.rearLeft }, { value: 'rear_right', label: t.newIncident.rearRight },
            ]} value={details.wheel} onValueChange={(value) => setDetail('wheel', value)} required requiredVisual />
            <TextInputField label={t.newIncident.tireMeasure} placeholder="205/55 R16" value={details.tire_measure} onChange={(event) => setDetail('tire_measure', event.target.value)} required requiredVisual />
          </div>}
          <TextAreaField label={t.newIncident.comment} rows={3} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
        </section>}

        {form.type === 'breakdown' && <section className="incident-section" aria-labelledby="breakdown-data-title">
          <h2 id="breakdown-data-title">{t.newIncident.breakdownData}</h2>
          <div className="incident-grid">
            <TextInputField label={t.newIncident.mileage} type="number" min={0} value={form.mileage} onChange={(event) => setForm((current) => ({ ...current, mileage: event.target.value }))} required requiredVisual />
            <TextInputField label={t.newIncident.workshopPostalCode} inputMode="numeric" pattern="[0-9]{5}" maxLength={5} value={form.workshopPostalCode} onChange={(event) => setForm((current) => ({ ...current, workshopPostalCode: event.target.value }))} required requiredVisual />
          </div>
          {kmCurrent != null && (
            <p className="update-hint">{t.newIncident.mileageFromReading(fmtKm(kmCurrent, language))}</p>
          )}
          <TextAreaField label={t.newIncident.description} rows={4} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder={t.newIncident.breakdownPlaceholder} required requiredVisual />
        </section>}

        {form.type === 'accident' && <section className="incident-section" aria-labelledby="accident-data-title">
          <h2 id="accident-data-title">{t.newIncident.accidentData}</h2>
          <div className="incident-grid">
            <TextInputField label={t.newIncident.street} value={details.street} onChange={(event) => setDetail('street', event.target.value)} required requiredVisual />
            <TextInputField label={t.newIncident.streetNumber} value={details.street_number} onChange={(event) => setDetail('street_number', event.target.value)} />
            <TextInputField label={t.newIncident.postalCode} inputMode="numeric" pattern="[0-9]{5}" maxLength={5} value={details.postal_code} onChange={(event) => setDetail('postal_code', event.target.value)} required requiredVisual />
            <TextInputField label={t.newIncident.locality} value={details.locality} onChange={(event) => setDetail('locality', event.target.value)} required requiredVisual />
            <TextInputField label={t.newIncident.province} value={details.province} onChange={(event) => setDetail('province', event.target.value)} required requiredVisual />
            <TextInputField label={t.newIncident.accidentAt} type="datetime-local" max={nowLocalDateTime()} value={details.occurred_at} onChange={(event) => setDetail('occurred_at', event.target.value)} required requiredVisual />
            <TextInputField label={t.newIncident.phone} type="tel" value={details.phone} onChange={(event) => setDetail('phone', event.target.value)} required requiredVisual />
            <TextInputField label={t.newIncident.workshopPostalCodeOptional} inputMode="numeric" pattern="[0-9]{5}" maxLength={5} value={form.workshopPostalCode} onChange={(event) => setForm((current) => ({ ...current, workshopPostalCode: event.target.value }))} />
          </div>
          <TextAreaField label={t.newIncident.damageDescription} rows={4} value={details.damage_description} onChange={(event) => setDetail('damage_description', event.target.value)} required requiredVisual />

          <RepeatableHeader title={t.newIncident.thirdParties} addLabel={t.newIncident.add} onAdd={() => setThirdParties((rows) => [...rows, emptyThirdParty()])} />
          {thirdParties.map((row, index) => <div className="incident-repeat-card" key={`third-${index}`}>
            <button type="button" className="incident-remove" aria-label={t.newIncident.removeThirdParty} onClick={() => setThirdParties((rows) => rows.filter((_, rowIndex) => rowIndex !== index))}><Trash2 size={17} aria-hidden /></button>
            <div className="incident-grid">
              <TextInputField label={t.newIncident.plate} value={row.plate} onChange={(event) => updateThirdParty(index, { plate: event.target.value })} />
              <TextInputField label={t.newIncident.brand} value={row.brand} onChange={(event) => updateThirdParty(index, { brand: event.target.value })} />
              <TextInputField label={t.newIncident.model} value={row.model} onChange={(event) => updateThirdParty(index, { model: event.target.value })} />
              <TextInputField label={t.newIncident.fullName} value={row.full_name} onChange={(event) => updateThirdParty(index, { full_name: event.target.value })} />
              <TextInputField label={t.newIncident.phone} type="tel" value={row.phone} onChange={(event) => updateThirdParty(index, { phone: event.target.value })} />
              <TextInputField label={t.newIncident.insurer} value={row.insurer} onChange={(event) => updateThirdParty(index, { insurer: event.target.value })} />
              <TextInputField label={t.newIncident.policyNumber} value={row.policy_number} onChange={(event) => updateThirdParty(index, { policy_number: event.target.value })} />
            </div>
            <TextAreaField label={t.newIncident.damageDescription} rows={2} value={row.damage_description} onChange={(event) => updateThirdParty(index, { damage_description: event.target.value })} />
          </div>)}

          <RepeatableHeader title={t.newIncident.injuredPeople} addLabel={t.newIncident.add} onAdd={() => setInjuredPeople((rows) => [...rows, emptyInjuredPerson()])} />
          {injuredPeople.map((row, index) => <div className="incident-repeat-card" key={`injured-${index}`}>
            <button type="button" className="incident-remove" aria-label={t.newIncident.removeInjured} onClick={() => setInjuredPeople((rows) => rows.filter((_, rowIndex) => rowIndex !== index))}><Trash2 size={17} aria-hidden /></button>
            <div className="incident-grid">
              <TextInputField label={t.newIncident.fullName} value={row.full_name} onChange={(event) => updateInjuredPerson(index, { full_name: event.target.value })} />
              <TextInputField label={t.newIncident.phone} type="tel" value={row.phone} onChange={(event) => updateInjuredPerson(index, { phone: event.target.value })} />
              <TextInputField label={t.newIncident.email} type="email" value={row.email} onChange={(event) => updateInjuredPerson(index, { email: event.target.value })} />
              <TextInputField label={t.newIncident.plate} value={row.plate} onChange={(event) => updateInjuredPerson(index, { plate: event.target.value })} />
              <SelectField label={t.newIncident.seat} options={[
                { value: 'driver', label: t.newIncident.driver }, { value: 'passenger', label: t.newIncident.passenger },
              ]} value={row.seat} onValueChange={(seat) => updateInjuredPerson(index, { seat })} />
            </div>
          </div>)}
          <TextInputField label={t.newIncident.policeReportReference} value={details.police_report_reference} onChange={(event) => setDetail('police_report_reference', event.target.value)} />
          <label className="file-field"><span>{t.newIncident.accidentReport}</span><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => setAccidentReport(event.target.files?.[0] ?? null)} />{accidentReport && <span className="doc-sub">{accidentReport.name}</span>}</label>
        </section>}

        {(form.type === 'general' || form.type === 'maintenance') && <>
          <TextAreaField label={t.newIncident.description} rows={3} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder={t.newIncident.descPlaceholder} required requiredVisual />
        </>}
        {form.type !== 'maintenance' && <label className="file-field"><span>{t.newIncident.photos}</span><input type="file" accept="image/jpeg,image/png,image/webp,image/heic" multiple onChange={(event) => setPhotos(Array.from(event.target.files ?? []))} />{photos.length > 0 && <span className="doc-sub">{t.newIncident.photosSelected(photos.length)}</span>}</label>}
        {error && <div role="alert" className="form-error">{error}</div>}
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={() => navigate(origin)}>{t.common.cancel}</Button>
          <Button type="submit" disabled={saving || !form.vehicle}>{saving ? t.newIncident.submitting : t.newIncident.submit}</Button>
        </div>
      </form>
    </div>
  )
}

function RepeatableHeader({ title, addLabel, onAdd }: { title: string; addLabel: string; onAdd: () => void }) {
  return <div className="incident-repeat-head">
    <h3>{title}</h3>
    <button type="button" className="incident-add" onClick={onAdd}><Plus size={16} aria-hidden /> {addLabel}</button>
  </div>
}
