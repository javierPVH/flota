import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ChevronRight, Plus, Trash2 } from 'lucide-react'
import { Button, FileField, SelectField, TextInputField, useUiCopy } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { createIncident, updateVehicleFields, uploadDocument } from '../api.ts'
import { todayIso } from '../format.ts'
import { DEFAULT_PRIORITY, priorityOptions } from '../incidentPriority.ts'
import { useVehiclesCopy } from '../translations/vehicles.ts'
import type { Vehicle } from '../types.ts'
import { OpsSection, OpsSteps } from './OpsSteps.tsx'
import { useAsistente, type Paso } from './opsWizard.ts'

// Máximo del datetime-local: el accidente no puede ser futuro (lo valida
// también el back). Mismo cálculo que la PWA.
const nowLocalDateTime = () => {
  const now = new Date()
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
  return now.toISOString().slice(0, 16)
}

// Líneas repetibles del parte — los MISMOS campos que la PWA (NewIncidentPage):
// el back los valida en `details` y los materializa en sus tablas.
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
  full_name: '',
  plate: '',
  brand: '',
  model: '',
  phone: '',
  insurer: '',
  policy_number: '',
  damage_description: '',
})
const emptyInjuredPerson = (): InjuredPerson => ({
  full_name: '',
  phone: '',
  email: '',
  plate: '',
  seat: 'driver',
})

/** Los pasos del parte, en el orden en que se rellenan. */
type SectionKey = 'where' | 'damage' | 'people' | 'report'
/** Las dos listas del paso «Implicados». */
type Lista = 'third' | 'injured'

/**
 * Una ficha de implicado: cabecera que pliega y despliega, y sus campos.
 * Solo hay **una abierta por lista** —al añadir otra, la que estuviera abierta
 * se encoge—, así una lista larga se sigue leyendo de un vistazo. Plegada
 * enseña un resumen (el nombre) para saber cuál es sin abrirla.
 *
 * Los campos de una ficha plegada siguen montados pero ocultos: por eso sus
 * obligatorios NO son `required` del navegador —no puede enseñar su aviso en
 * un campo que no se ve— sino la regla del paso (`errorImplicados`).
 */
function FichaImplicado({
  titulo,
  resumen,
  abierta,
  onAbrir,
  onQuitar,
  quitarLabel,
  children,
}: {
  titulo: string
  resumen: string
  abierta: boolean
  onAbrir: () => void
  onQuitar: () => void
  quitarLabel: string
  children: ReactNode
}) {
  return (
    <div className="acc-repeat-card">
      <div className="acc-repeat-card-head">
        <button
          type="button"
          className="acc-repeat-toggle"
          aria-expanded={abierta}
          onClick={onAbrir}
        >
          <ChevronRight
            size={15}
            aria-hidden
            className={`ops-acc-chevron${abierta ? ' is-open' : ''}`}
          />
          <strong>{titulo}</strong>
          {!abierta && <span className="muted acc-repeat-sum">{resumen}</span>}
        </button>
        <Button type="button" size="sm" variant="danger" aria-label={quitarLabel} onClick={onQuitar}>
          <Trash2 size={15} aria-hidden />
        </Button>
      </div>
      <div className="acc-repeat-body" hidden={!abierta}>
        {children}
      </div>
    </div>
  )
}

interface Props {
  vehicle: Vehicle
  onClose: () => void
  onDone: () => void
}

/** Comunicación de accidente desde gestión: el mismo parte guiado que la PWA
 * —dónde y cuándo, daños, terceros implicados y lesionados, atestado y
 * archivo—, pero **por pasos**, como «Nuevo estado»: se avanza y se retrocede
 * con el pie, y cada paso pide lo suyo antes de dejarte salir. Abre una
 * petición de accidente (que se repasa en la pestaña «Gestionar accidentes»)
 * y, si se deja marcado, pasa el coche a «Accidentado».
 *
 * Es la primera pestaña de `AccidentModal` y también lo que abre el botón
 * «Parte de accidente» de la ficha. */
export function AccidentReportForm({ vehicle, onClose, onDone }: Props) {
  const copy = useVehiclesCopy()
  const t = copy.accident
  // La marca de «Obligatorio» de los campos del DS, para ponérsela también al
  // textarea (que no es un campo del DS y no la trae).
  const requiredBadge = useUiCopy().fieldShell.requiredBadge

  const [form, setForm] = useState({
    street: '',
    streetNumber: '',
    postalCode: '',
    locality: '',
    province: '',
    occurredAt: '',
    phone: '',
    workshopCp: '',
    damages: '',
    policeRef: '',
  })
  const setField = (name: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [name]: value }))

  const [thirdParties, setThirdParties] = useState<ThirdParty[]>([])
  const [injuredPeople, setInjuredPeople] = useState<InjuredPerson[]>([])
  const updateThirdParty = (index: number, patch: Partial<ThirdParty>) =>
    setThirdParties((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  const updateInjured = (index: number, patch: Partial<InjuredPerson>) =>
    setInjuredPeople((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))

  // Cuál de las dos listas se está rellenando y qué ficha está abierta en cada
  // una (`null` = todas plegadas). Se guardan por índice: al quitar una ficha
  // hay que correr el índice, que es lo que hace `quitar`.
  const [lista, setLista] = useState<Lista>('third')
  const [abiertoTercero, setAbiertoTercero] = useState<number | null>(null)
  const [abiertoLesionado, setAbiertoLesionado] = useState<number | null>(null)

  /** Al añadir, la nueva se abre y la que hubiera abierta se encoge. */
  const anadirTercero = () => {
    setAbiertoTercero(thirdParties.length)
    setThirdParties((rows) => [...rows, emptyThirdParty()])
  }
  const anadirLesionado = () => {
    setAbiertoLesionado(injuredPeople.length)
    setInjuredPeople((rows) => [...rows, emptyInjuredPerson()])
  }
  /** Quitada la ficha `index`, la abierta se corre (o se cierra si era esa). */
  const correr = (abierto: number | null, index: number) =>
    abierto === null || abierto === index ? null : abierto > index ? abierto - 1 : abierto
  const quitarTercero = (index: number) => {
    setThirdParties((rows) => rows.filter((_, i) => i !== index))
    setAbiertoTercero((abierto) => correr(abierto, index))
  }
  const quitarLesionado = (index: number) => {
    setInjuredPeople((rows) => rows.filter((_, i) => i !== index))
    setAbiertoLesionado((abierto) => correr(abierto, index))
  }

  const [reportFile, setReportFile] = useState<File | null>(null)
  // El accidente deja el coche «Accidentado» salvo que se desmarque (o ya lo esté).
  const vehicleAlreadyAccident = vehicle.state === 'accidente'
  const [markState, setMarkState] = useState(!vehicleAlreadyAccident)

  // Prioridad de la petición (por defecto moderada, como en el resto de altas).
  const [priority, setPriority] = useState<string>(DEFAULT_PRIORITY)
  const priorityChoices = useMemo(() => priorityOptions(copy.priority), [copy])

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  // El asistente: los cuatro pasos del parte, todos vivos (nada aquí depende
  // de lo elegido antes) y recorridos solo con los botones del pie.
  const formRef = useRef<HTMLFormElement>(null)
  const pasos: Array<Paso<SectionKey>> = [
    { key: 'where', label: t.stepWhere, off: false },
    { key: 'damage', label: t.stepDamage, off: false },
    { key: 'people', label: t.stepPeople, off: false },
    { key: 'report', label: t.stepReport, off: false },
  ]
  const {
    paso: pasoActivo,
    setPaso,
    pasoPrevio,
    pasoSiguiente,
    avanzar,
    alInvalido,
  } = useAsistente<SectionKey>({
    pasos,
    formRef,
    // Los obligatorios de los implicados no los sabe el navegador: sus campos
    // pueden estar en una ficha plegada (ver `FichaImplicado`).
    reglas: (p) => (p === 'people' ? llevarAlFallo(errorImplicados()) : ''),
    onError: setError,
  })

  /**
   * Lo que una ficha de implicado no puede dejarse en blanco: del **tercero**,
   * quién es y con qué coche iba —sin eso no hay a quién reclamar—; del
   * **lesionado**, quién es (la posición ya viene elegida). Lo demás (marca,
   * modelo, teléfono, aseguradora, póliza, daños, email, matrícula) puede no
   * saberse en el momento y no bloquea el parte.
   */
  function errorImplicados(): { mensaje: string; lista: Lista; indice: number } | null {
    const tercero = thirdParties.findIndex((row) => !row.full_name.trim() || !row.plate.trim())
    if (tercero >= 0) {
      return { mensaje: t.errRow(t.thirdCard(tercero + 1)), lista: 'third', indice: tercero }
    }
    const lesionado = injuredPeople.findIndex((row) => !row.full_name.trim())
    if (lesionado >= 0) {
      return { mensaje: t.errRow(t.injuredCard(lesionado + 1)), lista: 'injured', indice: lesionado }
    }
    return null
  }

  /** Deja a la vista la ficha que falla (su lista, abierta) y devuelve el
   * aviso, o '' si no falla nada. */
  function llevarAlFallo(fallo: ReturnType<typeof errorImplicados>): string {
    if (!fallo) return ''
    setLista(fallo.lista)
    if (fallo.lista === 'third') setAbiertoTercero(fallo.indice)
    else setAbiertoLesionado(fallo.indice)
    return fallo.mensaje
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    // Los implicados se rellenan en otro paso: si falta algo, se vuelve a él.
    const aviso = llevarAlFallo(errorImplicados())
    if (aviso) {
      setError(aviso)
      setPaso('people')
      return
    }
    setError('')
    setSaving(true)
    try {
      // 1) La petición de accidente con su parte guiado (contrato de la PWA:
      // el back lo valida y lo materializa en las tablas del parte).
      const incident = await createIncident({
        vehicle: vehicle.id,
        type: 'accident',
        priority,
        date: form.occurredAt ? form.occurredAt.slice(0, 10) : todayIso(),
        description: form.damages.trim(),
        workshop_postal_code: form.workshopCp,
        details: {
          report_version: 1,
          street: form.street,
          street_number: form.streetNumber,
          postal_code: form.postalCode,
          locality: form.locality,
          province: form.province,
          occurred_at: form.occurredAt,
          phone: form.phone,
          damage_description: form.damages.trim(),
          police_report_reference: form.policeRef,
          third_parties: thirdParties,
          injured_people: injuredPeople,
        },
      })
      const parts: string[] = [t.created]
      // 2) El estado del vehículo (opt-out con la casilla).
      if (markState && !vehicleAlreadyAccident) {
        await updateVehicleFields(vehicle.id, {
          state: 'accidente',
          change_reason: form.damages.trim(),
          expected_updated_at: vehicle.updated_at,
        })
        parts.push(t.stateChanged)
      }
      // 3) El archivo del parte, ligado a la petición (best-effort: el parte
      // ya está comunicado; un fallo de subida no lo tumba).
      if (reportFile) {
        try {
          await uploadDocument(
            { vehicle: vehicle.id, incident: incident.id, type: 'accident_report' },
            reportFile,
          )
        } catch {
          parts.push(t.fileFailed(reportFile.name))
        }
      }
      onDone()
      setInfo(parts.join(' '))
    } catch (err) {
      setError(asErrorMessage(err, t.errGeneric))
    } finally {
      setSaving(false)
    }
  }

  // Comunicado el parte, no se vuelve al formulario: lo abierto se repasa en
  // «Gestionar accidentes».
  if (info) {
    return (
      <div className="ops-modal">
        <div className="ops-success" role="status">{info}</div>
        <p className="muted ops-note">{t.doneNote}</p>
        <div className="ops-actions">
          <div className="ops-actions-end">
            <Button type="button" variant="primary" onClick={onClose}>{copy.ops.close}</Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="ops-modal">
      <form ref={formRef} className="ops-form" onSubmit={submit} onInvalidCapture={alInvalido}>
        <OpsSteps
          pasos={pasos}
          activo={pasoActivo}
          label={t.stepsLabel}
          bloqueado={copy.ops.stepLocked}
        />

        {/* 1 · Dónde y cuándo pasó, y a quién llamar. */}
        <OpsSection tone="where" hidden={pasoActivo !== 'where'}>
          <p className="muted ops-note">{t.dataSection}</p>
          <TextInputField
            label={t.street}
            aria-label={t.street}
            value={form.street}
            onChange={(e) => setField('street', e.target.value)}
            required
            requiredVisual
          />
          <div className="ops-grid">
            <TextInputField
              label={t.streetNumber}
              aria-label={t.streetNumber}
              value={form.streetNumber}
              onChange={(e) => setField('streetNumber', e.target.value)}
            />
            <TextInputField
              label={t.postalCode}
              aria-label={t.postalCode}
              inputMode="numeric"
              pattern="[0-9]{5}"
              maxLength={5}
              value={form.postalCode}
              onChange={(e) => setField('postalCode', e.target.value)}
              required
              requiredVisual
            />
          </div>
          <div className="ops-grid">
            <TextInputField
              label={t.locality}
              aria-label={t.locality}
              value={form.locality}
              onChange={(e) => setField('locality', e.target.value)}
              required
              requiredVisual
            />
            <TextInputField
              label={t.province}
              aria-label={t.province}
              value={form.province}
              onChange={(e) => setField('province', e.target.value)}
              required
              requiredVisual
            />
          </div>
          <div className="ops-grid">
            <TextInputField
              label={t.occurredAt}
              aria-label={t.occurredAt}
              type="datetime-local"
              max={nowLocalDateTime()}
              value={form.occurredAt}
              onChange={(e) => setField('occurredAt', e.target.value)}
              required
              requiredVisual
            />
            <TextInputField
              label={t.phone}
              aria-label={t.phone}
              type="tel"
              value={form.phone}
              onChange={(e) => setField('phone', e.target.value)}
              required
              requiredVisual
            />
          </div>
        </OpsSection>

        {/* 2 · Qué se ha roto, dónde se repara y con cuánta prisa. */}
        <OpsSection tone="damage" hidden={pasoActivo !== 'damage'}>
          <span className="ops-label-row">
            <label className="ops-field-label" htmlFor="accident-damages">{t.damages}</label>
            <span className="ops-required-badge">{requiredBadge}</span>
          </span>
          <textarea
            id="accident-damages"
            className="ops-textarea"
            rows={4}
            value={form.damages}
            onChange={(e) => setField('damages', e.target.value)}
            required
          />
          <div className="ops-grid">
            <TextInputField
              label={t.workshopCp}
              aria-label={t.workshopCp}
              inputMode="numeric"
              pattern="[0-9]{5}"
              maxLength={5}
              value={form.workshopCp}
              onChange={(e) => setField('workshopCp', e.target.value)}
            />
            {/* Prioridad de la petición que abre el parte. */}
            <SelectField
              label={copy.priority.label}
              aria-label={copy.priority.label}
              options={priorityChoices}
              value={priority}
              onValueChange={setPriority}
              required
            />
          </div>
        </OpsSection>

        {/* 3 · Terceros y lesionados, cada lista en su sub-pestaña y cada
            ficha en un acordeón: solo una abierta a la vez. */}
        <OpsSection tone="people" hidden={pasoActivo !== 'people'}>
          <p className="muted ops-note">{t.peopleNote}</p>
          <div className="pending-subtabs" role="tablist" aria-label={t.stepPeople}>
            {(
              [
                ['third', t.thirdParties, thirdParties.length],
                ['injured', t.injured, injuredPeople.length],
              ] as const
            ).map(([key, label, cuantos]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={lista === key}
                className={`pending-subtab${lista === key ? ' is-active' : ''}`}
                onClick={() => setLista(key)}
              >
                {label}
                {cuantos > 0 && <span className="ops-tab-count">{cuantos}</span>}
              </button>
            ))}
          </div>

          {/* Terceros implicados. */}
          <div className="acc-repeat-list" hidden={lista !== 'third'}>
            <div className="acc-repeat-head">
              <span className="muted ops-note">{t.thirdRequiredHint}</span>
              <Button type="button" size="sm" variant="secondary" onClick={anadirTercero}>
                <Plus size={15} aria-hidden /> {t.add}
              </Button>
            </div>
            {thirdParties.length === 0 && <p className="muted">{t.emptyThird}</p>}
            {thirdParties.map((row, index) => (
              <FichaImplicado
                key={`third-${index}`}
                titulo={t.thirdCard(index + 1)}
                resumen={row.full_name.trim() || t.cardEmpty}
                abierta={abiertoTercero === index}
                onAbrir={() => setAbiertoTercero(abiertoTercero === index ? null : index)}
                onQuitar={() => quitarTercero(index)}
                quitarLabel={t.removeThirdParty}
              >
                <div className="ops-grid">
                  <TextInputField label={t.tpFullName} aria-label={t.tpFullName} value={row.full_name} onChange={(e) => updateThirdParty(index, { full_name: e.target.value })} requiredVisual />
                  <TextInputField label={t.tpPlate} aria-label={t.tpPlate} value={row.plate} onChange={(e) => updateThirdParty(index, { plate: e.target.value })} requiredVisual />
                  <TextInputField label={t.tpBrand} aria-label={t.tpBrand} value={row.brand} onChange={(e) => updateThirdParty(index, { brand: e.target.value })} />
                  <TextInputField label={t.tpModel} aria-label={t.tpModel} value={row.model} onChange={(e) => updateThirdParty(index, { model: e.target.value })} />
                  <TextInputField label={t.tpPhone} aria-label={t.tpPhone} type="tel" value={row.phone} onChange={(e) => updateThirdParty(index, { phone: e.target.value })} />
                  <TextInputField label={t.tpInsurer} aria-label={t.tpInsurer} value={row.insurer} onChange={(e) => updateThirdParty(index, { insurer: e.target.value })} />
                  <TextInputField label={t.tpPolicy} aria-label={t.tpPolicy} value={row.policy_number} onChange={(e) => updateThirdParty(index, { policy_number: e.target.value })} />
                </div>
                <label className="ops-field-label" htmlFor={`accident-tp-damages-${index}`}>{t.tpDamages}</label>
                <textarea
                  id={`accident-tp-damages-${index}`}
                  className="ops-textarea"
                  rows={2}
                  value={row.damage_description}
                  onChange={(e) => updateThirdParty(index, { damage_description: e.target.value })}
                />
              </FichaImplicado>
            ))}
          </div>

          {/* Lesionados. */}
          <div className="acc-repeat-list" hidden={lista !== 'injured'}>
            <div className="acc-repeat-head">
              <span className="muted ops-note">{t.injuredRequiredHint}</span>
              <Button type="button" size="sm" variant="secondary" onClick={anadirLesionado}>
                <Plus size={15} aria-hidden /> {t.add}
              </Button>
            </div>
            {injuredPeople.length === 0 && <p className="muted">{t.emptyInjured}</p>}
            {injuredPeople.map((row, index) => (
              <FichaImplicado
                key={`injured-${index}`}
                titulo={t.injuredCard(index + 1)}
                resumen={row.full_name.trim() || t.cardEmpty}
                abierta={abiertoLesionado === index}
                onAbrir={() => setAbiertoLesionado(abiertoLesionado === index ? null : index)}
                onQuitar={() => quitarLesionado(index)}
                quitarLabel={t.removeInjured}
              >
                <div className="ops-grid">
                  <TextInputField label={t.tpFullName} aria-label={t.tpFullName} value={row.full_name} onChange={(e) => updateInjured(index, { full_name: e.target.value })} requiredVisual />
                  <TextInputField label={t.tpPhone} aria-label={t.tpPhone} type="tel" value={row.phone} onChange={(e) => updateInjured(index, { phone: e.target.value })} />
                  <TextInputField label={t.injEmail} aria-label={t.injEmail} type="email" value={row.email} onChange={(e) => updateInjured(index, { email: e.target.value })} />
                  <TextInputField label={t.injPlate} aria-label={t.injPlate} value={row.plate} onChange={(e) => updateInjured(index, { plate: e.target.value })} />
                  <SelectField
                    label={t.injSeat}
                    aria-label={t.injSeat}
                    required
                    options={[
                      { value: 'driver', label: t.seatDriver },
                      { value: 'passenger', label: t.seatPassenger },
                    ]}
                    value={row.seat}
                    onValueChange={(seat) => updateInjured(index, { seat })}
                  />
                </div>
              </FichaImplicado>
            ))}
          </div>
        </OpsSection>

        {/* 4 · El atestado, el archivo del parte y qué pasa con el coche. */}
        <OpsSection tone="report" hidden={pasoActivo !== 'report'}>
          <TextInputField
            label={t.policeRef}
            aria-label={t.policeRef}
            value={form.policeRef}
            onChange={(e) => setField('policeRef', e.target.value)}
          />
          <FileField
            label={t.file}
            accept=".jpg,.jpeg,.png,.webp,.pdf"
            value={reportFile}
            onFiles={(files) => setReportFile(files[0] ?? null)}
          />
          {!vehicleAlreadyAccident && (
            <label className="baja-toggle">
              <input
                type="checkbox"
                checked={markState}
                onChange={(e) => setMarkState(e.target.checked)}
              />
              {t.markState}
            </label>
          )}
        </OpsSection>

        {error && <div role="alert" className="form-error">{error}</div>}

        {/* Pie fijo: el ÚNICO modo de moverse por el parte. «Enviar reporte»
            aparece —entrando desde la derecha— en el último paso. */}
        <div className="ops-actions">
          <Button type="button" variant="secondary" onClick={onClose}>{copy.ops.cancel}</Button>
          <div className="ops-actions-end">
            {!pasoSiguiente && (
              <span className="ops-save-in">
                <Button type="submit" variant="primary" disabled={saving}>
                  {saving ? t.sending : t.submit}
                </Button>
              </span>
            )}
            <Button
              type="button"
              variant="secondary"
              disabled={!pasoPrevio}
              onClick={() => pasoPrevio && setPaso(pasoPrevio.key)}
            >
              {copy.ops.back}
            </Button>
            <Button type="button" variant="secondary" disabled={!pasoSiguiente} onClick={avanzar}>
              {copy.ops.next}
            </Button>
          </div>
        </div>
      </form>
    </div>
  )
}
