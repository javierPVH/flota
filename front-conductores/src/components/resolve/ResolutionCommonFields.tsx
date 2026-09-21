import { Camera } from 'lucide-react'

import { fmtKm, todayIso } from '../../format.ts'
import { useLang } from '../../i18n.tsx'
import { compressImage } from '../../offline/images.ts'
import { useResolveCopy } from '../../translations/resolve.ts'
import type { ResolutionCommon } from './useResolutionCommon.ts'

/** Los campos comunes de un cierre, uno por uno: quién los pinta decide cuáles. */
type FieldKey = 'date' | 'km' | 'cost' | 'postalCode' | 'observations' | 'proof'

/** Los campos comunes de un cierre de campo, en el orden en que se rellenan.
 *
 * Una columna: se rellenan con el móvil en la mano, muchas veces en el taller
 * o en el arcén. Lo obligatorio es solo la fecha; lo demás se sabe o no se
 * sabe, y un formulario que exija el coste para poder cerrar una avería acaba
 * cerrándose con un cero.
 *
 * Con `show` se pinta solo una parte: la **petición general** los reparte en
 * dos tramos (fecha y observaciones arriba; lo del taller, tras su casilla). */
export function ResolutionCommonFields({
  common,
  show = {},
  minDate,
}: {
  common: ResolutionCommon
  /** Qué campos pinta esta llamada (todos por defecto). */
  show?: Partial<Record<FieldKey, boolean>>
  /** La fecha de la petición: no se arregla algo antes de que pase. */
  minDate?: string | null
}) {
  const { t, language } = useLang()
  const c = useResolveCopy().common
  const { values, set, downtime, vehicleKm } = common
  const visible = (key: FieldKey) => show[key] !== false

  return (
    <>
      {visible('date') && (
        <>
          <label className="reminder-check">
            {c.date} <span className="req-badge" aria-hidden>{t.common.required}</span>
            <input
              type="date"
              className="update-input"
              min={minDate ?? undefined}
              max={todayIso()}
              value={values.date}
              onChange={(event) => set({ date: event.target.value })}
              required
            />
          </label>
          {downtime !== null && <div className="update-km-last">{c.downtime(downtime)}</div>}
        </>
      )}

      {(visible('km') || visible('cost')) && (
        <div className="resolve-grid">
          {visible('km') && (
            <label className="reminder-check">
              {c.km}
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                className="update-input"
                value={values.km}
                onChange={(event) => set({ km: event.target.value.replace(/\D/g, '') })}
              />
            </label>
          )}
          {visible('cost') && (
            <label className="reminder-check">
              {c.cost}
              <input
                type="text"
                inputMode="decimal"
                className="update-input"
                value={values.cost}
                onChange={(event) => set({ cost: event.target.value.replace(/[^\d.,]/g, '') })}
              />
            </label>
          )}
        </div>
      )}
      {/* En el taller el coche no rueda: casi siempre sale con los mismos km con
          los que entró. Tecleados en un móvil se equivocan, así que se cargan
          de un toque y la nota dice por qué esa lectura vale. */}
      {visible('km') && vehicleKm !== null && (
        <div className="resolve-km-load">
          <button
            type="button"
            className="resolve-km-btn"
            onClick={() => set({ km: String(vehicleKm) })}
          >
            {c.loadKm(fmtKm(vehicleKm, language))}
          </button>
          <span className="update-hint">{c.loadKmHint}</span>
        </div>
      )}
      {visible('km') && <p className="update-hint">{c.kmHint}</p>}

      {visible('postalCode') && (
        <label className="reminder-check">
          {c.postalCode}
          <input
            type="text"
            inputMode="numeric"
            className="update-input"
            value={values.postalCode}
            onChange={(event) => set({ postalCode: event.target.value })}
          />
        </label>
      )}

      {visible('observations') && (
        <label className="reminder-check">
          {c.observations}
          <textarea
            className="reminder-message"
            value={values.observations}
            onChange={(event) => set({ observations: event.target.value })}
          />
        </label>
      )}

      {/* La factura se fotografía en el taller: la misma caja de adjuntar que
          el resto de la app, y se sube DESPUÉS del cierre. */}
      {visible('proof') && (
        <label className={`photo-attach${values.proof ? ' has-file' : ''}`}>
          <Camera size={18} aria-hidden />
          <span className="attach-text">
            <strong>{values.proof ? values.proof.name : c.proof}</strong>
            <small>{values.proof ? c.proofChange : c.proofHint}</small>
          </span>
          <input
            type="file"
            aria-label={c.proof}
            accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
            onChange={async (event) => {
              const picked = event.target.files?.[0]
              set({ proof: picked ? await compressImage(picked) : null })
            }}
          />
        </label>
      )}
    </>
  )
}
