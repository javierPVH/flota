import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Modal, SelectField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'
import { Trash2 } from 'lucide-react'

import {
  createAssignment,
  createSupervisorPeriod,
  deleteAssignment,
  deleteSupervisorPeriod,
  listAll,
  listAssignments,
  listDrivers,
  listSupervisorPeriods,
  listSupervisors,
  updateAssignment,
  updateSupervisorPeriod,
} from '../api.ts'
import { todayIso } from '../format.ts'
import { usePanelsCopy } from '../translations/panels.ts'
import type { Vehicle } from '../types.ts'
import { useConfirm } from './ConfirmDialog.tsx'

/** Un tramo: quién, desde cuándo y hasta cuándo (fin vacío = en curso). */
interface Periodo {
  id: number
  personaId: number
  nombre: string
  start: string
  end: string
}

type Cara = 'drivers' | 'supervisors'

/** Los dos tramos se pisan. Fin == inicio del siguiente es un relevo, no un
 * solape: es la misma regla que aplica el back. */
function seSolapan(a: { start: string; end: string }, b: { start: string; end: string }): boolean {
  return (!b.end || b.end > a.start) && (!a.end || a.end > b.start)
}

/**
 * Gestión del histórico de personas del vehículo: conductores y supervisores,
 * cada uno con su periodo.
 *
 * Existe porque lo de siempre —«Cambiar conductor»— solo sabe hacer una cosa:
 * relevar HOY. Aquí se corrigen fechas mal puestas y se registran tramos
 * pasados o programados.
 *
 * La regla que lo gobierna es la misma para los dos: **un coche tiene un
 * conductor y un supervisor a la vez**, así que los tramos de una misma cara
 * no pueden solaparse. Se comprueba aquí para poder decir QUIÉN ocupa esas
 * fechas antes de intentar guardar, y la valida también el back (nadie se la
 * salta por API).
 *
 * Las **propuestas** de asignación no salen: no son periodos hasta que se
 * aceptan, y su ciclo vive en la bandeja de la gestión.
 */
export function VehiclePeopleModal({
  vehicle,
  onClose,
  onDone,
}: {
  vehicle: Vehicle
  onClose: () => void
  onDone: () => void
}) {
  const t = usePanelsCopy().assignments.people
  // R3-30/R5-33: la carga lee `t` por ref para que el botón es/en no relance
  // las cuatro peticiones del modal.
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  })
  const confirm = useConfirm()

  const [cara, setCara] = useState<Cara>('drivers')
  // `null` = todavía no ha llegado (así el «Cargando…» es un valor derivado
  // y el efecto no toca estado en su cuerpo).
  const [conductores, setConductores] = useState<Periodo[] | null>(null)
  const [supervisiones, setSupervisiones] = useState<Periodo[] | null>(null)
  const [personasDriver, setPersonasDriver] = useState<Array<{ id: number; name: string }>>([])
  const [personasSup, setPersonasSup] = useState<Array<{ id: number; name: string }>>([])
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [guardando, setGuardando] = useState(false)

  // Edición en curso por fila: solo lo tocado (el resto se queda como está).
  const [edicion, setEdicion] = useState<Record<string, { start: string; end: string }>>({})
  // Alta: persona + rango. Va en su propio modal (registrar un tramo no es
  // lo mismo que corregir las fechas de los que ya están).
  const [altaAbierta, setAltaAbierta] = useState(false)
  const [nuevaPersona, setNuevaPersona] = useState('')
  const [nuevoInicio, setNuevoInicio] = useState(todayIso())
  const [nuevoFin, setNuevoFin] = useState('')
  // El fallo del alta se enseña DENTRO de su modal: el de la tabla queda
  // detrás y no se leería.
  const [errorAlta, setErrorAlta] = useState('')

  const cargar = useCallback(() => {
    void Promise.allSettled([
      listAll(listAssignments({ vehicle: vehicle.id })),
      listAll(listSupervisorPeriods({ vehicle: vehicle.id })),
      listDrivers(),
      listSupervisors(),
    ])
      .then(([asg, sup, dri, sups]) => {
        if (asg.status === 'fulfilled') {
          setConductores(
            asg.value
              // Solo los tramos de verdad: una propuesta o un rechazo no lo son.
              .filter((row) => row.status === 'accepted' || row.status === 'finished')
              .map((row) => ({
                id: row.id,
                personaId: row.driver,
                nombre: row.driver_name,
                start: row.start_date ?? '',
                end: row.end_date ?? '',
              }))
              .sort((a, b) => b.start.localeCompare(a.start)),
          )
        }
        if (sup.status === 'fulfilled') {
          setSupervisiones(
            sup.value.map((row) => ({
              id: row.id,
              personaId: row.supervisor,
              nombre: row.supervisor_name,
              start: row.start_date,
              end: row.end_date ?? '',
            })),
          )
        }
        if (asg.status === 'rejected') setConductores([])
        if (sup.status === 'rejected') setSupervisiones([])
        if (dri.status === 'fulfilled') setPersonasDriver(dri.value)
        if (sups.status === 'fulfilled') setPersonasSup(sups.value)
        setError(
          [asg, sup, dri, sups].some((r) => r.status === 'rejected')
            ? tRef.current.loadError
            : '',
        )
      })
  }, [vehicle.id])

  useEffect(cargar, [cargar])

  const esDriver = cara === 'drivers'
  const cargando = conductores === null || supervisiones === null
  const filas = (esDriver ? conductores : supervisiones) ?? []
  const personas = esDriver ? personasDriver : personasSup

  // Quién lo lleva HOY (lo que hay que saber antes de tocar nada).
  const hoy = todayIso()
  const vigente = filas.find((p) => p.start <= hoy && (!p.end || p.end >= hoy)) ?? null

  /** El tramo que ocupa esas fechas, si lo hay (excluyendo una fila propia). */
  const ocupado = (rango: { start: string; end: string }, exceptoId?: number) =>
    filas.find((p) => p.id !== exceptoId && p.start && seSolapan(rango, p)) ?? null

  const choqueNuevo = useMemo(() => {
    if (!nuevoInicio) return null
    return ocupado({ start: nuevoInicio, end: nuevoFin })
    // `filas` cambia al recargar; el resto son los campos del alta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filas, nuevoInicio, nuevoFin])

  const periodoTexto = (p: Periodo) => (p.end ? t.range(p.start, p.end) : t.rangeOpen(p.start))

  /** Devuelve si ha ido bien; `alErrar` decide dónde se lee el fallo. */
  async function conGuardado(
    accion: () => Promise<unknown>,
    ok: string,
    alErrar: (mensaje: string) => void = setError,
  ): Promise<boolean> {
    setGuardando(true)
    setError('')
    setErrorAlta('')
    setAviso('')
    try {
      await accion()
      setAviso(ok)
      cargar()
      onDone()
      return true
    } catch (err) {
      alErrar(asErrorMessage(err, t.saveError))
      return false
    } finally {
      setGuardando(false)
    }
  }

  function guardarFila(p: Periodo) {
    const cambio = edicion[`${cara}-${p.id}`]
    if (!cambio) return
    const choque = ocupado(cambio, p.id)
    if (choque) {
      setError(t.busy(choque.nombre, periodoTexto(choque)))
      return
    }
    const datos = { start_date: cambio.start, end_date: cambio.end || null }
    void conGuardado(
      () => (esDriver ? updateAssignment(p.id, datos) : updateSupervisorPeriod(p.id, datos)),
      t.savedRow(p.nombre),
    ).then(() =>
      setEdicion((prev) => {
        const siguiente = { ...prev }
        delete siguiente[`${cara}-${p.id}`]
        return siguiente
      }),
    )
  }

  async function retirarFila(p: Periodo) {
    const confirmado = await confirm({
      title: t.removeTitle,
      message: t.removeWarn(p.nombre, periodoTexto(p)),
      confirmLabel: t.remove,
      tone: 'warning',
    })
    if (!confirmado) return
    void conGuardado(
      () => (esDriver ? deleteAssignment(p.id) : deleteSupervisorPeriod(p.id)),
      t.removedRow(p.nombre),
    )
  }

  function abrirAlta() {
    setNuevaPersona('')
    setNuevoInicio(todayIso())
    setNuevoFin('')
    setErrorAlta('')
    setAltaAbierta(true)
  }

  function cerrarAlta() {
    setAltaAbierta(false)
    setErrorAlta('')
  }

  async function anadir() {
    if (!nuevaPersona || !nuevoInicio) {
      setErrorAlta(t.needPerson)
      return
    }
    if (choqueNuevo) {
      setErrorAlta(t.busy(choqueNuevo.nombre, periodoTexto(choqueNuevo)))
      return
    }
    const persona = Number(nuevaPersona)
    const ok = await conGuardado(
      () =>
        esDriver
          ? createAssignment({
              vehicle: vehicle.id,
              driver: persona,
              start_date: nuevoInicio,
              // Nace ACEPTADA: aquí se registra lo que fue o lo que será, no
              // se propone nada a nadie.
              status: 'accepted',
              ...(nuevoFin ? { end_date: nuevoFin } : {}),
            } as Parameters<typeof createAssignment>[0])
          : createSupervisorPeriod({
              vehicle: vehicle.id,
              supervisor: persona,
              start_date: nuevoInicio,
              end_date: nuevoFin || null,
            }),
      t.added,
      setErrorAlta,
    )
    // Si el back lo rechaza, el formulario se queda con lo escrito.
    if (ok) cerrarAlta()
  }

  const pestanas: Array<[Cara, string]> = [
    ['drivers', t.tabDrivers],
    ['supervisors', t.tabSupervisors],
  ]

  return (
    <div className="ops-modal people-modal">
      <div className="ops-tabs" role="tablist" aria-label={t.title}>
        {pestanas.map(([clave, titulo]) => (
          <button
            key={clave}
            type="button"
            role="tab"
            aria-selected={cara === clave}
            className={`ops-tab${cara === clave ? ' is-active' : ''}`}
            onClick={() => {
              setCara(clave)
              setError('')
              setAviso('')
              cerrarAlta()
            }}
          >
            {titulo}
          </button>
        ))}
      </div>

      <div className="ops-info">
        <span>
          {esDriver ? t.currentDriver : t.currentSupervisor}:{' '}
          <strong>{vigente ? vigente.nombre : t.nobody}</strong>
          {vigente && ` · ${periodoTexto(vigente)}`}
        </span>
      </div>

      {cargando ? (
        <p className="loading-state" role="status">
          {t.loading}
        </p>
      ) : (
        <>
          <table className="data people-table">
            <thead>
              <tr>
                <th>{esDriver ? t.driver : t.supervisor}</th>
                <th>{t.start}</th>
                <th>{t.end}</th>
                <th aria-label={t.actions} />
              </tr>
            </thead>
            <tbody>
              {filas.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    {t.empty}
                  </td>
                </tr>
              )}
              {filas.map((p) => {
                const clave = `${cara}-${p.id}`
                const valor = edicion[clave] ?? { start: p.start, end: p.end }
                const tocada = valor.start !== p.start || valor.end !== p.end
                return (
                  <tr key={clave}>
                    <td>{p.nombre}</td>
                    <td>
                      <TextInputField
                        label=""
                        aria-label={t.startOf(p.nombre)}
                        type="date"
                        value={valor.start}
                        onChange={(e) =>
                          setEdicion((prev) => ({
                            ...prev,
                            [clave]: { ...valor, start: e.target.value },
                          }))
                        }
                      />
                    </td>
                    <td>
                      <TextInputField
                        label=""
                        aria-label={t.endOf(p.nombre)}
                        type="date"
                        value={valor.end}
                        onChange={(e) =>
                          setEdicion((prev) => ({
                            ...prev,
                            [clave]: { ...valor, end: e.target.value },
                          }))
                        }
                      />
                    </td>
                    <td className="people-row-actions">
                      {tocada && (
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={guardando}
                          onClick={() => guardarFila(p)}
                        >
                          {t.save}
                        </Button>
                      )}
                      <button
                        type="button"
                        className="ops-info-remove"
                        title={t.removeTitle}
                        aria-label={t.removeOf(p.nombre)}
                        disabled={guardando}
                        onClick={() => void retirarFila(p)}
                      >
                        <Trash2 size={15} aria-hidden />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* La papelera desactiva (N7): el tramo sale de la ficha, no del
              mundo. Se dice aquí para que no haya que averiguarlo. */}
          <p className="muted people-note">{t.historyNote}</p>
        </>
      )}

      {aviso && (
        <div className="form-ok" role="status">
          {aviso}
        </div>
      )}
      {error && (
        <div role="alert" className="form-error">
          {error}
        </div>
      )}

      <div className="ops-actions">
        <div className="foot-left">
          <Button variant="secondary" disabled={guardando || cargando} onClick={abrirAlta}>
            {esDriver ? t.addDriver : t.addSupervisor}
          </Button>
        </div>
        <Button variant="secondary" onClick={onClose}>
          {t.close}
        </Button>
      </div>

      <Modal open={altaAbierta} title={esDriver ? t.addDriver : t.addSupervisor} onClose={cerrarAlta}>
        <div className="ops-modal">
          <div className="ops-grid">
            <SelectField
              label={esDriver ? t.driver : t.supervisor}
              aria-label={esDriver ? t.driver : t.supervisor}
              required
              options={[
                { value: '', label: t.choose },
                ...personas.map((p) => ({ value: String(p.id), label: p.name })),
              ]}
              value={nuevaPersona}
              onValueChange={setNuevaPersona}
            />
            <TextInputField
              label={t.start}
              aria-label={t.newStart}
              type="date"
              value={nuevoInicio}
              onChange={(e) => setNuevoInicio(e.target.value)}
            />
            <TextInputField
              label={t.endOptional}
              aria-label={t.newEnd}
              type="date"
              value={nuevoFin}
              onChange={(e) => setNuevoFin(e.target.value)}
            />
          </div>
          {/* Lo que pide la regla: decir QUIÉN ocupa esas fechas antes de
              intentar guardar, no después de que el back lo rechace. */}
          {choqueNuevo ? (
            <p className="form-error" role="status">
              {t.busy(choqueNuevo.nombre, periodoTexto(choqueNuevo))}
            </p>
          ) : (
            <p className="muted">{t.freeRange}</p>
          )}
          {errorAlta && (
            <div role="alert" className="form-error">
              {errorAlta}
            </div>
          )}
          <div className="ops-actions">
            <Button variant="secondary" onClick={cerrarAlta}>
              {t.cancel}
            </Button>
            <Button
              variant="primary"
              disabled={guardando || !nuevaPersona || !nuevoInicio || Boolean(choqueNuevo)}
              onClick={() => void anadir()}
            >
              {t.add}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
