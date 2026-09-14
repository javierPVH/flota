import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ConfirmProvider } from './ConfirmDialog.tsx'
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
  listWorkshops: vi.fn(),
  createVehicleLink: vi.fn(),
  listKmReadingsAll: vi.fn(),
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
  // El modal de resolver (dispatcher) carga el catálogo por esta función.
  listWorkshops: mocks.listWorkshops,
  createVehicleLink: mocks.createVehicleLink,
  listKmReadingsAll: mocks.listKmReadingsAll,
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

// Coche de sustitución disponible (el modal solo ofrece los libres).
const SUBSTITUTE = {
  id: 99,
  plate: '9999SUB',
  brand: 'Seat',
  model: 'Ibiza',
  state: 'active',
  state_display: 'Activo',
  is_substitute: true,
} as unknown as Vehicle

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

// El mismo coche, ya parado a mano desde su ficha: sin ninguna petición
// abierta que lo retenga, se puede devolver a Activo desde aquí.
const PARADO = { ...VEHICLE, state: 'non_active', state_display: 'No activo' } as Vehicle

/** Sacar el coche de la calle exige justificar la sustitución (paso «Disponibilidad»). */
async function sinSustituto(motivo = 'Parada de un día') {
  await irA(/Disponibilidad/)
  await userEvent.click(screen.getByRole('radio', { name: /sale sin coche de sustitución/ }))
  await userEvent.type(screen.getByLabelText('Por qué sale sin sustituto'), motivo)
}

/** El paso que se está mirando (los pasos son un indicador, no pestañas). */
function pasoActual(): string {
  const activo = screen
    .getAllByRole('tab')
    .find((tab) => tab.getAttribute('aria-selected') === 'true')
  return activo?.textContent ?? ''
}

/** Ir a un paso es AVANZAR hasta él: no se puede saltar, y cada «Siguiente»
 * exige los obligatorios del paso que se deja. */
async function irA(paso: RegExp) {
  for (let i = 0; i < 8 && !paso.test(pasoActual()); i += 1) {
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
  }
  expect(pasoActual()).toMatch(paso)
}

/** El botón principal del pie avanza («Siguiente») hasta el último paso, que
 * es el único que guarda: los casos recorren el formulario entero. */
async function guardar() {
  for (let i = 0; i < 8 && !screen.queryByRole('button', { name: 'Guardar' }); i += 1) {
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
  }
  await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
}

function renderModal(allVehicles: Vehicle[] = [], vehicle: Vehicle = VEHICLE) {
  return render(
    // Con el proveedor de confirmaciones, como en la app: el alta de un coche
    // de sustitución (que se abre desde el bloque de sustitución) lo usa.
    <LanguageProvider>
      <ConfirmProvider>
        <VehicleStateModal
          vehicle={vehicle}
          allVehicles={allVehicles}
          links={[]}
          onClose={vi.fn()}
          onDone={vi.fn()}
        />
      </ConfirmProvider>
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
    mocks.listWorkshops.mockResolvedValue(WORKSHOPS)
    mocks.listIncidents.mockResolvedValue(page([]))
    // Última lectura del odómetro: el parte de neumáticos no puede bajar de ahí.
    mocks.listKmReadingsAll.mockResolvedValue(page([{ id: 1, km_reading: 44000 }]))
    mocks.createVehicleLink.mockReset()
    mocks.createIncident.mockReset()
    mocks.updateVehicleFields.mockReset()
    mocks.manageIncident.mockReset()
    mocks.resolveIncident.mockReset()
    mocks.updateIncident.mockReset()
    mocks.createCatalogEntry.mockReset()
  })

  it('abre en «Sin cambios» con todo desactivado (y sin fila «-- Ignorar --»)', () => {
    renderModal()
    // «Estados abiertos» está oculto: lo pendiente se repasa en la ficha.
    expect(screen.queryByText(/Estados abiertos/)).toBeNull()
    // El formulario va por PASOS: solo el primero está disponible hasta que se
    // elige qué se hace; los demás se encienden según lo elegido.
    expect(screen.getByRole('tab', { name: /Estado del vehículo/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    for (const paso of ['Disponibilidad', 'Gestión · ubicación', 'Archivos del estado', 'Comunicado por email']) {
      expect(screen.getByRole('tab', { name: new RegExp(paso) })).toHaveAttribute(
        'aria-disabled',
        'true',
      )
    }
    // El de neumáticos ni siquiera existe: es de su propia operación.
    expect(screen.queryByRole('tab', { name: /neumáticos/ })).toBeNull()

    const stateSelect = screen.getByRole('combobox', { name: 'Nuevo estado' })
    expect(stateSelect).toHaveValue('sin_cambios')
    // El «no hacer nada» es la opción explícita, no el flag del DS.
    expect(within(stateSelect).getByRole('option', { name: '— Sin cambios —' })).toBeInTheDocument()
    expect(within(stateSelect).queryByRole('option', { name: /-- Ignorar --/ })).toBeNull()
    // Y trae la nueva operación de neumáticos.
    expect(
      within(stateSelect).getByRole('option', { name: 'Cambio de neumáticos' }),
    ).toBeInTheDocument()
    // El selector va AGRUPADO (optgroup) y es SOLO el catálogo de incidencias
    // que se abren a mano: mantenimiento puntual, neumáticos, avería y
    // petición general.
    const maintenanceGroup = within(stateSelect).getByRole('group', { name: 'Mantenimiento' })
    expect(
      within(maintenanceGroup).getByRole('option', { name: 'Cambio de neumáticos' }),
    ).toBeInTheDocument()
    expect(within(stateSelect).getByRole('group', { name: 'Avería' })).toBeInTheDocument()
    expect(
      within(stateSelect).getByRole('option', { name: 'Petición general' }),
    ).toBeInTheDocument()
    // Y no lleva nada que se opere en otra parte: la disponibilidad (su paso y
    // la ficha), el mantenimiento programado (su plan), el accidente (su
    // parte) ni la ITV (que es una alerta).
    expect(within(stateSelect).queryByRole('group', { name: 'Disponibilidad' })).toBeNull()
    expect(within(stateSelect).queryByRole('option', { name: 'Mantenimiento programado' })).toBeNull()
    expect(
      within(stateSelect).queryByRole('option', { name: 'No activo - Accidentado' }),
    ).toBeNull()
    expect(within(stateSelect).queryByRole('option', { name: 'No activo - ITV' })).toBeNull()

    // Todo desactivado: descripción, gestión, comunicado y el propio Guardar.
    expect(screen.getByLabelText('Descripción')).toBeDisabled()
    expect(screen.getByLabelText('Código postal de la ubicación')).toBeDisabled()
    expect(screen.getByLabelText('Mensaje adicional (opcional)')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled()
  })

  /** La disponibilidad no se toca desde el selector: la decide su paso (y el
   * estado suelto se edita en la ficha del coche). */
  it('el selector no ofrece disponibilidad: ni «Activo» ni «No activo»', () => {
    renderModal()
    const select = screen.getByRole('combobox', { name: 'Nuevo estado' })
    expect(within(select).queryByRole('option', { name: 'Activo' })).toBeNull()
    expect(within(select).queryByRole('option', { name: 'No activo' })).toBeNull()
  })

  /** El camino de vuelta al servicio vive en el paso «Disponibilidad», y está
   * abierto aun sin incidencia: es lo único que hay que hacer con un coche
   * parado a mano desde su ficha. */
  it('con el coche parado y nada reteniéndolo, se devuelve al servicio', async () => {
    mocks.updateVehicleFields.mockResolvedValue({})
    renderModal([], PARADO)
    // El pie recorre los pasos: aquí todavía no toca guardar.
    expect(screen.queryByRole('button', { name: 'Guardar' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(screen.getByRole('radio', { name: /sigue fuera de servicio/ })).toBeChecked()
    expect(await screen.findByText(/no queda ninguna petición reteniéndolo/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('radio', { name: /vuelve al servicio/ }))
    expect(document.querySelector('[data-section="avail"]')).toHaveClass('is-ok')
    // Y en el último paso, el mismo botón ya guarda.
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() =>
      expect(mocks.updateVehicleFields).toHaveBeenCalledWith(
        21,
        expect.objectContaining({ state: 'active' }),
      ),
    )
  })

  it('un estado no activo enciende gestión, sustitución, archivos y comunicado', async () => {
    renderModal()
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Nuevo estado' }),
      'broken',
    )
    expect(screen.getByLabelText('Descripción')).toBeEnabled()
    expect(screen.getByLabelText('Código postal de la ubicación')).toBeEnabled()
    expect(screen.getByLabelText('Mensaje adicional (opcional)')).toBeEnabled()
    expect(screen.getByText('Archivos del estado')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('https://drive.google.com/…')).toBeEnabled()
  })

  it('un estado con parte abre su petición y guarda su ubicación', async () => {
    mocks.updateVehicleFields.mockResolvedValue({})
    mocks.createIncident.mockResolvedValue({ id: 7 })
    mocks.manageIncident.mockResolvedValue({})
    renderModal()
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Nuevo estado' }),
      'broken',
    )
    await userEvent.type(screen.getByLabelText('Descripción'), 'Embrague roto')
    await userEvent.type(screen.getByLabelText('Código postal de la ubicación'), '28001')
    await sinSustituto()
    await guardar()

    // El porqué de quedarse sin sustituto viaja en la nota del cambio de estado…
    expect(mocks.updateVehicleFields).toHaveBeenCalledWith(
      21,
      expect.objectContaining({
        state: 'broken',
        change_reason: 'Embrague roto — Sin coche de sustitución: Parada de un día',
      }),
    )
    // La petición equivale al estado (Averiado → avería)…
    // …y no en el encargo al taller, que solo habla de la avería.
    expect(mocks.createIncident).toHaveBeenCalledWith(
      expect.objectContaining({ vehicle: 21, type: 'breakdown', description: 'Embrague roto' }),
    )
    // …y su gestión guarda únicamente el código postal preferente.
    expect(mocks.manageIncident).toHaveBeenCalledWith(7, {
      workshop_postal_code: '28001',
    })
    expect(await screen.findByRole('status')).toHaveTextContent(/Petición abierta/)
    // Y lo que se ve al final es el RESUMEN de lo guardado…
    expect(screen.getByText('Petición abierta')).toBeInTheDocument()
    expect(screen.getByText('Embrague roto')).toBeInTheDocument()
    // La petición que se abre y el ESTADO en que queda el coche, que ya no se
    // llaman igual: la avería es la incidencia, «No activo - …» es el estado.
    expect(screen.getByText('Vehículo averiado')).toBeInTheDocument()
    expect(screen.getByText('No activo - Averiado')).toBeInTheDocument()
    expect(screen.getByText(/No activo · sale sin coche de sustitución · Parada de un día/))
      .toBeInTheDocument()
    // …sin vuelta al formulario: para abrir otra petición hay que reabrir.
    expect(screen.queryByRole('combobox', { name: 'Nuevo estado' })).toBeNull()
    expect(screen.getByText(/Para abrir otra petición, cierra y vuelve a entrar/))
      .toBeInTheDocument()
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
    await userEvent.type(screen.getByLabelText('Código postal de la ubicación'), '28100')
    await sinSustituto()
    await guardar()

    expect(mocks.manageIncident).toHaveBeenCalledWith(8, { workshop_postal_code: '28100' })
    expect(mocks.listCatalog).not.toHaveBeenCalled()
    expect(mocks.createCatalogEntry).not.toHaveBeenCalled()
  })

  /** Parar el coche no lo deja en un «No activo» genérico: el estado dice por
   * qué está parado, y lo dice la incidencia elegida. */
  it('los neumáticos lo dejan «No activo - Mantenimiento», no «No activo»', async () => {
    mocks.updateVehicleFields.mockResolvedValue({})
    mocks.createIncident.mockResolvedValue({ id: 9 })
    renderModal()
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Nuevo estado' }),
      'tires',
    )
    await userEvent.type(screen.getByLabelText('Descripción'), 'Rueda pinchada')
    await sinSustituto()
    // El parte va completo antes de dejar guardar.
    await irA(/Datos del cambio de neumáticos/)
    await userEvent.type(screen.getByRole('spinbutton', { name: 'Kilometraje actual' }), '45000')
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Motivo del cambio' }),
      'puncture',
    )
    fireEvent.change(screen.getByLabelText('Medidas del neumático'), {
      target: { value: '205/55 R16' },
    })
    await guardar()

    // El cambio de neumáticos ES mantenimiento, aunque tenga parte propio.
    await waitFor(() =>
      expect(mocks.updateVehicleFields).toHaveBeenCalledWith(
        21,
        expect.objectContaining({ state: 'maintenance' }),
      ),
    )
    // …pero el sustituto lo habría cubierto POR los neumáticos, no por el
    // mantenimiento: el motivo del vínculo sale de la incidencia.
    expect(mocks.createIncident).toHaveBeenCalledWith(
      expect.objectContaining({ vehicle: 21, type: 'tires' }),
    )
    expect(screen.getByText('No activo - Mantenimiento')).toBeInTheDocument()
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
    // archivos y comunicado.
    expect(screen.getByLabelText('Descripción')).toBeEnabled()
    expect(screen.getByLabelText('Código postal de la ubicación')).toBeEnabled()
    expect(screen.getByLabelText('Mensaje adicional (opcional)')).toBeEnabled()
    // Y aparece su propio paso, además de los que enciende cualquier estado.
    expect(screen.getByRole('tab', { name: /Datos del cambio de neumáticos/ })).toHaveAttribute(
      'aria-disabled',
      'false',
    )
    expect(screen.getByRole('tab', { name: /Archivos del estado/ })).toHaveAttribute(
      'aria-disabled',
      'false',
    )
    // Y la sustitución ya no es un paso: no hay pestaña que buscar.
    expect(screen.queryByRole('tab', { name: /Coche de sustitución/ })).toBeNull()

    // Se recorre en orden: descripción (comentario del parte), disponibilidad,
    // el parte guiado y la gestión.
    await userEvent.type(screen.getByLabelText('Descripción'), 'Rueda pinchada en obra')
    await irA(/Datos del cambio de neumáticos/)
    const km = screen.getByRole('spinbutton', { name: 'Kilometraje actual' })
    // El odómetro no anda hacia atrás: el mínimo es la última lectura.
    expect(km).toHaveAttribute('min', '44000')
    expect(screen.getByText(/La última lectura registrada es 44.000 km/)).toBeInTheDocument()
    await userEvent.type(km, '45000')
    expect(document.querySelector('input[type="datetime-local"]')).toBeNull()
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Motivo del cambio' }),
      'puncture',
    )
    // Pinchazo: rueda (delantera izquierda por defecto) + medida del neumático.
    fireEvent.change(screen.getByLabelText('Medidas del neumático'), { target: { value: '205/55 R16' } })

    await irA(/Gestión/)
    await userEvent.type(screen.getByLabelText('Código postal de la ubicación'), '28001')

    await guardar()
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

  /** Con la pestaña oculta, el modal no enseña ni pide lo que ya está abierto:
   * eso se repasa en la ficha. El ciclo modificar → gestionar → resolver de una
   * petición se prueba en `OpenIncidentsPanel.test.tsx`. */
  /** Lo abierto no se LISTA aquí (eso es la pestaña «Incidencias»), pero sí se
   * consulta: es lo que RETIENE al coche fuera de servicio. */
  it('lo que quedó abierto no se lista, pero sí retiene al coche', async () => {
    mocks.listIncidents.mockResolvedValue(page([OPEN_INCIDENT, CLOSED_INCIDENT]))
    const parado = {
      ...VEHICLE,
      state: 'broken',
      state_display: 'No activo - Averiado',
    } as Vehicle
    renderModal([], parado)

    // Ni la lista de peticiones ni su ciclo: para eso está la otra pestaña.
    expect(screen.queryByText('No arranca en frío')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Gestión' })).toBeNull()

    // Con la avería sin resolver, la vuelta al servicio está cerrada y se dice
    // dónde se abre: resolviéndola.
    await irA(/Disponibilidad/)
    expect(await screen.findByText(/Resuélvela en la pestaña «Incidencias»/)).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /vuelve al servicio/ })).toBeDisabled()
  })

  /** Abrir una incidencia no para el coche: la disponibilidad se decide en su
   * paso y arranca en «Activo», con el borde en verde. */
  it('con el coche en servicio, una incidencia no lo para: solo se registra', async () => {
    mocks.createIncident.mockResolvedValue({ id: 11 })
    mocks.manageIncident.mockResolvedValue({})
    renderModal()
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Nuevo estado' }),
      'maintenance',
    )
    await userEvent.type(screen.getByLabelText('Descripción'), 'Cambio de aceite')
    await userEvent.type(screen.getByLabelText('Código postal de la ubicación'), '28001')

    await irA(/Disponibilidad/)
    expect(screen.getByRole('radio', { name: /el coche sigue en servicio/ })).toBeChecked()
    expect(document.querySelector('[data-section="avail"]')).toHaveClass('is-ok')

    await guardar()
    expect(await screen.findByRole('status')).toHaveTextContent(
      /Petición abierta: Mantenimiento puntual/,
    )
    expect(mocks.createIncident).toHaveBeenCalledWith(
      expect.objectContaining({
        vehicle: 21,
        type: 'maintenance',
        description: 'Cambio de aceite',
      }),
    )
    // Y el coche se queda como estaba: su estado no se toca.
    expect(mocks.updateVehicleFields).not.toHaveBeenCalled()
  })

  it('al dejarlo «No activo» el borde pasa a rojo y el estado sí cambia', async () => {
    mocks.updateVehicleFields.mockResolvedValue({})
    mocks.createIncident.mockResolvedValue({ id: 12 })
    mocks.manageIncident.mockResolvedValue({})
    renderModal()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Nuevo estado' }), 'broken')
    await userEvent.type(screen.getByLabelText('Código postal de la ubicación'), '28001')
    await sinSustituto('El taller lo tiene una semana')
    expect(document.querySelector('[data-section="avail"]')).toHaveClass('is-bad')

    await guardar()
    expect(await screen.findByRole('status')).toBeInTheDocument()
    expect(mocks.updateVehicleFields).toHaveBeenCalledWith(
      21,
      expect.objectContaining({ state: 'broken' }),
    )
  })

  /** El asistente se recorre con el pie, y cada paso pide lo suyo antes de
   * dejarte salir. Los que no tienen obligatorios dejan pasar sin más. */
  it('«Siguiente» exige los obligatorios del paso y «Anterior» vuelve', async () => {
    renderModal([SUBSTITUTE])
    // En el primer paso no hay a dónde volver.
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Nuevo estado' }), 'broken')

    // El paso del estado no tiene obligatorios: se pasa sin escribir nada.
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(pasoActual()).toMatch(/Disponibilidad/)

    // Decir que lleva sustituto y no elegirlo sí bloquea…
    await userEvent.click(
      screen.getByRole('radio', { name: /se le asigna un coche de sustitución/ }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(pasoActual()).toMatch(/Disponibilidad/)
    expect(screen.getByRole('alert')).toHaveTextContent(/elige cuál/)
    // …y sus obligatorios se ven: el DS los marca junto a la etiqueta.
    const avail = document.querySelector('[data-section="avail"]') as HTMLElement
    expect(within(avail).getAllByText('Obligatorio').length).toBeGreaterThan(0)

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Vehículo de sustitución' }),
      '99',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(pasoActual()).toMatch(/Gestión/)

    // La gestión no tiene obligatorios: el código postal es opcional y se
    // pasa de largo sin escribir nada.
    const gestion = document.querySelector('[data-section="manage"]') as HTMLElement
    expect(within(gestion).queryByText('Obligatorio')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(pasoActual()).toMatch(/Archivos/)

    // Y se puede retroceder a repasar lo anterior.
    await userEvent.click(screen.getByRole('button', { name: 'Anterior' }))
    expect(pasoActual()).toMatch(/Gestión/)
  })

  /** Del resumen solo se sale cerrando… o pidiendo otro formulario en blanco. */
  it('«Nuevo estado» quita el resumen y devuelve el formulario vacío', async () => {
    mocks.createIncident.mockResolvedValue({ id: 21 })
    renderModal()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Nuevo estado' }), 'general')
    await userEvent.type(screen.getByLabelText('Descripción'), 'Falta el permiso de circulación')
    await guardar()
    expect(await screen.findByRole('status')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Nuevo estado' }))
    // Vuelve el formulario, en blanco y por el primer paso.
    const select = screen.getByRole('combobox', { name: 'Nuevo estado' })
    expect(select).toHaveValue('sin_cambios')
    expect(screen.getByLabelText('Descripción')).toHaveValue('')
    expect(pasoActual()).toMatch(/Estado del vehículo/)
    expect(screen.queryByText(/Para abrir otra petición/)).toBeNull()
  })

  /** El pie no cambia de botón bajo el cursor: «Siguiente» se apaga y
   * «Guardar» APARECE, a la izquierda de «Anterior». */
  it('en el último paso «Siguiente» se apaga y aparece «Guardar»', async () => {
    renderModal()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Nuevo estado' }), 'general')
    expect(screen.queryByRole('button', { name: 'Guardar' })).toBeNull()

    await irA(/Comunicado por email/)
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled()
    const pie = document.querySelector('.ops-actions-end') as HTMLElement
    const botones = within(pie)
      .getAllByRole('button')
      .map((b) => b.textContent)
    expect(botones).toEqual(['Guardar', 'Anterior', 'Siguiente'])
  })

  /** La otra mitad de la regla: si sale con sustituto, se elige en su paso y
   * el motivo del vínculo lo dice la incidencia (avería → avería). */
  it('«se le asigna un coche de sustitución» abre el bloque y crea el vínculo', async () => {
    mocks.updateVehicleFields.mockResolvedValue({})
    mocks.createIncident.mockResolvedValue({ id: 14 })
    mocks.manageIncident.mockResolvedValue({})
    mocks.createVehicleLink.mockResolvedValue({})
    renderModal([SUBSTITUTE])
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Nuevo estado' }), 'broken')
    await userEvent.type(screen.getByLabelText('Código postal de la ubicación'), '28001')
    // Mientras no se diga que lleva sustituto, no hay nada que elegir…
    await irA(/Disponibilidad/)
    expect(screen.queryByRole('combobox', { name: 'Vehículo de sustitución' })).toBeNull()

    // …y al decirlo, el bloque aparece en el mismo paso.
    await userEvent.click(
      screen.getByRole('radio', { name: /se le asigna un coche de sustitución/ }),
    )
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Vehículo de sustitución' }),
      '99',
    )
    // El motivo del vínculo entra precargado con lo elegido en el paso 1.
    expect(screen.getByRole('combobox', { name: 'Motivo de la sustitución' })).toHaveValue(
      'breakdown',
    )
    await guardar()

    expect(await screen.findByRole('status')).toBeInTheDocument()
    expect(mocks.createVehicleLink).toHaveBeenCalledWith(
      expect.objectContaining({ main_vehicle: 21, substitute_vehicle: 99, reason: 'breakdown' }),
    )
  })

  /** El sustituto que hace falta puede no estar dado de alta todavía: se crea
   * desde el propio bloque, sin salir (y sin perder lo escrito). */
  it('el bloque de sustitución ofrece crear uno, con el tipo ya marcado', async () => {
    renderModal([SUBSTITUTE])
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Nuevo estado' }), 'broken')
    await userEvent.type(screen.getByLabelText('Código postal de la ubicación'), '28001')
    await irA(/Disponibilidad/)
    await userEvent.click(
      screen.getByRole('radio', { name: /se le asigna un coche de sustitución/ }),
    )

    await userEvent.click(screen.getByRole('button', { name: 'Crear coche de sustitución' }))

    // Es el alta completa, con el tipo en «Sustitución» (N9: se fija al crear).
    expect(await screen.findByRole('radio', { name: '🔁 Sustitución' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Flota' })).not.toBeChecked()
  })

  /** La petición general puede no tener ni que ver con el coche, así que ni le
   * cambia el estado ni se le pregunta a qué taller va. */
  it('«Petición general» abre su incidencia y no pide taller', async () => {
    mocks.createIncident.mockResolvedValue({ id: 13 })
    renderModal()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Nuevo estado' }), 'general')
    await userEvent.type(screen.getByLabelText('Descripción'), 'Falta la tarjeta de combustible')
    expect(screen.getByLabelText('Código postal de la ubicación')).toBeDisabled()

    await guardar()
    expect(await screen.findByRole('status')).toHaveTextContent(
      /Petición abierta: Petición general/,
    )
    expect(mocks.createIncident).toHaveBeenCalledWith(
      expect.objectContaining({
        vehicle: 21,
        type: 'general',
        description: 'Falta la tarjeta de combustible',
      }),
    )
    expect(mocks.updateVehicleFields).not.toHaveBeenCalled()
    expect(mocks.manageIncident).not.toHaveBeenCalled()
  })

})
