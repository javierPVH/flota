import { CalendarClock } from 'lucide-react'
import { Button, Modal } from '@flota/ui/ui'

import { daysUntil, fmtDate, scheduledActionOpensOn } from '../format.ts'
import { useLang } from '../i18n.tsx'

/** Las dos actuaciones que se CITAN y por eso tienen ventana: la ITV y el
 * mantenimiento programado. */
export type ScheduledKind = 'itv' | 'maintenance'

/**
 * **Por qué ese botón todavía no hace nada.** La ITV y el mantenimiento solo se
 * registran desde 30 días antes de la cita (`scheduledActionAvailable`); hasta
 * entonces el botón se ofrecía **apagado** con un `title`, y en un móvil un
 * `title` no se lee nunca: quedaba un botón muerto sin explicación.
 *
 * Ahora se puede pulsar y lo que abre es esto: **cuándo es la cita**, cuánto
 * falta y **desde qué día** se podrá registrar — una fecha, no «cuando falten
 * 30 días», que obliga a echar la cuenta a mano. Sin cita programada dice eso
 * mismo y de quién depende, que es la otra mitad de la pregunta.
 */
export function ScheduledActionInfo({
  kind,
  date,
  plate,
  onClose,
}: {
  kind: ScheduledKind
  /** La cita del coche, si la tiene. */
  date: string | null | undefined
  plate: string
  onClose: () => void
}) {
  const { t, language } = useLang()
  const copy = t.vehicle.scheduledInfo
  const faltan = daysUntil(date)
  const desde = scheduledActionOpensOn(date)

  return (
    <Modal
      open
      title={`${copy.title[kind]} · ${plate}`}
      onClose={onClose}
      footer={
        <Button type="button" onClick={onClose}>
          {copy.ok}
        </Button>
      }
    >
      <div className="scheduled-info">
        <CalendarClock size={20} aria-hidden />
        <div>
          {date ? (
            <>
              <strong>{copy.due[kind](fmtDate(date, language))}</strong>
              {faltan !== null && <p>{copy.remaining(faltan)}</p>}
              {desde && <p className="scheduled-info-open">{copy.opens[kind](fmtDate(desde, language))}</p>}
              <p className="doc-sub">{copy.why}</p>
            </>
          ) : (
            <>
              <strong>{copy.none[kind]}</strong>
              <p className="doc-sub">{copy.noneHint}</p>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
