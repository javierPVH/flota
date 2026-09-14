import { useEffect, useImperativeHandle, useState, type ReactNode, type Ref } from 'react'
import { Modal } from '@flota/ui/ui'

import { useResolveCopy } from '../translations/resolve.ts'
import type { Vehicle, VehicleLinkRow } from '../types.ts'
import { CollapsibleCard, type AccordionState } from './CollapsibleCard.tsx'
import { usePending, type PendingProps, type PendingResumen } from './usePending.tsx'
import { VehicleStateModal } from './VehicleStateModal.tsx'


/** Lo que la tarjeta deja hacer desde fuera. Hoy, abrir una incidencia: el
 * asistente vive aquí (una cosa, un sitio) y la ficha lo llama por ref en vez
 * de montar una segunda copia. */
export interface PendingCardHandle {
  nuevaIncidencia: () => void
}

/** Cara de la ficha: la tarjeta plegable, con «Nueva incidencia» en su
 * cabecera (el parte de accidente vive en la tarjeta de al lado). */
export function VehiclePendingCard({
  vehicle,
  accordion,
  links,
  onChanged,
  onResumen,
  handleRef,
}: PendingProps & {
  accordion: AccordionState
  /** Para abrir «Nueva incidencia» desde la propia ficha. */
  handleRef?: Ref<PendingCardHandle>
  /**
   * Lo abierto, agrupado por tipo, para el KPI que lo resume arriba en la
   * ficha. Se pasa hacia fuera en vez de que la página vuelva a pedirlo.
   * Tiene que ser una función ESTABLE (un `setState`, p. ej.).
   */
  onResumen?: (resumen: PendingResumen | null) => void
}) {
  const t = useResolveCopy().pending
  const { acciones, cuerpo, modales, resumen, abrirIncidencia } = usePending({
    vehicle,
    links,
    onChanged,
  })
  useImperativeHandle(handleRef, () => ({ nuevaIncidencia: abrirIncidencia }), [abrirIncidencia])
  useEffect(() => {
    onResumen?.(resumen)
  }, [resumen, onResumen])
  return (
    <>
      <CollapsibleCard id="pending" accordion={accordion} title={t.title} actions={acciones}>
        {cuerpo}
      </CollapsibleCard>
      {modales}
    </>
  )
}

/**
 * La misma tarjeta, acotada a **accidentes**: debajo de la de alertas e
 * incidencias y con la misma forma, para que el parte se comunique —y lo
 * comunicado se repase— sin bucear en la lista general.
 *
 * Es `usePending` con `soloTipo: 'accident'`: ni pide alertas, ni ofrece el
 * filtro por tipo, y su único botón es «Comunicar accidente».
 */
export function VehicleAccidentsCard({
  vehicle,
  accordion,
  links,
  onChanged,
}: PendingProps & { accordion: AccordionState }) {
  const t = useResolveCopy().pending
  const { acciones, cuerpo, modales } = usePending({
    vehicle,
    links,
    onChanged,
    soloTipo: 'accident',
  })
  return (
    <>
      <CollapsibleCard
        id="accidents"
        accordion={accordion}
        title={t.accidentsTitle}
        actions={acciones}
      >
        {cuerpo}
      </CollapsibleCard>
      {modales}
    </>
  )
}

/**
 * Cara del **panel**: la misma lista, pero de **toda la flota** — es lo que
 * abren sus dos tiras, «Alertas que requieren atención» e «Incidencias
 * abiertas», cada una en su pestaña.
 *
 * No es de un coche, así que aquí no se ABRE nada (ni incidencia ni parte):
 * se resuelve y se avisa, con la misma ✓ y el mismo sobre, y cada fila dice de
 * qué coche es. `footer` es lo que se hace con la lista entera (filtrar la
 * tabla del panel, salir a la bandeja).
 */
export function FleetPendingList({
  vehicles,
  links,
  sinTipos,
  grupoInicial,
  tipoInicial,
  onChanged,
  footer,
}: {
  vehicles: Vehicle[]
  links: VehicleLinkRow[]
  sinTipos?: readonly string[]
  grupoInicial: 'alerts' | 'incidents'
  tipoInicial?: string
  onChanged: () => void
  footer?: ReactNode
}) {
  const { cuerpo, modales } = usePending({
    vehicle: null,
    vehicles,
    links,
    onChanged,
    sinTipos,
    grupoInicial,
    tipoInicial,
  })
  return (
    <div className="mng pending-fleet">
      {cuerpo}
      {footer}
      {modales}
    </div>
  )
}

/**
 * Cara del menú ⋮ (inventario y panel): **todo lo del coche en un modal**, en
 * tres pestañas — «Nuevo estado» (el formulario de estado, sustitución y
 * comunicado, que antes era una acción aparte), «Alertas» e «Incidencias».
 *
 * Va a **tamaño fijo** (`height`): las tres pestañas tienen contenidos de altos
 * muy distintos y el modal daba saltos al cambiar de una a otra.
 *
 * Se monta abierto —la pantalla lo pinta cuando hay coche elegido y lo quita al
 * cerrarlo—, así cada apertura trae los datos frescos.
 */
export function VehiclePendingModal({
  vehicle,
  allVehicles,
  links,
  onClose,
  onChanged,
}: PendingProps & { allVehicles: Vehicle[]; onClose: () => void }) {
  const t = useResolveCopy().pending
  const { grupo, irA, contadores, recargar, cuerpo, modales } = usePending({
    vehicle,
    links,
    onChanged,
    conTabs: false,
  })
  // La pestaña del formulario es la de salida; las otras dos son el `grupo` del
  // hook, así que no hace falta duplicar ese estado aquí.
  const [enEstado, setEnEstado] = useState(true)

  const pestanas = [
    { key: 'state' as const, label: t.tabNewState, count: null as number | null },
    { key: 'alerts' as const, label: t.tabAlerts, count: contadores.alerts },
    { key: 'incidents' as const, label: t.tabIncidents, count: contadores.incidents },
  ]

  return (
    <>
      {/* Ancho por encima del `xl` del DS (960 px): los seis pasos de «Nuevo
          estado» tienen que caber en su barra sin scroll horizontal. */}
      <Modal open title={t.modalTitle(vehicle.plate)} onClose={onClose} maxWidth="1180px" height="82dvh">
        <div className="pending-modal">
          <div className="ops-tabs" role="tablist" aria-label={t.modalTitle(vehicle.plate)}>
            {pestanas.map((p) => {
              const activa = p.key === 'state' ? enEstado : !enEstado && grupo === p.key
              return (
                <button
                  key={p.key}
                  type="button"
                  role="tab"
                  aria-selected={activa}
                  className={`ops-tab${activa ? ' is-active' : ''}`}
                  onClick={() => {
                    setEnEstado(p.key === 'state')
                    if (p.key !== 'state') irA({ grupo: p.key })
                  }}
                >
                  {p.label}
                  {p.count ? <span className="ops-tab-count">{p.count}</span> : null}
                </button>
              )
            })}
          </div>

          {/* El formulario NO se desmonta al cambiar de pestaña: así el
              resumen de lo guardado sigue ahí al volver, y no se puede abrir
              una segunda petición sin cerrar el modal. */}
          <div hidden={!enEstado}>
            <VehicleStateModal
              vehicle={vehicle}
              allVehicles={allVehicles}
              links={links}
              onClose={onClose}
              onDone={() => {
                onChanged()
                // Lo que se acaba de abrir tiene que aparecer YA en su pestaña.
                recargar()
              }}
            />
          </div>
          {!enEstado && <>{cuerpo}</>}
        </div>
      </Modal>
      {modales}
    </>
  )
}
