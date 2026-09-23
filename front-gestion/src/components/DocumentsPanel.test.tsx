// Tabla de documentos de la ficha: columna «Notas» propia y acciones por icono.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DocumentsPanel } from './DocumentsPanel.tsx'
import { ConfirmProvider } from './ConfirmDialog.tsx'
import { useAccordion } from './CollapsibleCard.tsx'
import { LanguageProvider } from '../i18n.tsx'
import type { FlotaDocument, FlotaEvent, Incident, ManagedUser, Vehicle } from '../types.ts'

const mocks = vi.hoisted(() => ({
  listDocuments: vi.fn(),
  listOpenIncidents: vi.fn(),
  listIncidents: vi.fn(),
  listVehicleEvents: vi.fn(),
  listAlerts: vi.fn(),
  fetchPickerConfig: vi.fn(),
  updateDocument: vi.fn(),
  createDocument: vi.fn(),
  verifyDocuments: vi.fn(),
  purgeDocument: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listDocuments: mocks.listDocuments,
  listOpenIncidents: mocks.listOpenIncidents,
  listIncidents: mocks.listIncidents,
  listVehicleEvents: mocks.listVehicleEvents,
  listAlerts: mocks.listAlerts,
  fetchPickerConfig: mocks.fetchPickerConfig,
  updateDocument: mocks.updateDocument,
  createDocument: mocks.createDocument,
  verifyDocuments: mocks.verifyDocuments,
  purgeDocument: mocks.purgeDocument,
}))

const incidente = (id: number, type: Incident['type'], status: Incident['status']) =>
  ({
    id,
    vehicle: 21,
    type,
    type_display: ({ breakdown: 'Avería', accident: 'Accidente' } as Record<string, string>)[type] ?? type,
    status,
    status_display: status === 'open' ? 'Abierta' : status === 'closed' ? 'Cerrada' : 'En curso',
    date: '2026-09-10',
  }) as Incident

const page = (rows: unknown[]) => ({ count: rows.length, next: null, previous: null, results: rows })

/** Los registros del coche a los que puede acompañar un documento. */
const EVENTS: FlotaEvent[] = [
  { id: 31, vehicle: 21, event_type: 'itv', event_type_display: 'ITV', event_date: '2026-03-01', notes: '', details: { kind: 'itv' } },
  { id: 32, vehicle: 21, event_type: 'maintenance', event_type_display: 'Mantenimiento', event_date: '2026-06-01', notes: '', details: null },
  {
    id: 33,
    vehicle: 21,
    event_type: 'insurance_renewal',
    event_type_display: 'Renovación de seguro',
    event_date: '2026-05-01',
    notes: '',
    details: { kind: 'insurance_renewal', old_expiry: '2026-05-01', new_expiry: '2027-05-01' },
  },
]

const VEHICLE = { id: 21, plate: '1234KLM', drive_folder_url: '' } as unknown as Vehicle

function doc(overrides: Partial<FlotaDocument>): FlotaDocument {
  return {
    id: 1,
    vehicle: 21,
    user: null,
    user_name: '',
    type: 'insurance',
    type_display: 'Seguro',
    incident: null,
    event: null,
    event_display: '',
    alert: null,
    alert_display: '',
    drive_url: 'https://drive/file-1',
    drive_file_id: 'file-1',
    file: null,
    file_url: '',
    uploaded_by: 3,
    uploaded_by_name: 'Laura Martin',
    expiry_date: '2026-09-17',
    status: 'valid',
    status_display: 'Vigente',
    replaces: null,
    notes: '',
    responsible: 7,
    responsible_name: 'Sara Ortiz',
    shared_read: false,
    protected: false,
    drive_missing_at: null,
    created_at: '2026-09-16T09:00:00Z',
    updated_at: '2026-09-16T09:00:00Z',
    ...overrides,
  } as FlotaDocument
}

const USER: ManagedUser = {
  id: 5,
  username: 'carlos',
  first_name: 'Carlos',
  last_name: 'Ruiz',
  license_type: 'B',
  fuel_card: false,
  roles: ['driver'],
  is_superuser: false,
}

function Harness({ personal = false }: { personal?: boolean }) {
  const accordion = useAccordion(['documents'])
  return personal ? (
    <DocumentsPanel user={USER} accordion={accordion} />
  ) : (
    <DocumentsPanel vehicle={VEHICLE} accordion={accordion} />
  )
}

function renderPanel(personal = false) {
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <ConfirmProvider>
          <Harness personal={personal} />
        </ConfirmProvider>
      </LanguageProvider>
    </MemoryRouter>,
  )
}

/** La fila de la tabla cuyo tipo es `tipo` (el tipo va en negrita; el filtro
 * de la barra repite los mismos nombres como opciones). */
function fila(tipo: string) {
  const tabla = screen.getByRole('table')
  return within(tabla).getByText(tipo, { selector: 'strong' }).closest('tr') as HTMLTableRowElement
}

describe('DocumentsPanel (tabla de documentos)', () => {
  beforeEach(() => {
    document.documentElement.lang = 'es'
    mocks.listDocuments.mockReset().mockResolvedValue(
      page([
        doc({ id: 1, notes: 'Póliza renovada con la misma aseguradora, franquicia de 300 €.' }),
        doc({
          id: 2,
          type: 'contract',
          type_display: 'Contrato',
          status: 'expired',
          status_display: 'Caducado',
          notes: '',
        }),
        doc({
          id: 3,
          type: 'damage_photos',
          type_display: 'Fotos de daños',
          status: 'pending_archive',
          status_display: 'Pendiente de archivar',
          drive_url: '',
          drive_file_id: '',
        }),
      ]),
    )
    mocks.listOpenIncidents
      .mockReset()
      .mockResolvedValue([incidente(7, 'breakdown', 'open'), incidente(8, 'accident', 'on_going')])
    // Lo cerrado solo lo ofrece la factura de taller (llega tras la reparación).
    mocks.listIncidents.mockReset().mockResolvedValue(page([incidente(6, 'breakdown', 'closed')]))
    mocks.listVehicleEvents
      .mockReset()
      .mockImplementation((_vehicle: number, kind: string) =>
        Promise.resolve(page(EVENTS.filter((e) => e.event_type === kind))),
      )
    // La ITV programada del coche: su alerta `itv_due` abierta.
    mocks.listAlerts.mockReset().mockResolvedValue(
      page([
        {
          id: 41,
          vehicle: 21,
          type: 'itv_due',
          type_display: 'ITV programada',
          status: 'open',
          due_date: '2026-11-03',
        },
      ]),
    )
    mocks.fetchPickerConfig.mockReset().mockResolvedValue({ enabled: false })
    mocks.updateDocument.mockReset().mockResolvedValue(undefined)
    mocks.createDocument.mockReset().mockResolvedValue(doc({ id: 9 }))
    // Drive dice que el contrato (#2) ya no está; el seguro sí; el tercero no
    // se pudo comprobar (pendiente, sin id de Drive).
    mocks.verifyDocuments.mockReset().mockResolvedValue({ checked: [1, 2], missing: [2] })
    mocks.purgeDocument.mockReset().mockResolvedValue({ purged: true, id: 2, external_deleted: false })
  })

  it('en cada carga comprueba Drive: lo que falta se marca y ofrece el borrado definitivo', async () => {
    renderPanel()
    await screen.findByRole('table')
    await waitFor(() => expect(mocks.verifyDocuments).toHaveBeenCalledWith({ vehicle: 21 }))
    const perdido = fila('Contrato')
    await within(perdido).findByText('Archivo no encontrado')
    // Ni enlace para abrir (no hay a dónde) ni «Eliminar» (erratas): borrado definitivo.
    expect(within(perdido).queryByRole('link', { name: 'Abrir' })).toBeNull()
    expect(within(perdido).queryByRole('button', { name: 'Eliminar' })).toBeNull()
    // El seguro, que sí está, sigue como siempre.
    const vigente = fila('Seguro')
    expect(within(vigente).queryByText('Archivo no encontrado')).toBeNull()
    expect(within(vigente).getByRole('button', { name: 'Eliminar' })).toBeInTheDocument()
    expect(within(vigente).queryByRole('button', { name: 'Borrado definitivo' })).toBeNull()

    await userEvent.click(within(perdido).getByRole('button', { name: 'Borrado definitivo' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(/ya no existe en Drive/)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Borrado definitivo' }))
    await waitFor(() => expect(mocks.purgeDocument).toHaveBeenCalledWith(2))
    await waitFor(() => expect(mocks.listDocuments).toHaveBeenCalledTimes(2))
  })

  it('el alta pide caducidad solo a lo que caduca y liga el parte a un accidente abierto', async () => {
    renderPanel()
    await screen.findByRole('table')
    await userEvent.click(screen.getByRole('button', { name: 'Añadir documento' }))
    const dialog = await screen.findByRole('dialog')
    const tipo = within(dialog).getByRole('combobox', { name: /Tipo de documento/ })
    // Seguro (por defecto): la caducidad se pide y es obligatoria, y la póliza
    // puede acompañar a la renovación que la trajo (su registro), no a incidencias.
    const caducidad = within(dialog).getByLabelText(/Fecha de caducidad/)
    expect(caducidad).toBeRequired()
    const registro = await within(dialog).findByRole('combobox', { name: /Registro al que acompaña/ })
    expect(within(registro).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Ninguno',
      'Renovación de seguro · 2026-05-01 (vence 2027-05-01)',
    ])
    expect(within(dialog).queryByRole('combobox', { name: /incidencia/i })).toBeNull()

    // Fotos de daños: son las fotos DE una incidencia (o accidente) abierta: obligatoria.
    await userEvent.selectOptions(tipo, 'damage_photos')
    const fotos = within(dialog).getByRole('combobox', { name: /Incidencia o accidente abierto/ })
    expect(fotos).toBeRequired()
    expect(within(fotos).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Elige la incidencia…',
      '#7 · Avería · Abierta (2026-09-10)',
      '#8 · Accidente · En curso (2026-09-10)',
    ])

    // Ficha técnica: no caduca → la fecha desaparece; la incidencia es opcional.
    await userEvent.selectOptions(tipo, 'technical_datasheet')
    expect(within(dialog).queryByLabelText(/Fecha de caducidad/)).toBeNull()
    const ligado = within(dialog).getByRole('combobox', { name: /Ligado a incidencia abierta/ })
    expect(within(ligado).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Ninguna',
      '#7 · Avería · Abierta (2026-09-10)',
      '#8 · Accidente · En curso (2026-09-10)',
    ])
    // El permiso de circulación no tiene incidencia detrás: no se ofrece.
    await userEvent.selectOptions(tipo, 'registration_certificate')
    expect(within(dialog).queryByRole('combobox', { name: /incidencia|acompaña/i })).toBeNull()

    // Parte de accidente: solo accidentes abiertos, y obligatorio.
    await userEvent.selectOptions(tipo, 'accident_report')
    const accidente = within(dialog).getByRole('combobox', { name: /Accidente abierto/ })
    expect(accidente).toBeRequired()
    expect(within(accidente).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Elige el accidente…',
      '#8 · Accidente · En curso (2026-09-10)',
    ])
    await userEvent.selectOptions(accidente, 'incident:8')
    await userEvent.type(within(dialog).getByLabelText(/URL del documento/), 'https://drive/parte')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))
    await waitFor(() =>
      expect(mocks.createDocument).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'accident_report', incident: 8, event: null, expiry_date: null }),
      ),
    )
  })

  it('la factura de taller acompaña SIEMPRE a algo: incidencias (también cerradas), ITV o mantenimientos, por grupos', async () => {
    renderPanel()
    await screen.findByRole('table')
    await userEvent.click(screen.getByRole('button', { name: 'Añadir documento' }))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByRole('combobox', { name: /Registro al que acompaña/ })
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: /Tipo de documento/ }),
      'workshop_invoice',
    )
    const ligado = within(dialog).getByRole('combobox', { name: /Ligado a incidencia, ITV o mantenimiento/ })
    expect(ligado).toBeRequired()
    // Un solo desplegable con lo que tiene el coche, agrupado por categoría.
    expect(within(ligado).getAllByRole('group').map((g) => g.getAttribute('label'))).toEqual([
      'Incidencias',
      'ITV',
      'Mantenimientos',
    ])
    expect(within(ligado).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Elige a qué acompaña…',
      '#7 · Avería · Abierta (2026-09-10)',
      '#8 · Accidente · En curso (2026-09-10)',
      '#6 · Avería · Cerrada (2026-09-10)',
      'ITV · 2026-03-01',
      'Mantenimiento · 2026-06-01',
    ])
    // Ligada a la ITV: viaja `event`, sin incidencia.
    await userEvent.type(within(dialog).getByLabelText(/URL del documento/), 'https://drive/factura')
    await userEvent.selectOptions(ligado, 'event:31')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))
    await waitFor(() =>
      expect(mocks.createDocument).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'workshop_invoice', event: 31, incident: null }),
      ),
    )
  })

  it('un vínculo opcional dejado en «Ninguna» no bloquea el guardado', async () => {
    // Un `<select required>` con la opción vacía elegida no pasaba la
    // validación nativa («Selecciona un elemento de la lista») y el contrato o
    // la ficha técnica no se podían guardar sin incidencia.
    renderPanel()
    await screen.findByRole('table')
    await userEvent.click(screen.getByRole('button', { name: 'Añadir documento' }))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByRole('combobox', { name: /Registro al que acompaña/ })
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: /Tipo de documento/ }),
      'contract',
    )
    expect(within(dialog).getByRole('combobox', { name: /Ligado a incidencia abierta/ })).toHaveValue('none')
    await userEvent.type(within(dialog).getByLabelText(/Fecha de caducidad/), '2028-01-01')
    await userEvent.type(within(dialog).getByLabelText(/URL del documento/), 'https://drive/contrato')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))
    await waitFor(() =>
      expect(mocks.createDocument).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'contract', incident: null, event: null, alert: null }),
      ),
    )
  })

  it('el informe de ITV corresponde a una ITV registrada o a la programada (la alerta abierta)', async () => {
    renderPanel()
    await screen.findByRole('table')
    await userEvent.click(screen.getByRole('button', { name: 'Añadir documento' }))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByRole('combobox', { name: /Registro al que acompaña/ })
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: /Tipo de documento/ }),
      'itv_report',
    )
    const itv = within(dialog).getByRole('combobox', { name: /ITV a la que corresponde/ })
    expect(itv).toBeRequired()
    expect(within(itv).getAllByRole('group').map((g) => g.getAttribute('label'))).toEqual([
      'ITV',
      'ITV programadas',
    ])
    expect(within(itv).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Elige la ITV…',
      'ITV · 2026-03-01',
      'ITV programada · 2026-11-03',
    ])
    await userEvent.selectOptions(itv, 'alert:41')
    await userEvent.type(within(dialog).getByLabelText(/Fecha de caducidad/), '2028-03-01')
    await userEvent.type(within(dialog).getByLabelText(/URL del documento/), 'https://drive/informe')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))
    await waitFor(() =>
      expect(mocks.createDocument).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'itv_report', alert: 41, event: null, incident: null }),
      ),
    )
  })

  it('sin nada a lo que ligar la factura, no se puede subir y se dice por qué', async () => {
    mocks.listOpenIncidents.mockResolvedValue([])
    mocks.listIncidents.mockResolvedValue(page([]))
    mocks.listVehicleEvents.mockResolvedValue(page([]))
    renderPanel()
    await screen.findByRole('table')
    await userEvent.click(screen.getByRole('button', { name: 'Añadir documento' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: /Tipo de documento/ }),
      'workshop_invoice',
    )
    expect(within(dialog).getByRole('status')).toHaveTextContent(/no tiene ninguno registrado/)
    expect(within(dialog).getByRole('button', { name: 'Guardar' })).toBeDisabled()
  })

  it('sin accidente abierto, el parte no se puede subir y se dice por qué', async () => {
    mocks.listOpenIncidents.mockResolvedValue([incidente(7, 'breakdown', 'open')])
    renderPanel()
    await screen.findByRole('table')
    await userEvent.click(screen.getByRole('button', { name: 'Añadir documento' }))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByRole('combobox', { name: /Registro al que acompaña/ })
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: /Tipo de documento/ }),
      'accident_report',
    )
    expect(within(dialog).getByRole('status')).toHaveTextContent(/comunica primero el accidente/)
    expect(within(dialog).queryByRole('combobox', { name: /Accidente abierto/ })).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Guardar' })).toBeDisabled()
  })

  it('las notas van en su columna, recortadas, y el modal las enseña enteras', async () => {
    renderPanel()
    await screen.findByRole('table')
    expect(screen.getByRole('columnheader', { name: /Notas/ })).toBeInTheDocument()
    // La nota ya no cuelga del tipo…
    const tipo = within(fila('Seguro')).getByText('Seguro', { selector: 'strong' })
    expect(tipo.parentElement?.textContent).toBe('Seguro')
    // …y la fila sin nota enseña el guion en la celda de notas.
    const cabeceras = screen.getAllByRole('columnheader').map((h) => h.textContent?.trim())
    const idxNotas = cabeceras.findIndex((h) => h?.startsWith('Notas'))
    expect(fila('Contrato').cells[idxNotas]).toHaveTextContent('—')

    await userEvent.click(within(fila('Seguro')).getByRole('button', { name: 'Ver la nota completa' }))
    const modal = await screen.findByRole('dialog')
    expect(modal).toHaveTextContent('Póliza renovada con la misma aseguradora, franquicia de 300 €.')
  })

  it('las acciones son iconos con nombre accesible y cambian según el estado', async () => {
    renderPanel()
    await screen.findByRole('table')

    const vigente = fila('Seguro')
    expect(within(vigente).getByRole('link', { name: 'Abrir' })).toHaveAttribute('href', 'https://drive/file-1')
    expect(within(vigente).getByRole('button', { name: 'Sustituir' })).toBeInTheDocument()
    expect(within(vigente).getByRole('button', { name: 'Marcar caducado' })).toBeInTheDocument()
    expect(within(vigente).getByRole('button', { name: 'Eliminar' })).toBeInTheDocument()
    // Ningún botón de la tira de acciones lleva texto: solo iconos.
    const tira = vigente.querySelector('.row-actions') as HTMLElement
    within(tira)
      .getAllByRole('button')
      .forEach((b) => expect(b.textContent?.trim()).toBe(''))

    // Caducado: la acción es la contraria.
    expect(within(fila('Contrato')).getByRole('button', { name: 'Marcar vigente' })).toBeInTheDocument()
    // Pendiente de archivar: ni «Abrir» (no hay a dónde) ni cambio de estado.
    const pendiente = fila('Fotos de daños')
    expect(within(pendiente).queryByRole('link', { name: 'Abrir' })).toBeNull()
    expect(within(pendiente).queryByRole('button', { name: /Marcar/ })).toBeNull()
    expect(within(pendiente).getByRole('button', { name: 'Sustituir' })).toBeInTheDocument()
  })

  it('«Agrupar por tipo» parte la tabla en bloques plegables, uno por tipo', async () => {
    renderPanel()
    await screen.findByRole('table')
    expect(document.querySelectorAll('tbody button[aria-expanded]')).toHaveLength(0)
    await userEvent.click(screen.getByRole('checkbox', { name: 'Agrupar por tipo' }))
    const bloques = [...document.querySelectorAll('tbody button[aria-expanded]')]
    const titulo = (b: Element) => b.querySelectorAll('span')[0]?.textContent
    // Un bloque por tipo, en orden alfabético, con sus filas debajo.
    expect(bloques.map(titulo)).toEqual(['Contrato', 'Fotos de daños', 'Seguro'])
    await userEvent.click(bloques[2])
    expect(screen.queryByText('Seguro', { selector: 'strong' })).toBeNull()
    expect(screen.getByText('Contrato', { selector: 'strong' })).toBeInTheDocument()
  })

  it('«Marcar caducado» manda el cambio de estado y recarga', async () => {
    renderPanel()
    await screen.findByRole('table')
    await userEvent.click(within(fila('Seguro')).getByRole('button', { name: 'Marcar caducado' }))
    await waitFor(() => expect(mocks.updateDocument).toHaveBeenCalledWith(1, { status: 'expired' }))
    await waitFor(() => expect(mocks.listDocuments).toHaveBeenCalledTimes(2))
  })

  it('en la ficha de un usuario enseña solo LOS SUYOS: tipos personales, sin incidencias', async () => {
    mocks.listDocuments.mockResolvedValue(
      page([
        doc({
          id: 11,
          vehicle: null,
          user: 5,
          user_name: 'Carlos Ruiz',
          type: 'driving_license',
          type_display: 'Permiso de conducir',
          expiry_date: '2031-03-01',
        }),
      ]),
    )
    mocks.verifyDocuments.mockResolvedValue({ checked: [11], missing: [] })
    renderPanel(true)
    await screen.findByRole('table')
    // Se piden y se comprueban por titular PERSONA, no por vehículo.
    expect(mocks.listDocuments).toHaveBeenCalledWith({ user: 5, type: undefined })
    await waitFor(() => expect(mocks.verifyDocuments).toHaveBeenCalledWith({ user: 5 }))
    expect(screen.getByText('Documentos personales')).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: /Ligado a/ })).toBeNull()
    expect(fila('Permiso de conducir')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Añadir documento' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Documento de Carlos Ruiz')
    // Solo los tipos con sentido para una persona, con el permiso por defecto…
    const tipo = within(dialog).getByRole('combobox', { name: /Tipo de documento/ })
    expect(within(tipo).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Permiso de conducir',
      'Otro',
    ])
    expect(tipo).toHaveValue('driving_license')
    // …que caduca (la fecha se pide) y no se liga a ninguna incidencia.
    expect(within(dialog).getByLabelText(/Fecha de caducidad/)).toBeRequired()
    expect(mocks.listOpenIncidents).not.toHaveBeenCalled()
    expect(mocks.listVehicleEvents).not.toHaveBeenCalled()
    expect(mocks.listAlerts).not.toHaveBeenCalled()
    expect(within(dialog).queryByRole('combobox', { name: /incidencia|acompaña/i })).toBeNull()

    await userEvent.type(within(dialog).getByLabelText(/Fecha de caducidad/), '2031-03-01')
    await userEvent.type(within(dialog).getByLabelText(/URL del documento/), 'https://drive/permiso')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))
    await waitFor(() =>
      expect(mocks.createDocument).toHaveBeenCalledWith(
        expect.objectContaining({ user: 5, type: 'driving_license', expiry_date: '2031-03-01' }),
      ),
    )
    expect(mocks.createDocument.mock.calls[0][0]).not.toHaveProperty('vehicle')
  })

  // Quién lee el documento: hasta ahora, cualquier conductor del coche veía
  // todo lo que colgaba de él.
  it('el alta decide quién lo lee, y nace solo para su responsable', async () => {
    renderPanel()
    await screen.findByRole('table')
    await userEvent.click(screen.getByRole('button', { name: 'Añadir documento' }))
    const dialog = await screen.findByRole('dialog')

    const interruptor = within(dialog).getByRole('switch', {
      name: 'Visible para todos los conductores del vehículo',
    })
    expect(interruptor).not.toBeChecked()

    await userEvent.click(interruptor)
    await userEvent.type(within(dialog).getByLabelText(/Fecha de caducidad/), '2027-03-01')
    await userEvent.type(within(dialog).getByLabelText(/URL del documento/), 'https://drive/x')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))

    await waitFor(() =>
      expect(mocks.createDocument).toHaveBeenCalledWith(
        expect.objectContaining({ shared_read: true, protected: false }),
      ),
    )
  })

  it('con el candado puesto, el interruptor de lectura ya no decide nada', async () => {
    renderPanel()
    await screen.findByRole('table')
    await userEvent.click(screen.getByRole('button', { name: 'Añadir documento' }))
    const dialog = await screen.findByRole('dialog')

    await userEvent.click(within(dialog).getByLabelText('Protegido'))
    expect(
      within(dialog).getByRole('switch', {
        name: 'Visible para todos los conductores del vehículo',
      }),
    ).toBeDisabled()
    expect(
      within(dialog).getByText(/no lo ve ningún conductor ni supervisor/i),
    ).toBeInTheDocument()
  })

  it('la fila dice quién lo lee y de quién es, y se puede cambiar después', async () => {
    renderPanel()
    await screen.findByRole('table')
    const fila_ = fila('Seguro')
    expect(within(fila_).getByText('Solo el responsable')).toBeInTheDocument()
    expect(within(fila_).getByText('Sara Ortiz')).toBeInTheDocument()

    await userEvent.click(within(fila_).getByRole('button', { name: 'Cambiar la visibilidad' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Responsable: Sara Ortiz.')).toBeInTheDocument()

    await userEvent.click(
      within(dialog).getByRole('switch', {
        name: 'Visible para todos los conductores del vehículo',
      }),
    )
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))
    await waitFor(() =>
      expect(mocks.updateDocument).toHaveBeenCalledWith(1, {
        shared_read: true,
        protected: false,
      }),
    )
  })
  it('con la app en inglés, la tabla NO repite lo que manda el back', async () => {
    // El back escribe `type_display`/`status_display` siempre en castellano
    // (son los `choices` de su enumerado): la tabla los traduce por CÓDIGO
    // (`domainLabels`), o en inglés salía «Seguro · Vigente».
    // El provider aplica al montar el idioma PERSISTIDO, así que se cambia ahí.
    localStorage.setItem('gs_base_lang', 'en')
    renderPanel()
    // «Insurance» sale también como opción del filtro de tipo: basta con que
    // la FILA lo diga (el tipo va en negrita).
    await screen.findByRole('table')
    expect(fila('Insurance')).toBeInTheDocument()
    expect(fila('Contract')).toBeInTheDocument()
    expect(screen.getAllByText('Valid').length).toBeGreaterThan(0)
    expect(screen.queryByText('Seguro')).not.toBeInTheDocument()
    expect(screen.queryByText('Caducado')).not.toBeInTheDocument()
  })
})
