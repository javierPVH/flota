import { useState, type FormEvent } from 'react'
import { CalendarClock, CalendarOff, Camera } from 'lucide-react'
import { Button, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { registerItv, uploadDocument } from '../api.ts'
import { daysUntil, fmtDate, itvClass, todayIso } from '../format.ts'
import { useLang } from '../i18n.tsx'
import { itvNotDueYet } from '../itvSchedule.ts'
import { compressImage } from '../offline/images.ts'
import { enqueueItvWithReport, isNetworkError, newClientRef, safeEnqueue } from '../offline/queue.ts'
import type { Vehicle } from '../types.ts'
import { SupervisorModal } from './SupervisorModal.tsx'

/** Registro de ITV compartido por la ficha y la resolución de alertas.
 *
 * `nextItvDate` es la cita que se está atendiendo: la del resumen si quien
 * abre el modal lo tiene (más fresco), y si no la del vehículo.
 *
 * El formulario cuenta la inspección en el orden en que se cuenta de palabra:
 * cuándo fue, cómo salió y el informe que la acompaña.
 *
 * Lo que **no** pregunta es la fecha de la PRÓXIMA ITV: esa cita la programa
 * la gestión, y el campo registra lo que ha pasado, no lo que vendrá. Por eso
 * el registro viaja siempre con `next_due: null` y aquí ya no hace falta el
 * espejo de R3-32 (la próxima, posterior a la inspección): sin campo no hay
 * fecha que validar. */
export function ItvPane({
  vehicle,
  nextItvDate,
  onSaved,
  onCancel,
}: {
  vehicle: Vehicle
  nextItvDate?: string | null
  /** Registrada. El mensaje lo compone el propio formulario (dice si el
   * informe subió, se encoló o falló). */
  onSaved?: (message: string) => void
  onCancel?: () => void
}) {
  const { t, language } = useLang()
  // La fecha de la inspección nace VACÍA: es el dato del informe y hay que
  // mirarlo. Con «hoy» puesto de salida, registrar una ITV pasada el viernes
  // anterior se guardaba con la fecha de hoy sin que nadie lo notara.
  const [form, setForm] = useState({ event_date: '', result: 'done' })
  // El informe que entrega la estación (papel fotografiado o PDF). Opcional:
  // en campo no siempre se tiene a mano, y el registro no puede depender de él.
  const [report, setReport] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // R5-50: una referencia por captura, no por pulsación (el reintento manual
  // tras un 502 no debe crear un segundo documento).
  const [reportRef] = useState(newClientRef)
  // Y la del propio registro: generada en `submit()` cambiaba en cada pulsacion,
  // asi que el reintento manual tras un 502 podia crear DOS eventos de ITV.
  const [itvRef] = useState(newClientRef)

  async function submit(event: FormEvent) {
    event.preventDefault()
    // Espejo del `required` del campo: sin fecha no hay ITV que registrar y,
    // sin cobertura, el parte se encolaría para que el back lo tirara con un
    // 400 al reenviarlo (la misma pérdida que evita R3-32 más abajo).
    if (!form.event_date) {
      setError(t.vehicle.itvDateRequired)
      return
    }
    setSaving(true)
    setError('')
    const payload = {
      vehicle: vehicle.id,
      event_date: form.event_date,
      itv: {
        result: form.result,
        // La próxima cita no se pone desde campo: la programa la gestión.
        next_due: null,
      },
      // R3-34: misma referencia en el intento directo y en el reenvío offline.
      client_ref: itvRef,
    }
    try {
      const saved = await registerItv(payload)
      // El informe va DESPUÉS y nunca tumba la ITV ya registrada: cuelga del
      // registro recién creado (`event`), que es de lo que es informe.
      let message = t.vehicle.itvOk
      if (report) {
        const document = {
          vehicle: vehicle.id,
          event: saved.id,
          type: 'itv_report',
          client_ref: reportRef,
        }
        try {
          await uploadDocument(document, report)
        } catch (caught) {
          const queued =
            isNetworkError(caught) &&
            (await safeEnqueue({
              kind: 'document',
              payload: document,
              file: report,
              fileName: report.name,
              fileType: report.type,
            }))
          message = `${message} ${queued ? t.vehicle.itvReportQueued : t.vehicle.itvReportFailed}`
        }
      }
      onSaved?.(message)
    } catch (caught) {
      // Sin cobertura se encolan los dos: el informe espera al id del registro.
      if (isNetworkError(caught) && (await enqueueItvWithReport(payload, report))) {
        onSaved?.(t.vehicle.itvOffline)
      } else {
        setError(asErrorMessage(caught, t.vehicle.itvError))
      }
    } finally {
      setSaving(false)
    }
  }

  // La cita que se atiende. Registrar NO obliga a hacerlo el día señalado: se
  // pasa la ITV antes o después y esta es la que la cumple (al guardarla
  // favorable, el back cierra sus avisos y la cita deja de estar pendiente).
  const nextItv = nextItvDate ?? vehicle.next_itv_date ?? null
  // Un coche recién matriculado no pasa ITV: se dice antes de la cita y se
  // remite a administración, que es quien las programa —aquí no se apaga
  // nada: si hay que registrar una, se registra—.
  const tooYoung = itvNotDueYet(vehicle, todayIso())
  const daysLeft = daysUntil(nextItv)
  const deadlines = t.home.deadlines
  // Qué cambia según el resultado, a la vista de los dos: es lo que está en
  // juego al elegir, y en un desplegable no se leía (había que abrirlo para
  // saber que existía la otra opción, y la consecuencia vivía arriba del todo).
  const results = [
    { value: 'done', label: t.vehicle.itvResultDone, note: t.vehicle.itvResultDoneNote },
    { value: 'not done', label: t.vehicle.itvResultNotDone, note: t.vehicle.itvResultNotDoneNote },
  ]

  return (
    <>
      {tooYoung && (
        <div className="itv-notice itv-notice-early">
          <CalendarOff size={18} aria-hidden />
          <div>
            <strong>{t.vehicle.itvNotDueTitle}</strong>
            <span>
              {t.vehicle.itvNotDueNote(
                t.vehicle.itvEveryYears(tooYoung.years),
                fmtDate(tooYoung.dueOn, language),
              )}
            </span>
          </div>
        </div>
      )}
      <div className="itv-notice">
        <CalendarClock size={18} aria-hidden />
        <div>
          {nextItv ? (
            <>
              <strong className={itvClass(nextItv)}>
                {t.home.nextItv} {fmtDate(nextItv, language)}
                {daysLeft !== null &&
                  ` · ${daysLeft < 0 ? deadlines.overdue(-daysLeft) : deadlines.dueIn(daysLeft)}`}
              </strong>
              <span>{t.vehicle.itvAnyDate}</span>
            </>
          ) : (
            <span>{t.vehicle.itvNoDate}</span>
          )}
        </div>
      </div>
      <form className="modal-form itv-form" onSubmit={submit}>
        {/* El campo con su atajo al lado: teclear la fecha en el móvil cuesta,
            y lo más común es registrarla el mismo día. */}
        <div className="field-action">
          <TextInputField
            label={t.vehicle.itvDate}
            aria-label={t.vehicle.itvDate}
            type="date"
            max={todayIso()}
            value={form.event_date}
            onChange={(event) => setForm((current) => ({ ...current, event_date: event.target.value }))}
            required
            requiredVisual
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => setForm((current) => ({ ...current, event_date: todayIso() }))}
          >
            {t.vehicle.itvToday}
          </Button>
        </div>
        <fieldset className="choice-group">
          <legend>{t.vehicle.itvResult}</legend>
          {results.map((option) => (
            <label
              key={option.value}
              className={`choice-card${form.result === option.value ? ' is-active' : ''}`}
            >
              <input
                type="radio"
                name="itv-result"
                value={option.value}
                checked={form.result === option.value}
                onChange={() => setForm((current) => ({ ...current, result: option.value }))}
              />
              <span>
                <strong>{option.label}</strong>
                <small>{option.note}</small>
              </span>
            </label>
          ))}
        </fieldset>
        {/* El informe de la estación, con la misma caja de adjuntar que el
            resto de la app (cámara, galería o PDF). Queda colgado de esta ITV
            en Documentos del vehículo. */}
        <label className={`photo-attach${report ? ' has-file' : ''}`}>
          <Camera size={18} aria-hidden />
          <span className="attach-text">
            <strong>{report ? report.name : t.vehicle.itvReport}</strong>
            <small>{report ? t.vehicle.itvReportChange : t.vehicle.itvReportHint}</small>
          </span>
          <input
            type="file"
            aria-label={t.vehicle.itvReport}
            accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
            onChange={async (event) => {
              const picked = event.target.files?.[0]
              setReport(picked ? await compressImage(picked) : null)
            }}
          />
        </label>
        {error && <div role="alert" className="form-error">{error}</div>}
        <div className="form-actions">
          {onCancel && (
            <Button type="button" variant="secondary" onClick={onCancel}>{t.common.cancel}</Button>
          )}
          <Button type="submit" disabled={saving}>{saving ? t.vehicle.itvSubmitting : t.vehicle.itvSubmit}</Button>
        </div>
      </form>
    </>
  )
}

/** El mismo registro, en su propia ventana (ficha, tarjeta y alerta de ITV). */
export function RegisterItvModal({
  vehicle,
  nextItvDate,
  onClose,
  onSaved,
}: {
  vehicle: Vehicle
  nextItvDate?: string | null
  onClose: () => void
  onSaved?: (message: string) => void
}) {
  const { t } = useLang()
  return (
    <SupervisorModal open title={t.vehicle.itvTitle(vehicle.plate)} onClose={onClose}>
      <ItvPane
        vehicle={vehicle}
        nextItvDate={nextItvDate}
        onCancel={onClose}
        onSaved={(message) => {
          onSaved?.(message)
          onClose()
        }}
      />
    </SupervisorModal>
  )
}
