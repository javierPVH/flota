import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { VehicleStateModal } from './VehicleStateModal.tsx'
import { LanguageProvider } from '../i18n.tsx'
import type { Vehicle } from '../types.ts'

const mocks = vi.hoisted(() => ({
  listEmailTemplates: vi.fn(),
  noticePreviewVehicle: vi.fn(),
  createIncident: vi.fn(),
  listCatalog: vi.fn(),
  listIncidents: vi.fn(),
  updateVehicleFields: vi.fn(),
  manageIncident: vi.fn(),
  resolveIncident: vi.fn(),
  updateIncident: vi.fn(),
  createCatalogEntry: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listEmailTemplates: mocks.listEmailTemplates,
  noticePreviewVehicle: mocks.noticePreviewVehicle,
  createIncident: mocks.createIncident,
  listCatalog: mocks.listCatalog,
  listIncidents: mocks.listIncidents,
  updateVehicleFields: mocks.updateVehicleFields,
  manageIncident: mocks.manageIncident,
  resolveIncident: mocks.resolveIncident,
  updateIncident: mocks.updateIncident,
  createCatalogEntry: mocks.createCatalogEntry,
}))

const page = (rows: unknown[]) => ({ count: rows.length, next: null, previous: null, results: rows })

const VEHICLE = {
  id: 21,
  plate: '1234KLM',
  brand: 'Mercedes',
  model: 'Sprinter',
  state: 'active',
  state_display: 'Activo',
  is_substitute: false,
  driver_name: 'Carlos Ruiz',
  supervisor_name: 'Sara Supervisora',
  updated_at: '2026-08-01T00:00:00Z',
} as unknown as Vehicle

// Catálogo de talleres (datos de ejemplo, como el seed).
const WORKSHOPS = [
  { id: 3, name: 'Taller Centro (ejemplo)', kind: 'workshop', postal_code: '28001' },
  { id: 4, name: 'Estación ITV Norte (ejemplo)', kind: 'itv', postal_code: '28100' },
]

const OPEN_INCIDENT = {
  id: 4,
  vehicle: 21,
  type: 'breakdown',
  type_display: 'Avería',
  date: '2026-08-20',
  description: 'No arranca en frío',
  mileage: null,
  workshop_postal_code: '',
  details: {},
  status: 'open',
  status_display: 'Abierta',
  cost: null,
}

const CLOSED_INCIDENT = {
  ...OPEN_INCIDENT,
  id: 5,
  description: 'Retrovisor ya reparado',
  status: 'closed',
  status_display: 'Cerrada',
}

function renderModal() {
  return render(
    <LanguageProvider>
      <VehicleStateModal
        vehicle={VEHICLE}
        allVehicles={[]}
        links={[]}
        onClose={vi.fn()}
        onDone={vi.fn()}
      />
    </LanguageProvider>,
  )
}

describe('VehicleStateModal (Estado · matrícula)', () => {
  beforeEach(() => {
    document.documentElement.lang = 'es'
    mocks.listEmailTemplates.mockResolvedValue(page([]))
    mocks.noticePreviewVehicle.mockResolvedValue({
      subject: 'asunto',
      body_html: '<p>cuerpo</p>',
      has_template: true,
      has_en: true,
    })
    mocks.listCatalog.mockResolvedValue(page(WORKSHOPS))
    mocks.listIncidents.mockResolvedValue(page([]))
    mocks.createIncident.mockReset()
    mocks.updateVehicleFields.mockReset()
    mocks.manageIncident.mockReset()
    mocks.resolveIncident.mockReset()
    mocks.updateIncident.mockReset()
    mocks.createCatalogEntry.mockReset()
  })

  it('abre en «Sin cambios» con todo desactivado (y sin fila «-- Ignorar --»)', () => {
    renderModal()
    // Las dos pestañas del modal: crear y seguir lo abierto.
    expect(screen.getByRole('tab', { name: 'Nuevo estado' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Estados abiertos/ })).toBeInTheDocument()

    const stateSelect = screen.getByRole('combobox', { name: 'Nuevo estado' })
    expect(stateSelect).toHaveValue('')
    // El «no hacer nada» es la opción explícita, no el flag del DS.
    expect(within(stateSelect).getByRole('option', { name: '— Sin cambios —' })).toBeInTheDocument()
    expect(within(stateSelect).queryByRole('option', { name: /-- Ignorar --/ })).toBeNull()
    // Y trae la nueva operación de neumáticos.
    expect(
      within(stateSelect).getByRole('option', { name: 'Cambio de neumáticos' }),
    ).toBeInTheDocument()
    // El selector va AGRUPADO (optgroup) y sin «Accidentado»: el accidente se
    // comunica con su propio parte (menú ⋮ → Comunicar accidente).
    expect(within(stateSelect).getByRole('group', { name: 'Disponibilidad' })).toBeInTheDocument()
    const maintenanceGroup = within(stateSelect).getByRole('group', { name: 'Mantenimiento' })
    expect(
      within(maintenanceGroup).getByRole('option', { name: 'Cambio de neumáticos' }),
    ).toBeInTheDocument()
    expect(within(stateSelect).getByRole('group', { name: 'Avería' })).toBeInTheDocument()
    expect(within(stateSelect).getByRole('group', { name: 'ITV' })).toBeInTheDocument()
    expect(within(stateSelect).queryByRole('option', { name: 'Accidentado' })).toBeNull()

    // Todo desactivado: descripción, gestión, comunicado y el propio Guardar.
    expect(screen.getByLabelText('Descripción')).toBeDisabled()
    expect(screen.getByLabelText('Código postal de la ubicación preferente')).toBeDisabled()
    expect(screen.getByLabelText('Mensaje adicional (opcional)')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled()
  })

  it('en «Activo» solo se activa la descripción', async () => {
    renderModal()
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Nuevo estado' }),
      'active',
    )
    expect(screen.getByLabelText('Descripción')).toBeEnabled()
    // Gestión, sustitución, archivos y comunicado siguen apagados (visibles
    // pero desactivados: el acordeón enseña todas las secciones).
    expect(screen.getByLabelText('Código postal de la ubicación preferente')).toBeDisabled()
    expect(screen.getByLabelText('Mensaje adicional (opcional)')).toBeDisabled()
    expect(screen.getByPlaceholderText('https://drive.google.com/…')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeEnabled()
  })

  it('un estado no activo enciende gestión, sustitución, archivos y comunicado', async () => {
    renderModal()
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Nuevo estado' }),
      'broken',
    )
    expect(screen.getByLabelText('Descripción')).toBeEnabled()
    expect(screen.getByLabelText('Código postal de la ubicación preferente')).toBeEnabled()
    expect(screen.getByLabelText('Mensaje adicional (opcional)')).toBeEnabled()
    expect(screen.getByText('Archivos del estado')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('https://drive.google.com/…')).toBeEnabled()
  })

  it('un estado con parte abre su petición y guarda la ubicación preferente', async () => {
    mocks.updateVehicleFields.mockResolvedValue({})
    mocks.createIncident.mockResolvedValue({ id: 7 })
    mocks.manageIncident.mockResolvedValue({})
    renderModal()
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Nuevo estado' }),
      'broken',
    )
    await userEvent.type(screen.getByLabelText('Descripción'), 'Embrague roto')
    await userEvent.type(screen.getByLabelText('Código postal de la ubicación preferente'), '28001')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(mocks.updateVehicleFields).toHaveBeenCalledWith(
      21,
      expect.objectContaining({ state: 'broken', change_reason: 'Embrague roto' }),
    )
    // La petición equivale al estado (Averiado → avería)…
    expect(mocks.createIncident).toHaveBeenCalledWith(
      expect.objectContaining({ vehicle: 21, type: 'breakdown', description: 'Embrague roto' }),
    )
    // …y su gestión guarda únicamente el código postal preferente.
    expect(mocks.manageIncident).toHaveBeenCalledWith(7, {
      workshop_postal_code: '28001',
    })
    expect(await screen.findByRole('status')).toHaveTextContent(/Petición abierta/)
  })

  it('la gestión no carga ni muestra el catálogo de talleres', async () => {
    mocks.updateVehicleFields.mockResolvedValue({})
    mocks.createIncident.mockResolvedValue({ id: 8 })
    mocks.manageIncident.mockResolvedValue({})
    renderModal()
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Nuevo estado' }),
      'maintenance',
    )
    expect(screen.queryByRole('combobox', { name: 'Taller / estación ITV' })).toBeNull()
    await userEvent.type(screen.getByLabelText('Código postal de la ubicación preferente'), '28100')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(mocks.manageIncident).toHaveBeenCalledWith(8, { workshop_postal_code: '28100' })
    expect(mocks.listCatalog).not.toHaveBeenCalled()
    expect(mocks.createCatalogEntry).not.toHaveBeenCalled()
  })

  it('«Cambio de neumáticos» habilita todo y crea la incidencia con el parte', async () => {
    mocks.createIncident.mockResolvedValue({ id: 9 })
    mocks.manageIncident.mockResolvedValue({})
    renderModal()
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Nuevo estado' }),
      'tires',
    )
    // Todo habilitado: descripción (hace de comentario del parte), gestión,
    // archivos y comunicado. La sustitución queda fuera SOLO porque el coche
    // está activo ahora (el back rechaza el vínculo con el principal activo, N9).
    expect(screen.getByLabelText('Descripción')).toBeEnabled()
    expect(screen.getByLabelText('Código postal de la ubicación preferente')).toBeEnabled()
    expect(screen.getByLabelText('Mensaje adicional (opcional)')).toBeEnabled()
    expect(screen.getByText('Archivos del estado')).toBeInTheDocument()

    // El parte guiado conserva sus datos técnicos; CP y gestión viven en su sección.
    await userEvent.type(
      screen.getByRole('spinbutton', { name: 'Kilometraje actual' }),
      '45000',
    )
    await userEvent.type(screen.getByLabelText('Código postal de la ubicación preferente'), '28001')
    expect(document.querySelector('input[type="datetime-local"]')).toBeNull()
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Motivo del cambio' }),
      'puncture',
    )
    // Pinchazo: rueda (delantera izquierda por defecto) + medida del neumático.
    fireEvent.change(screen.getByLabelText('Medidas del neumático'), { target: { value: '205/55 R16' } })
    await userEvent.type(screen.getByLabelText('Descripción'), 'Rueda pinchada en obra')

    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(mocks.createIncident).toHaveBeenCalledWith(
      expect.objectContaining({
        vehicle: 21,
        type: 'tires',
        mileage: 45000,
        workshop_postal_code: '28001',
        description: 'Rueda pinchada en obra',
        details: expect.objectContaining({
          report_version: 1,
          change_reason: 'puncture',
          wheel: 'front_left',
          tire_measure: '205/55 R16',
        }),
      }),
    )
    expect(mocks.manageIncident).toHaveBeenCalledWith(9, { workshop_postal_code: '28001' })
    // Vista de éxito: la incidencia queda registrada.
    expect(await screen.findByRole('status')).toHaveTextContent(/neumáticos/i)
  })

  it('«Estados abiertos» lista solo lo no resuelto y Resolver cierra la petición', async () => {
    mocks.listIncidents.mockResolvedValue(page([OPEN_INCIDENT, CLOSED_INCIDENT]))
    mocks.manageIncident.mockResolvedValue({ ...OPEN_INCIDENT, workshop_postal_code: '28001' })
    mocks.resolveIncident.mockResolvedValue({ ...OPEN_INCIDENT, status: 'closed' })
    renderModal()

    await userEvent.click(screen.getByRole('tab', { name: /Estados abiertos/ }))
    // El formulario de «Nuevo estado» queda oculto (atributo hidden + CSS).
    expect(screen.getByRole('combobox', { name: 'Nuevo estado', hidden: true })).not.toBeVisible()
    // La abierta sale; la cerrada no.
    expect(await screen.findByText('No arranca en frío')).toBeInTheDocument()
    expect(screen.queryByText('Retrovisor ya reparado')).not.toBeInTheDocument()
    // Cada línea: modificar la petición, gestionarla (taller) y resolverla.
    expect(screen.getByRole('button', { name: 'Modificar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Gestión' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Gestión' }))
    const manageDialog = screen.getByRole('dialog', { name: 'Gestión · Avería' })
    expect(within(manageDialog).queryByRole('combobox', { name: /Taller/ })).toBeNull()
    await userEvent.type(
      within(manageDialog).getByLabelText('Código postal de la ubicación preferente'),
      '28001',
    )
    await userEvent.click(within(manageDialog).getByRole('button', { name: 'Guardar' }))
    expect(mocks.manageIncident).toHaveBeenCalledWith(4, { workshop_postal_code: '28001' })

    await userEvent.click(screen.getByRole('button', { name: 'Resolver' }))
    // El modal de resolución: todos los datos opcionales; cierra la petición.
    const downtime = await screen.findByRole('spinbutton', {
      name: 'Días con el vehículo parado',
    })
    await userEvent.type(downtime, '3')
    await userEvent.click(screen.getByRole('button', { name: 'Resolver y cerrar' }))

    expect(mocks.resolveIncident).toHaveBeenCalledWith(4, { downtime_days: 3 })
    expect(await screen.findByRole('status')).toHaveTextContent(/resuelta y cerrada/i)
  })
})
