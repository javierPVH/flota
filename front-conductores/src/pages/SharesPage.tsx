import { useEffect, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { Badge } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'
import { timeRangeLabel, weekdaysLabel } from '@flota/ui/domain'
import { Car, ChevronRight } from 'lucide-react'

import { listMyShares } from '../api.ts'
import type { LayoutContext } from '../components/Layout.tsx'
import { useDomainLabels } from '../domainLabels.ts'
import { fmtDate, vehicleStateTone } from '../format.ts'
import { useLang } from '../i18n.tsx'
import type { MyShare } from '../types.ts'

/**
 * «Reparto» — los coches que uno tiene REPARTIDOS, cuándo le tocan y con quién.
 *
 * Un conductor lleva UN coche (su asignación vigente), pero puede tener varios
 * en reparto de uso —por horarios, por días de la semana, incluso solapados—,
 * y hasta ahora eso solo se leía en gestión («Conductor y reparto» de la
 * ficha). Aquí se enseñan todos los repartos VIGENTES de quien mira, cada uno
 * con **la misma tarjeta que la flota** (matrícula, estado, modelo y la lista
 * de datos debajo): **qué días y en qué franja** le toca, su parte, el periodo
 * y **con quién lo reparte** —cada persona con sus días y su franja, que es lo
 * que dice cuándo está libre el coche—. El coche propio sale marcado igual que
 * en la flota.
 *
 * **Cada tarjeta abre la ficha del coche**, igual que en «Flota»: un reparto
 * vigente entra en el ámbito de quien lo tiene (`scoping.vehicles_for`), así
 * que desde ahí se lee el coche y se registra sobre él. El reparto lo sigue
 * fijando la gestión (`/vehicle-usages/set/`) y no convierte a nadie en su
 * conductor —el coche tiene su titular, y es a él a quien se le reclama la
 * lectura del mes—, por eso lo repartido no sale en «Mi vehículo» ni en sus
 * avisos. Sin repartos, la pestaña ni sale en el conmutador (`Layout`); si se
 * llega por la URL, se dice.
 */
export function SharesPage() {
  const { t, language } = useLang()
  const copy = t.shares
  const etiqueta = useDomainLabels()
  const ctx = useOutletContext<LayoutContext | null>()
  const dataVersion = ctx?.dataVersion ?? 0
  const [rows, setRows] = useState<MyShare[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    listMyShares()
      .then((data) => {
        if (!alive) return
        setRows(data)
        setError('')
      })
      .catch((caught) => {
        if (alive) setError(asErrorMessage(caught, copy.loadError))
      })
    return () => {
      alive = false
    }
  }, [dataVersion, copy.loadError])

  /** Cuándo, con lo vacío dicho: sin días es cualquier día y sin franja, a
   * cualquier hora —un hueco se leería como que falta el dato—. */
  const dias = (days: number[]) => weekdaysLabel(days, copy.weekdayShort) || copy.everyDay
  const horas = (from: string | null, to: string | null) => timeRangeLabel(from, to) || copy.allDay

  return (
    <div className="field-page">
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {!error && rows === null && (
        <p role="status" className="gate-checking">
          {t.common.loading}
        </p>
      )}
      {rows !== null && rows.length === 0 && <p className="empty-note">{copy.empty}</p>}

      {rows !== null && rows.length > 0 && (
        <ul className="vehicle-cards shares-list">
          {rows.map((row) => (
            <li key={row.id}>
              {/* La tarjeta ENTERA es el enlace a la ficha, igual que en
                  «Flota»: el reparto vigente mete ese coche en el ámbito de
                  quien mira, así que desde aquí se abre y se registra. */}
              <Link to={`/vehiculos/${row.vehicle.id}`} className="card-link">
                <div className={`card share-card${row.is_driver ? ' card-own' : ''}`}>
                  <div className="vehicle-card">
                    <div className="vehicle-card-head">
                      <span className="plate">{row.vehicle.plate}</span>
                      <Badge tone={vehicleStateTone(row.vehicle.state)}>
                        {etiqueta.vehicleState(row.vehicle) || '—'}
                      </Badge>
                      {row.is_driver && (
                        <span className="own-vehicle-mark">
                          <Badge tone="primary" variant="solid" icon={<Car size={13} aria-hidden />}>
                            {copy.ownCar}
                          </Badge>
                        </span>
                      )}
                      <ChevronRight size={18} aria-hidden className="card-chevron" />
                    </div>
                    <p className="vehicle-model">
                      {[row.vehicle.brand, row.vehicle.model].filter(Boolean).join(' ')}
                    </p>
                    <dl className="vehicle-meta">
                      <dt>{copy.days}</dt>
                      <dd>{dias(row.weekdays)}</dd>
                      <dt>{copy.hours}</dt>
                      <dd>{horas(row.time_from, row.time_to)}</dd>
                      <dt>{copy.yourShare}</dt>
                      <dd>{copy.percent(row.usage_percent)}</dd>
                      <dt>{copy.period}</dt>
                      <dd>
                        {row.start_date
                          ? copy.since(fmtDate(row.start_date, language))
                          : copy.sinceAlways}
                        {row.end_date ? ` · ${copy.until(fmtDate(row.end_date, language))}` : ''}
                      </dd>
                      <dt>{copy.sharedWith}</dt>
                      <dd>
                        {row.shared_with.length === 0 ? (
                          <span className="meta-muted">{copy.nobody}</span>
                        ) : (
                          <ul className="share-people">
                            {row.shared_with.map((person) => (
                              <li key={person.id}>
                                <strong>{person.name}</strong>{' '}
                                <span className="doc-sub">
                                  {copy.percent(person.usage_percent)} · {dias(person.weekdays)} ·{' '}
                                  {horas(person.time_from, person.time_to)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </dd>
                    </dl>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
