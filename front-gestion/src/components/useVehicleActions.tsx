import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { asErrorMessage } from '@flota/ui/http'
import type { TableWithPanelColumn } from '@flota/ui/table'
import {
  Archive,
  ArrowRightLeft,
  Gauge,
  Mail,
  Pencil,
  Receipt,
  Siren,
  UserCog,
  Wrench,
} from 'lucide-react'

import { convertToFleet, deactivateVehicle } from '../api.ts'
import { useConfirm, useDeactivateConfirm } from './ConfirmDialog.tsx'
import { RowActionsMenu, type RowAction } from './RowActionsMenu.tsx'
import { useVehiclesCopy } from '../translations/vehicles.ts'
import type { Vehicle } from '../types.ts'

/**
 * M18 — acciones de fila de un vehículo (menú ⋮) en UN solo sitio.
 *
 * El inventario (`VehiclesPage`) y el panel (`DashboardPage`) tenían las mismas
 * ~180 líneas copiadas: el menú de acciones, la baja con motivo (A8/N7) y la
 * conversión de sustituto a flota con su triple aviso. Dos copias de reglas de
 * negocio serias es una divergencia esperando a ocurrir: basta con arreglar un
 * aviso en una pantalla y olvidar la otra.
 *
 * Lo que cambia entre las dos —qué modal abre cada acción y qué recarga
 * después— entra por parámetros; el resto es idéntico.
 */
export interface VehicleActionsOptions {
  /** Abre el modal de comunicado por correo. */
  onEmail: (vehicle: Vehicle) => void
  /** Abre el modal de cambio de conductor. */
  onDriver: (vehicle: Vehicle) => void
  /** Abre el modal de facturas del vehículo. */
  onInvoices: (vehicle: Vehicle) => void
  /** Abre el modal de operación (estado / sustitución / comunicado). */
  onOps: (vehicle: Vehicle) => void
  /** Abre la comunicación de accidente (parte guiado). */
  onAccident: (vehicle: Vehicle) => void
  /** Abre el modal de kilómetros y combustible (lectura + consumo mensual). */
  onKmFuel: (vehicle: Vehicle) => void
  /**
   * Sustituto → principal al que está cubriendo AHORA. Un sustituto que cubre a
   * alguien no se puede convertir en coche de flota.
   */
  activeMainOfSub: ReadonlyMap<number, number>
  /** Recarga el listado tras una acción que muta el vehículo. */
  onDone: () => void
  onError: (message: string) => void
}

export interface VehicleActions {
  actionsColumn: TableWithPanelColumn<Vehicle>
  deactivate: (vehicle: Vehicle) => Promise<void>
  convert: (vehicle: Vehicle) => Promise<void>
}

export function useVehicleActions({
  onEmail,
  onDriver,
  onInvoices,
  onOps,
  onAccident,
  onKmFuel,
  activeMainOfSub,
  onDone,
  onError,
}: VehicleActionsOptions): VehicleActions {
  const t = useVehiclesCopy()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const deactivateConfirm = useDeactivateConfirm()

  const deactivate = useCallback(
    async (vehicle: Vehicle) => {
      // No borra: el back lo pasa a «baja» y queda restaurable en erratas.
      // A8/N7: doble confirmación + MOTIVO, igual que documentos, facturas y
      // catálogos. Sin el motivo, la baja llegaba al espacio de erratas sin
      // decir por qué se dio.
      const reason = await deactivateConfirm(vehicle.plate)
      if (reason === null) return
      try {
        await deactivateVehicle(vehicle.id, reason)
        onDone()
      } catch (err) {
        onError(asErrorMessage(err, t.deactivateError))
      }
    },
    [deactivateConfirm, onDone, onError, t],
  )

  // Convertir un coche de sustitución en coche de flota: acción seria e
  // irreversible desde la UI → TRIPLE aviso antes de ejecutarla.
  const convert = useCallback(
    async (vehicle: Vehicle) => {
      const c = t.convert
      if (!(await confirm({ title: c.title, message: c.warn1(vehicle.plate), confirmLabel: c.continue, tone: 'warning' })))
        return
      if (!(await confirm({ title: c.title, message: c.warn2, confirmLabel: c.continue, tone: 'warning' })))
        return
      if (!(await confirm({ title: c.title, message: c.warn3(vehicle.plate), confirmLabel: c.confirm, tone: 'danger' })))
        return
      try {
        await convertToFleet(vehicle.id)
        onDone()
      } catch (err) {
        onError(asErrorMessage(err, c.error))
      }
    },
    [confirm, onDone, onError, t],
  )

  const actionsColumn: TableWithPanelColumn<Vehicle> = {
    key: 'actions',
    label: t.columns.actions,
    align: 'right',
    searchable: false,
    sortable: false,
    render: (v) => {
      // Todas las acciones en un menú (⋮) para que quepan siempre.
      const items: RowAction[] = []
      // Correo y conductor: no aplican a coches de sustitución.
      if (!v.is_substitute) {
        items.push({ key: 'email', label: t.email.btn, icon: <Mail size={15} />, onClick: () => onEmail(v) })
        items.push({ key: 'driver', label: t.driverModal.btn, icon: <UserCog size={15} />, onClick: () => onDriver(v) })
      }
      // Facturas: también en sustitutos.
      items.push({ key: 'invoices', label: t.invoices.btn, icon: <Receipt size={15} />, onClick: () => onInvoices(v) })
      // Kilómetros y combustible: lectura + consumo mensual (también sustitutos).
      items.push({ key: 'kmfuel', label: t.kmFuel.btn, icon: <Gauge size={15} />, onClick: () => onKmFuel(v) })
      // Convertir sustituto → flota: solo si no está cubriendo a ningún coche.
      if (v.is_substitute && !activeMainOfSub.has(v.id)) {
        items.push({ key: 'convert', label: t.convert.btn, icon: <ArrowRightLeft size={15} />, onClick: () => convert(v) })
      }
      items.push({ key: 'state', label: t.ops.actionTitle, icon: <Wrench size={15} />, onClick: () => onOps(v) })
      // Comunicación de accidente: el parte guiado, junto al modal de estado.
      items.push({ key: 'accident', label: t.accident.btn, icon: <Siren size={15} />, onClick: () => onAccident(v) })
      items.push({ key: 'edit', label: t.edit, icon: <Pencil size={15} />, onClick: () => navigate(`/vehiculos/${v.id}/editar`) })
      items.push({ key: 'deactivate', label: t.deactivate, icon: <Archive size={15} />, danger: true, onClick: () => deactivate(v) })
      return <RowActionsMenu items={items} ariaLabel={t.columns.actions} />
    },
  }

  return { actionsColumn, deactivate, convert }
}
