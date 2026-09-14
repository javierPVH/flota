import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { VehicleForm } from './VehicleForm.tsx'
import { ConfirmProvider } from './ConfirmDialog.tsx'
import { LanguageProvider } from '../i18n.tsx'
import type { Vehicle } from '../types.ts'

const mocks = vi.hoisted(() => ({
  listDrivers: vi.fn(),
  listSupervisors: vi.fn(),
  fetchCatalogs: vi.fn(),
  fetchVehicle: vi.fn(),
  listVehicleContracts: vi.fn(),
  listVehicleModels: vi.fn(),
  listAll: vi.fn(),
  previewVehicle: vi.fn(),
  updateVehicleFields: vi.fn(),
  updateContract: vi.fn(),
  createContract: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listDrivers: mocks.listDrivers,
  listSupervisors: mocks.listSupervisors,
  fetchCatalogs: mocks.fetchCatalogs,
  fetchVehicle: mocks.fetchVehicle,
  listVehicleContracts: mocks.listVehicleContracts,
  listVehicleModels: mocks.listVehicleModels,
  listAll: mocks.listAll,
  previewVehicle: mocks.previewVehicle,
  updateVehicleFields: mocks.updateVehicleFields,
  updateContract: mocks.updateContract,
  createContract: mocks.createContract,
}))

const page = (rows: unknown[]) => ({ count: rows.length, next: null, previous: null, results: rows })

const EMPTY_CATALOGS = {
  projects: [],
  peps: [],
  'business-units': [],
  rentings: [{ id: 5, name: 'ALD' }],
  countries: [],
  brands: [{ id: 3, name: 'Renault' }],
  companies: [],
  'fuel-types': [],
  sites: [],
}

// Renting, con marca/modelo por catálogo (campos `required` del formulario).
const VEHICLE = {
  id: 42,
  plate: '3546LKR',
  brand: 'Renault',
  model: 'Clío',
  brand_ref: 3,
  model_ref: 9,
  property: 'renting',
  is_substitute: false,
  state: 'active',
  km_start: 12000,
  business_use: 'personal',
  updated_at: '2026-09-01T10:00:00Z',
} as unknown as Vehicle

const CONTRACT = {
  id: 7,
  vehicle: 42,
  contract_number: 'C-1',
  contract_time: 24,
  contract_km: 40000,
  renting: 5,
  start_date: '2026-01-01',
  planned_end_date: '2028-01-01',
  end_date: null,
  month_fee: '390.00',
  penalty_per_km: '0.07',
  drive_url: '',
  is_active: true,
}

function renderEdit() {
  return render(
    <LanguageProvider>
      <ConfirmProvider>
        <VehicleForm mode="edit" vehicleId={42} onSuccess={vi.fn()} onCancel={vi.fn()} />
      </ConfirmProvider>
    </LanguageProvider>,
  )
}

/** Las secciones son pestañas: hay que abrir la que se quiere mirar. */
const irA = (nombre: string) => userEvent.click(screen.getByRole('tab', { name: nombre }))

describe('VehicleForm (edición): contrato editable y campos sensibles', () => {
  beforeEach(() => {
    document.documentElement.lang = 'es'
    mocks.listDrivers.mockResolvedValue([])
    mocks.listSupervisors.mockResolvedValue([])
    mocks.fetchCatalogs.mockResolvedValue(EMPTY_CATALOGS)
    mocks.fetchVehicle.mockResolvedValue(VEHICLE)
    mocks.listVehicleContracts.mockResolvedValue(page([CONTRACT]))
    mocks.listVehicleModels.mockReturnValue(Promise.resolve(page([{ id: 9, name: 'Clío' }])))
    // El desplegable de modelos depende de la marca; se resuelve vía listAll.
    mocks.listAll.mockResolvedValue([{ id: 9, name: 'Clío' }])
    mocks.previewVehicle.mockResolvedValue({ changes: {} })
    mocks.updateVehicleFields.mockResolvedValue(VEHICLE)
    mocks.updateContract.mockResolvedValue(CONTRACT)
    mocks.createContract.mockResolvedValue(CONTRACT)
  })

  it('muestra el contrato prellenado y las notas plegables de los campos sensibles', async () => {
    renderEdit()

    // El contrato (antes solo en el alta) aparece con sus valores cargados.
    expect(await screen.findByDisplayValue('2026-01-01')).toBeInTheDocument() // inicio
    expect(screen.getByDisplayValue('2028-01-01')).toBeInTheDocument() // fin previsto
    expect(screen.getByDisplayValue('390.00')).toBeInTheDocument() // cuota

    // La ayuda de los campos sensibles es un ACORDEÓN plegado por defecto: el
    // texto no está a la vista, solo el disparador. El odómetro está en
    // «Características técnicas» y el conductor en «Uso y asignación»: uno en
    // cada pestaña.
    expect(
      screen.queryByText(/El odómetro inicial se fijó al dar de alta/),
    ).not.toBeInTheDocument()
    await irA('Características técnicas')
    const odometro = screen.getByRole('button', { name: '¿Por qué no se puede editar?' })
    await userEvent.click(odometro)
    expect(screen.getByText(/El odómetro inicial se fijó al dar de alta/)).toBeInTheDocument()
    // El odómetro inicial sigue bloqueado aquí.
    expect(screen.getByDisplayValue('12000')).toBeDisabled()

    await irA('Uso y asignación')
    expect(
      screen.getByRole('button', { name: '¿Por qué no se puede editar?' }),
    ).toBeInTheDocument()
  })

  /** La matrícula, el bastidor y la matriculación no son una pestaña: son la
   * información fija del coche y se ven siempre, con las pestañas debajo. */
  it('lo fijo del vehículo está fuera de las pestañas', async () => {
    renderEdit()
    await screen.findByDisplayValue('2026-01-01')
    // La matrícula del coche se ve sin abrir ninguna pestaña.
    const fijo = document.querySelector('.vf-fixed') as HTMLElement
    expect(fijo).not.toBeNull()
    const valores = [...fijo.querySelectorAll('input')].map((i) => i.value)
    expect(valores).toContain('3546LKR')

    // Y la pestaña de salida es «Identificación»: las demás, ocultas.
    expect(screen.getByRole('tab', { name: 'Identificación' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.queryByLabelText('Cada (km)')).not.toBeInTheDocument()
  })

  /** Esos tres campos identifican al coche fuera de la aplicación: se ven
   * siempre, pero para tocarlos hay que abrir el candado y aceptar el aviso. */
  it('los datos del vehículo van bajo candado: aviso y, al aceptar, editables', async () => {
    renderEdit()
    await screen.findByDisplayValue('2026-01-01')

    const matricula = screen.getByDisplayValue('3546LKR')
    expect(matricula).toBeDisabled()

    // El candado sale CERRADO; al pulsarlo, un aviso, no la edición directa.
    await userEvent.click(screen.getByRole('button', { name: /Bloqueado/ }))
    expect(await screen.findByText(/identifican al vehículo en contratos/)).toBeInTheDocument()
    expect(matricula).toBeDisabled()

    // Al aceptarlo, los tres campos se pueden modificar.
    await userEvent.click(screen.getByRole('button', { name: 'Entiendo, quiero editarlos' }))
    await waitFor(() => expect(matricula).toBeEnabled())
    expect(screen.getByRole('button', { name: /Editable/ })).toBeInTheDocument()
    const fijos = document.querySelector('.vf-fixed') as HTMLElement
    expect([...fijos.querySelectorAll('input')].every((i) => !i.disabled)).toBe(true)
  })

  /** Las acciones del coche viven en la caja del tipo, no sueltas arriba. */
  it('la barra de acciones va dentro de «Tipo de vehículo» y no en el alta', async () => {
    const { unmount } = render(
      <LanguageProvider>
        <ConfirmProvider>
          <VehicleForm
            mode="edit"
            vehicleId={42}
            onSuccess={vi.fn()}
            onCancel={vi.fn()}
            actions={<button type="button">Dar de baja</button>}
          />
        </ConfirmProvider>
      </LanguageProvider>,
    )
    await screen.findByDisplayValue('2026-01-01')
    const cabecera = document.querySelector('.vf-head') as HTMLElement
    expect(cabecera.querySelector('.vf-actions')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Dar de baja' })).toBeInTheDocument()
    unmount()

    // En el alta no hay coche que gestionar: ni acciones ni candado.
    render(
      <LanguageProvider>
        <ConfirmProvider>
          <VehicleForm mode="create" onSuccess={vi.fn()} onCancel={vi.fn()} />
        </ConfirmProvider>
      </LanguageProvider>,
    )
    expect(screen.queryByRole('button', { name: /Bloqueado/ })).not.toBeInTheDocument()
    expect(document.querySelector('.vf-actions')).toBeNull()
  })

  /** El alta es un recorrido: no se crea un vehículo desde la primera
   * pestaña sin haber visto las otras tres. */
  it('el alta se recorre con «Siguiente» y solo la última pestaña crea', async () => {
    render(
      <LanguageProvider>
        <ConfirmProvider>
          <VehicleForm mode="create" onSuccess={vi.fn()} onCancel={vi.fn()} />
        </ConfirmProvider>
      </LanguageProvider>,
    )

    // En «Identificación» no hay con qué crear ni a dónde volver.
    expect(screen.queryByRole('button', { name: 'Crear vehículo' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Atrás' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(screen.getByRole('tab', { name: 'Características técnicas' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    // «Atrás» deshace el paso…
    await userEvent.click(screen.getByRole('button', { name: 'Atrás' }))
    expect(screen.getByRole('tab', { name: 'Identificación' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    for (let i = 0; i < 3; i += 1) {
      await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    }

    // Última pestaña: «Siguiente» se apaga y aparece «Crear vehículo» a la
    // izquierda de «Atrás» (el pie no cambia de botón bajo el cursor).
    expect(screen.getByRole('tab', { name: 'Propiedad y contrato' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled()
    const pie = document.querySelector('.form-footer') as HTMLElement
    expect([...pie.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'Cancelar',
      'Crear vehículo',
      'Atrás',
      'Siguiente',
    ])
  })

  /** A un coche de sustitución no se le asigna conductor ni proyecto: eso sale
   * del coche al que cubre, así que su pestaña ni se ofrece. */
  it('el alta de un sustituto se queda sin la pestaña «Uso y asignación»', async () => {
    render(
      <LanguageProvider>
        <ConfirmProvider>
          <VehicleForm mode="create" onSuccess={vi.fn()} onCancel={vi.fn()} />
        </ConfirmProvider>
      </LanguageProvider>,
    )
    await irA('Uso y asignación')

    // Marcar «Sustitución» se lleva la pestaña por delante: el formulario no
    // se queda en una que ya no existe.
    await userEvent.click(screen.getByRole('radio', { name: '🔁 Sustitución' }))
    expect(screen.queryByRole('tab', { name: 'Uso y asignación' })).toBeNull()
    expect(screen.getByRole('tab', { name: 'Identificación' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    // Y el recorrido pasa de largo: de «Características técnicas» a la última.
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(screen.getByRole('tab', { name: 'Propiedad y contrato' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('explica, plegado, por qué el proyecto está deshabilitado (uso ≠ Proyecto)', async () => {
    renderEdit()
    await screen.findByDisplayValue('2026-01-01')

    // El coche es de uso «personal» → el proyecto va deshabilitado y con su
    // ayuda plegada; al desplegarla se dice cómo habilitarlo.
    await irA('Uso y asignación')
    const toggle = screen.getByRole('button', { name: '¿Por qué no puedo elegir proyecto?' })
    expect(screen.queryByText(/El proyecto solo se asigna/)).not.toBeInTheDocument()
    await userEvent.click(toggle)
    expect(screen.getByText(/Cambia el tipo de uso a «Proyecto»/)).toBeInTheDocument()
  })

  it('cambiar la fecha de fin del contrato lo guarda con PATCH', async () => {
    renderEdit()
    const end = (await screen.findByDisplayValue('2028-01-01')) as HTMLInputElement
    fireEvent.change(end, { target: { value: '2027-06-30' } })

    await userEvent.click(screen.getByRole('button', { name: 'Revisar cambios…' }))

    // El diff del preview enseña el cambio del contrato (recurso aparte).
    expect(await screen.findByText('Fin previsto del contrato')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    await waitFor(() =>
      expect(mocks.updateContract).toHaveBeenCalledWith(7, { planned_end_date: '2027-06-30' }),
    )
  })
})
