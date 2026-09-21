import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useOutletContext, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Camera, CheckCircle2 } from 'lucide-react'
import { Button, PageHeader, SelectField, TextAreaField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { createIncident, fetchVehicleSummary, listVehicles, uploadDocument } from '../api.ts'
import type { IncidentInput } from '../api.ts'
import { useAuth } from '../auth.ts'
import type { LayoutContext } from '../components/Layout.tsx'
import { fmtKm, todayIso } from '../format.ts'
import { DEFAULT_PRIORITY, priorityOptions } from '../incidentPriority.ts'
import { DEFAULT_INCIDENT_TYPE, INCIDENT_TYPES, attachmentDocType } from '../incidentTypes.ts'
import { useLang } from '../i18n.tsx'
import {
  enqueueIncidentWithFiles,
  isNetworkError,
  newClientRef,
  safeEnqueue,
} from '../offline/queue.ts'
import { compressImages } from '../offline/images.ts'
import type { Incident, Vehicle } from '../types.ts'

/** Alta unificada de incidencia, con el MISMO catálogo de tipos que el modal de
 * la tarjeta y que gestión (`src/incidentTypes.ts`). El accidente tiene su
 * parte (`AccidentModal`); R5-61 retiró de esta página sus ramas, que no se
 * podían elegir y duplicaban aquel formulario. */
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
    type: (INCIDENT_TYPES as readonly string[]).includes(requestedType)
      ? requestedType
      : DEFAULT_INCIDENT_TYPE,
    date: todayIso(), description: '', mileage: '',
    // La prioridad la marca quien abre la petición (gestión tría por ella).
    priority: DEFAULT_PRIORITY as string,
  })
  // El parte guiado de neumáticos (GAP-6): motivo y medidas.
  const [details, setDetails] = useState<Record<string, string>>({
    change_reason: '', wheel_scope: 'front', front_measure: '', rear_measure: '',
    wheel: 'front_left', tire_measure: '',
  })
  const [photos, setPhotos] = useState<File[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // R3-27: la incidencia YA creada cuando falló alguna subida — reintentar no
  // debe crear una segunda idéntica, solo terminar las subidas pendientes.
  const [created, setCreated] = useState<Incident | null>(null)
  // R5-50: la referencia de idempotencia de la petición se fija UNA vez por
  // captura (no por pulsación): el reintento manual tras un 502/504 no duplica.
  const [clientRef] = useState(newClientRef)
  const [pendingUploads, setPendingUploads] = useState<
    Array<{ file: File; type: string; client_ref: string }> | null
  >(
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
  const [kmByVehicle, setKmByVehicle] = useState<
    Record<string, { km: number | null; estimated: boolean }>
  >({})
  const kmCurrent = form.vehicle ? kmByVehicle[form.vehicle]?.km ?? null : null
  // R3-42: si la lectura precargada salió del cálculo automático (N8b), la
  // pista lo dice — el número puede no corresponder con el cuadro.
  const kmEstimated = form.vehicle ? kmByVehicle[form.vehicle]?.estimated ?? false : false
  useEffect(() => {
    if (!form.vehicle) return
    const chosen = form.vehicle
    let alive = true
    fetchVehicleSummary(Number(chosen))
      .then((summary) => {
        if (!alive) return
        const km = summary.km_current ?? null
        setKmByVehicle((rows) => ({
          ...rows,
          [chosen]: { km, estimated: summary.km_estimated ?? false },
        }))
        setForm((current) => ({ ...current, mileage: km != null ? String(km) : '' }))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [form.vehicle])

  const setDetail = (name: string, value: string) => setDetails((current) => ({ ...current, [name]: value }))

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!form.vehicle) return
    setSaving(true)
    setError('')
    const incidentDetails: Record<string, unknown> =
      form.type === 'tires' ? { ...details, report_version: 1 } : {}
    // En un reintento solo quedan las subidas que fallaron; la primera vez, todas.
    const uploads = pendingUploads ?? [
      // Cualquier petición puede llevar adjunto, y de qué tipo es lo dice la
      // regla compartida (`incidentTypes.ts`), la misma que el modal.
      // Cada adjunto lleva su referencia desde el principio: el reintento
      // (`pendingUploads`) reutiliza la misma y no sube el archivo dos veces.
      ...photos.map((file) => ({
        file, type: attachmentDocType(form.type),
        client_ref: newClientRef(),
      })),
    ]
    try {
      let incident = created
      if (!incident) {
        const payload: IncidentInput & { client_ref: string } = {
          vehicle: Number(form.vehicle), type: form.type, priority: form.priority,
          date: form.date, description: form.description,
          mileage: form.mileage ? Number(form.mileage) : null,
          details: incidentDetails,
          // R3-34: misma referencia en el intento directo y en el reenvío.
          client_ref: clientRef,
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
      const failed: Array<{ file: File; type: string; client_ref: string }> = []
      for (const upload of uploads) {
        const docPayload = {
          vehicle: incident.vehicle,
          type: upload.type,
          incident: incident.id,
          client_ref: upload.client_ref,
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
        <SelectField
          label={t.priority.label}
          options={priorityOptions(t.priority)}
          value={form.priority}
          onValueChange={(priority) => setForm((current) => ({ ...current, priority }))}
          required
          requiredVisual
        />

        {form.type === 'tires' && <section className="incident-section" aria-labelledby="tires-data-title">
          <h2 id="tires-data-title">{t.newIncident.tiresData}</h2>
          <TextInputField label={t.newIncident.mileage} type="number" min={0} value={form.mileage} onChange={(event) => setForm((current) => ({ ...current, mileage: event.target.value }))} required requiredVisual />
          {kmCurrent != null && (
            <p className="update-hint">{kmEstimated
              ? t.newIncident.mileageFromReadingEstimated(fmtKm(kmCurrent, language))
              : t.newIncident.mileageFromReading(fmtKm(kmCurrent, language))}</p>
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

        {/* Todo lo que no lleva parte guiado se cuenta escribiéndolo: los
            neumáticos tienen el suyo (con su comentario opcional) y el resto
            —avería, mantenimiento puntual y petición general— pide descripción. */}
        {form.type !== 'tires' && (
          <TextAreaField label={t.newIncident.description} rows={3} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder={t.newIncident.descPlaceholder} required requiredVisual />
        )}
        {/* El adjunto no depende del tipo: toda petición admite prueba, y
            acepta PDF además de foto (un presupuesto no se hace con la
            cámara), como el modal de la tarjeta. */}
        <label className={`photo-attach${photos.length > 0 ? ' has-file' : ''}`}>
          <Camera size={18} aria-hidden />
          {photos.length > 0 ? t.newIncident.attachmentsSelected(photos.length) : t.newIncident.attachments}
          <input type="file" aria-label={t.newIncident.attachments} accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" multiple onChange={async (event) => setPhotos(await compressImages(Array.from(event.target.files ?? [])))} />
        </label>
        {error && <div role="alert" className="form-error">{error}</div>}
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={() => navigate(origin)}>{t.common.cancel}</Button>
          <Button type="submit" disabled={saving || !form.vehicle}>{saving ? t.newIncident.submitting : t.newIncident.submit}</Button>
        </div>
      </form>
    </div>
  )
}
