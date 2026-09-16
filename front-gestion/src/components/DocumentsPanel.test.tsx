// Tabla de documentos de la ficha: columna «Notas» propia y acciones por icono.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DocumentsPanel } from './DocumentsPanel.tsx'
import { ConfirmProvider } from './ConfirmDialog.tsx'
import { useAccordion } from './CollapsibleCard.tsx'
import { LanguageProvider } from '../i18n.tsx'
import type { FlotaDocument, Incident, Vehicle } from '../types.ts'

const mocks = vi.hoisted(() => ({
  listDocuments: vi.fn(),
  listOpenIncidents: vi.fn(),
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
    status_display: status === 'open' ? 'Abierta' : 'En curso',
    date: '2026-09-10',
  }) as Incident

const page = (rows: unknown[]) => ({ count: rows.length, next: null, previous: null, results: rows })

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
    drive_missing_at: null,
    created_at: '2026-09-16T09:00:00Z',
    updated_at: '2026-09-16T09:00:00Z',
    ...overrides,
  } as FlotaDocument
}

function Harness() {
  const accordion = useAccordion(['documents'])
  return <DocumentsPanel vehicle={VEHICLE} accordion={accordion} />
}

function renderPanel() {
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <ConfirmProvider>
          <Harness />
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
    // Seguro (por defecto): la caducidad se pide y es obligatoria.
    const caducidad = within(dialog).getByLabelText(/Fecha de caducidad/)
    expect(caducidad).toBeRequired()
    // Cualquier incidencia sin cerrar sirve, y es opcional.
    const ligado = await within(dialog).findByRole('combobox', { name: /Ligado a incidencia abierta/ })
    expect(within(ligado).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Ninguna',
      '#7 · Avería · Abierta (2026-09-10)',
      '#8 · Accidente · En curso (2026-09-10)',
    ])

    // Ficha técnica: no caduca → la fecha desaparece.
    await userEvent.selectOptions(tipo, 'technical_datasheet')
    expect(within(dialog).queryByLabelText(/Fecha de caducidad/)).toBeNull()

    // Parte de accidente: solo accidentes abiertos, y obligatorio.
    await userEvent.selectOptions(tipo, 'accident_report')
    const accidente = within(dialog).getByRole('combobox', { name: /Accidente abierto/ })
    expect(accidente).toBeRequired()
    expect(within(accidente).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Elige el accidente…',
      '#8 · Accidente · En curso (2026-09-10)',
    ])
    await userEvent.selectOptions(accidente, '8')
    await userEvent.type(within(dialog).getByLabelText(/URL del documento/), 'https://drive/parte')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))
    await waitFor(() =>
      expect(mocks.createDocument).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'accident_report', incident: 8, expiry_date: null }),
      ),
    )
  })

  it('sin accidente abierto, el parte no se puede subir y se dice por qué', async () => {
    mocks.listOpenIncidents.mockResolvedValue([incidente(7, 'breakdown', 'open')])
    renderPanel()
    await screen.findByRole('table')
    await userEvent.click(screen.getByRole('button', { name: 'Añadir documento' }))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByRole('combobox', { name: /Ligado a incidencia abierta/ })
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

  it('«Marcar caducado» manda el cambio de estado y recarga', async () => {
    renderPanel()
    await screen.findByRole('table')
    await userEvent.click(within(fila('Seguro')).getByRole('button', { name: 'Marcar caducado' }))
    await waitFor(() => expect(mocks.updateDocument).toHaveBeenCalledWith(1, { status: 'expired' }))
    await waitFor(() => expect(mocks.listDocuments).toHaveBeenCalledTimes(2))
  })
})
