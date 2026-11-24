import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { CheckCircle2, Info, PencilLine } from 'lucide-react'
import { Badge, Button, Modal, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import {
  latestReading,
  requestReadingChange,
  type LatestReading,
  type ReadingChangeKind,
  type ReadingChanges,
} from '../api.ts'
import { fmtConsumption, fmtDate, fmtKm, groupThousands, todayIso } from '../format.ts'
import { useLang } from '../i18n.tsx'
import { useReadingChangeCopy } from '../translations/readingChange.ts'

/** Coma o punto: el teclado numérico del móvil da lo que da. */
const decimal = (value: string) => value.replace(',', '.').trim()

/**
 * **Corregir la última lectura** (km) o **la última anotación** (consumo).
 *
 * Para quien conduce esas anotaciones no se editan (SEC4), así que el botón no
 * guarda: abre una petición que administración aprueba o deniega en
 * `/solicitudes`. Vive dentro de los dos formularios de campo (`KmPane`,
 * `FuelPane`) y hace dos cosas:
 *
 * - mientras hay una corrección viva enseña **las dos cifras**, la original y
 *   la pendiente de cambio, y no deja pedir otra;
 * - si no la hay, ofrece el botón, que abre el formulario cargado con lo que la
 *   anotación dice hoy. Viaja solo lo que cambia.
 *
 * Pide la última anotación por su cuenta (el resumen del coche no trae su id
 * ni su corrección) y, si esa carga falla o no hay ninguna, no pinta nada: el
 * formulario de registrar sigue sirviendo igual.
 */
export function ReadingCorrection({
  kind,
  vehicleId,
  refreshKey = 0,
}: {
  kind: ReadingChangeKind
  vehicleId: number
  /** Cambia cuando el formulario guarda una anotación: la última es otra. */
  refreshKey?: number
}) {
  const { language } = useLang()
  const copy = useReadingChangeCopy()
  const [reading, setReading] = useState<LatestReading | null>(null)
  const [open, setOpen] = useState(false)

  const load = useCallback(() => {
    let vivo = true
    latestReading(kind, vehicleId)
      .then((fila) => vivo && setReading(fila))
      .catch(() => vivo && setReading(null))
    return () => {
      vivo = false
    }
  }, [kind, vehicleId])

  useEffect(load, [load, refreshKey])

  if (!reading) return null

  const cifra = (valor: number | string | null | undefined) =>
    kind === 'km' ? fmtKm(valor as number | null, language) : fmtConsumption(valor, language)
  const original = kind === 'km' ? reading.km_reading : reading.avg_consumption
  const pendiente = reading.pending_change
  const propuesta = pendiente
    ? kind === 'km'
      ? (pendiente.changes.km_reading ?? reading.km_reading)
      : (pendiente.changes.avg_consumption ?? reading.avg_consumption)
    : null
  const fechaPropuesta = pendiente?.changes.reading_date ?? reading.reading_date

  return (
    <div className="reading-correction">
      {pendiente ? (
        <div className="reading-correction-pair" role="status">
          <Badge tone="warning">{copy.pendingBadge}</Badge>
          <dl>
            <div>
              <dt>{copy.original}</dt>
              <dd>
                <strong>{cifra(original)}</strong> · {fmtDate(reading.reading_date, language)}
              </dd>
            </div>
            <div className="is-pending">
              <dt>{copy.pending}</dt>
              <dd>
                <strong>{cifra(propuesta)}</strong> · {fmtDate(fechaPropuesta, language)}
              </dd>
            </div>
          </dl>
          <p className="doc-sub">{copy.pendingNote}</p>
        </div>
      ) : (
        <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
          <PencilLine size={16} aria-hidden /> {kind === 'km' ? copy.button : copy.buttonFuel}
        </Button>
      )}
      {open && (
        <ReadingCorrectionModal
          kind={kind}
          reading={reading}
          onClose={() => setOpen(false)}
          onSent={load}
        />
      )}
    </div>
  )
}

/** El formulario de la petición: fecha, cifra y el porqué. Se PIDE, no se guarda. */
export function ReadingCorrectionModal({
  kind,
  reading,
  onClose,
  onSent,
}: {
  kind: ReadingChangeKind
  reading: LatestReading
  onClose: () => void
  /** Pedida: quien la abrió vuelve a leer la anotación (ya trae las dos cifras). */
  onSent: () => void
}) {
  const copy = useReadingChangeCopy()
  const { language: lang } = useLang()
  const valorActual =
    kind === 'km'
      ? reading.km_reading == null
        ? ''
        : String(reading.km_reading)
      : (reading.avg_consumption ?? '')
  const [date, setDate] = useState(reading.reading_date ?? '')
  const [value, setValue] = useState(valorActual)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  /** Solo lo que difiere de la anotación: pedir lo que ya hay no es pedir. */
  function cambios(): ReadingChanges {
    const salida: ReadingChanges = {}
    if (date && date !== (reading.reading_date ?? '')) salida.reading_date = date
    const limpio = kind === 'km' ? value.trim() : decimal(value)
    if (limpio !== '' && Number(limpio) !== Number(valorActual === '' ? NaN : valorActual)) {
      if (kind === 'km') salida.km_reading = Number(limpio)
      else salida.avg_consumption = limpio
    }
    return salida
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    // El modal va en un portal, pero los eventos de React suben por el árbol
    // de componentes: sin esto, este envío llegaría al formulario de registrar
    // que lo contiene y guardaría una lectura nueva.
    event.stopPropagation()
    const pedido = cambios()
    if (Object.keys(pedido).length === 0) {
      setError(copy.nothing)
      return
    }
    setSaving(true)
    setError('')
    try {
      await requestReadingChange({ kind, reading: reading.id, changes: pedido, note: note.trim() })
      setDone(true)
      onSent()
    } catch (caught) {
      setError(
        asErrorMessage(caught, copy.error).replace(
          /^(km_reading|avg_consumption|reading_date|changes|detail):\s*/,
          '',
        ),
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open title={kind === 'km' ? copy.title : copy.titleFuel} onClose={onClose}>
      {done ? (
        <div className="km-saved" role="status">
          <CheckCircle2 size={22} aria-hidden />
          <p>{copy.ok}</p>
          <Button type="button" variant="primary" onClick={onClose}>
            {copy.close}
          </Button>
        </div>
      ) : (
        <form className="modal-form" onSubmit={submit}>
          {/* Lo primero que hay que entender: desde aquí se PIDE, no se guarda. */}
          <p className="muted ops-note incident-change-hint">
            <Info size={15} aria-hidden /> {copy.hint}
          </p>
          {/* La anotación ANTERIOR a la que se corrige (la penúltima): la que
              se corrige ya está en las cajas, y la referencia para saber si
              la cifra nueva cuadra es la que había antes. */}
          <div className="reading-correction-pair reading-correction-current">
            {reading.previous ? (
              <dl>
                <div>
                  <dt>{kind === 'km' ? copy.previous : copy.previousFuel}</dt>
                  <dd>
                    <strong>
                      {kind === 'km'
                        ? fmtKm(reading.previous.km_reading, lang)
                        : fmtConsumption(reading.previous.avg_consumption, lang)}
                    </strong>{' '}
                    · {fmtDate(reading.previous.reading_date, lang)}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="doc-sub">{kind === 'km' ? copy.noPrevious : copy.noPreviousFuel}</p>
            )}
          </div>
          <TextInputField
            label={copy.date}
            aria-label={copy.date}
            type="date"
            max={todayIso()}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
          <TextInputField
            label={kind === 'km' ? copy.odometer : copy.consumption}
            aria-label={kind === 'km' ? copy.odometer : copy.consumption}
            inputMode={kind === 'km' ? 'numeric' : 'decimal'}
            value={kind === 'km' ? groupThousands(value, lang) : value}
            onChange={(e) =>
              setValue(
                kind === 'km'
                  ? e.target.value.replace(/\D/g, '')
                  : e.target.value.replace(/[^0-9.,]/g, ''),
              )
            }
            required
          />
          <TextInputField
            label={copy.note}
            aria-label={copy.note}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {error && (
            <div role="alert" className="form-error">
              {error}
            </div>
          )}
          <div className="ops-actions">
            <Button type="button" variant="secondary" onClick={onClose}>
              {copy.cancel}
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? copy.sending : copy.submit}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
