import { Gauge } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge, Button } from '@flota/ui/ui'

import { alertLevelTone, fmtDate, todayIso } from '../format.ts'
import { useLang } from '../i18n.tsx'
import type { Alert } from '../types.ts'

export function AlertCard({
  alert,
  isSupervisor,
  onClose,
  onRegisterKm,
  showPlate = true,
  showType = true,
}: {
  alert: Alert
  isSupervisor: boolean
  onClose: (alert: Alert) => void
  /** En la ficha, registrar km se resuelve sin abandonar la página. */
  onRegisterKm?: () => void
  /** Dentro del acordeón de su coche la matrícula ya la dice la cabecera. */
  showPlate?: boolean
  /** Dentro de la sección de su tipo, el tipo ya lo dice el título. */
  showType?: boolean
}) {
  const { t } = useLang()
  const isOpen = alert.status === 'open'
  // Vencimiento ya pasado: la fecha se resalta (el rojo dice "esto ya tocaba").
  const overdue = Boolean(alert.due_date && alert.due_date < todayIso())
  // Sin tarjeta propia: la abierta vive dentro del acordeón de su coche y la
  // cerrada la envuelve su sección en `.card`. La franja izquierda lleva el
  // color del nivel: se distingue la crítica del aviso de un vistazo.
  return (
    <div className={`alert-card level-${alert.level}${isOpen ? '' : ' alert-closed'}`}>
      <div className="alert-card-head">
        {showType && <span className="alert-type">{alert.type_display}</span>}
        <Badge tone={alertLevelTone(alert.level)} size="sm">
          {alert.level_display}
        </Badge>
        {!isOpen && (
          <Badge tone="success" size="sm">
            {alert.status_display}
          </Badge>
        )}
      </div>
      <p className="alert-message">
        {showPlate && alert.vehicle && (
          <Link to={`/vehiculos/${alert.vehicle}`} className="plate alert-plate">
            {alert.vehicle_plate}
          </Link>
        )}{' '}
        {alert.message}
      </p>
      <div className="alert-foot">
        <span className="alert-meta">
          {alert.due_date && (
            <span className={overdue ? 'alert-due-over' : ''}>
              {t.alerts.due(fmtDate(alert.due_date))}
            </span>
          )}
          {alert.due_date ? ' · ' : ''}
          {t.alerts.created(fmtDate(alert.created_at))}
        </span>
        {isOpen && (
          <span className="alert-actions-inline">
            {!isSupervisor && alert.vehicle && alert.type === 'km_reading_pending' && (
              onRegisterKm ? (
                <button type="button" className="link-btn" onClick={onRegisterKm}>
                  <Gauge size={16} aria-hidden /> {t.common.registerKm}
                </button>
              ) : (
                <Link to={`/registrar?vehiculo=${alert.vehicle}`} className="link-btn">
                  <Gauge size={16} aria-hidden /> {t.common.registerKm}
                </Link>
              )
            )}
            {isSupervisor && (
              <Button size="sm" variant="secondary" onClick={() => onClose(alert)}>
                {t.alerts.resolve}
              </Button>
            )}
          </span>
        )}
      </div>
    </div>
  )
}
