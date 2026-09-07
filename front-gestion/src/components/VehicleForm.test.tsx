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
    // texto no está a la vista, solo el disparador (odómetro + conductor = 2).
    expect(
      screen.queryByText(/El odómetro inicial se fijó al dar de alta/),
    ).not.toBeInTheDocument()
    const toggles = screen.getAllByRole('button', { name: '¿Por qué no se puede editar?' })
    expect(toggles).toHaveLength(2)

    // Desplegar el primero (odómetro) revela su explicación.
    await userEvent.click(toggles[0])
    expect(screen.getByText(/El odómetro inicial se fijó al dar de alta/)).toBeInTheDocument()

    // El odómetro inicial sigue bloqueado aquí.
    expect(screen.getByDisplayValue('12000')).toBeDisabled()
  })

  it('explica, plegado, por qué el proyecto está deshabilitado (uso ≠ Proyecto)', async () => {
    renderEdit()
    await screen.findByDisplayValue('2026-01-01')

    // El coche es de uso «personal» → el proyecto va deshabilitado y con su
    // ayuda plegada; al desplegarla se dice cómo habilitarlo.
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
