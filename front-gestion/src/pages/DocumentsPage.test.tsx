import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DocumentsPage } from './DocumentsPage.tsx'
import { ReportsPage } from './ReportsPage.tsx'
import { LanguageProvider } from '../i18n.tsx'

const mocks = vi.hoisted(() => ({
  listVehicles: vi.fn(),
  listUsers: vi.fn(),
  listDocuments: vi.fn(),
  listDocumentTypeAccess: vi.fn(),
  updateDocumentTypeAccess: vi.fn(),
  updateDocument: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listVehicles: mocks.listVehicles,
  listUsers: mocks.listUsers,
  listDocuments: mocks.listDocuments,
  listDocumentTypeAccess: mocks.listDocumentTypeAccess,
  updateDocumentTypeAccess: mocks.updateDocumentTypeAccess,
  updateDocument: mocks.updateDocument,
}))

const page = <T,>(results: T[]) => ({
  count: results.length,
  next: null,
  previous: null,
  results,
})

const doc = (id: number, type: string, extra: Record<string, unknown> = {}) => ({
  id,
  vehicle: 1,
  user: null,
  user_name: '',
  type,
  type_display: type,
  incident: null,
  event: null,
  event_display: '',
  alert: null,
  alert_display: '',
  drive_url: '',
  drive_file_id: '',
  file: null,
  file_url: '',
  uploaded_by: 2,
  uploaded_by_name: 'Carlos Ruiz',
  expiry_date: null,
  status: 'valid',
  status_display: 'Vigente',
  replaces: null,
  created_at: '2026-10-01T10:00:00Z',
  is_active: true,
  ...extra,
})

/** Las reglas tal como las manda el back: los doce tipos, de fábrica salvo
 * el seguro (el conductor solo lista lo suyo y se lo baja con solicitud) y
 * el contrato (cerrado a la supervisión y con la lectura con solicitud). */
const ALL_TYPES = [
  'registration_certificate',
  'technical_datasheet',
  'insurance',
  'contract',
  'delivery_report',
  'return_report',
  'accident_report',
  'damage_photos',
  'itv_report',
  'workshop_invoice',
  'driving_license',
  'other',
]
const rules = () =>
  ALL_TYPES.map((type) => ({
    type,
    type_display: type,
    supervisor_read: type !== 'contract',
    driver_read: type === 'insurance' || type === 'contract' ? 'own' : 'all',
    driver_read_display: '',
    driver_view: type === 'contract' ? 'request' : 'allow',
    driver_view_display: '',
    driver_download: type === 'insurance' ? 'request' : 'allow',
    driver_download_display: '',
    driver_delete: type === 'contract' ? 'deny' : 'request',
    driver_delete_display: '',
    updated_at: null,
  }))

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LanguageProvider>
        <Routes>
          <Route path="/documentos" element={<DocumentsPage />} />
          <Route path="/informes" element={<ReportsPage />} />
        </Routes>
      </LanguageProvider>
    </MemoryRouter>,
  )
}

describe('DocumentsPage (pantalla propia de documentos)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.documentElement.lang = 'es'
    mocks.listVehicles.mockResolvedValue(
      page([{ id: 1, plate: '1234ABC', brand: 'Seat', model: 'León', state: 'active', driver_id: null }]),
    )
    mocks.listUsers.mockResolvedValue(page([{ id: 2, username: 'carlos', name: 'Carlos Ruiz' }]))
    mocks.listDocuments.mockResolvedValue(
      page([doc(10, 'insurance'), doc(11, 'insurance'), doc(12, 'itv_report')]),
    )
    mocks.listDocumentTypeAccess.mockResolvedValue(rules())
    mocks.updateDocumentTypeAccess.mockImplementation((type: string, data: object) =>
      Promise.resolve({ ...rules().find((r) => r.type === type), ...data }),
    )
  })

  it('carga todos los documentos una vez y enseña el recuento de cada tipo', async () => {
    renderAt('/documentos?tab=documentos')
    expect(screen.getByRole('heading', { level: 1, name: 'Documentos' })).toBeInTheDocument()
    // Ajustes va primero y es la pestaña de salida; aquí se entra al listado.
    const principales = screen.getAllByRole('tab', { name: /^(Ajustes|Documentos)$/ })
    expect(principales.map((tab) => tab.textContent)).toEqual(['Ajustes', 'Documentos'])
    const tabs = screen.getByRole('tablist', { name: 'Tipo de documento' })
    await waitFor(() => expect(tabs).toHaveTextContent(/Todos\s*3/))
    expect(tabs).toHaveTextContent(/Seguro\s*2/)
    // El informe de ITV tiene su pestaña (como pestaña de Informes no la tenía).
    expect(tabs).toHaveTextContent(/Informe de ITV\s*1/)
    expect(mocks.listDocuments).toHaveBeenCalledTimes(1)
  })

  it('el tipo elegido va en la URL y se entra ya en él', async () => {
    renderAt('/documentos?tipo=itv_report')
    const itv = await screen.findByRole('tab', { name: /Informe de ITV/ })
    expect(itv).toHaveAttribute('aria-selected', 'true')
    const user = userEvent.setup()
    await user.click(screen.getByRole('tab', { name: /Seguro/ }))
    expect(screen.getByRole('tab', { name: /Seguro/ })).toHaveAttribute('aria-selected', 'true')
    expect(itv).toHaveAttribute('aria-selected', 'false')
    // Cambiar de tipo no vuelve a pedir nada: es un filtro en cliente.
    expect(mocks.listDocuments).toHaveBeenCalledTimes(1)
  })

  it('los enlaces antiguos de Informes llegan a la pantalla de documentos', async () => {
    renderAt('/informes?tab=insurance')
    const seguro = await screen.findByRole('tab', { name: /Seguro/ })
    expect(seguro).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { level: 1, name: 'Documentos' })).toBeInTheDocument()
  })

  it('cada fila dice quién lee ese tipo y qué va con solicitud, con lo que manda Ajustes', async () => {
    renderAt('/documentos?tab=documentos')
    const filas = await screen.findAllByRole('row')
    const seguro = filas.find((row) => within(row).queryByText('Seguro') && row.textContent?.includes('Carlos'))
    expect(seguro).toBeDefined()
    // Dos columnas: lo que lee la supervisión y lo del conductor.
    expect(screen.getByRole('columnheader', { name: /Acceso · Supervisión/ })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /Acceso · Conductor/ })).toBeInTheDocument()
    expect(seguro).toHaveTextContent('Lee')
    expect(seguro).toHaveTextContent('Los suyos')
    // Lo que se PIDE se dice; lo directo no ocupa sitio.
    expect(seguro).toHaveTextContent('Descarga con solicitud')
    expect(seguro).not.toHaveTextContent('Lectura con solicitud')
    const itv = filas.find((row) => within(row).queryByText('Informe de ITV'))
    expect(itv).toHaveTextContent('Todos')
    expect(itv).not.toHaveTextContent(/con solicitud/)
  })

  it('en Ajustes (la pestaña de salida) se cambia quién lee cada tipo y cómo, y solo viaja lo que cambió', async () => {
    renderAt('/documentos')
    const user = userEvent.setup()
    // La administración va fija; el contrato llega cerrado a la supervisión.
    const supContrato = await screen.findByRole('checkbox', { name: 'Contrato · lo lee la supervisión' })
    expect(supContrato).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Seguro · lo lee la supervisión' })).toBeChecked()
    expect(screen.getAllByText('Siempre')).toHaveLength(ALL_TYPES.length)
    // El grupo del conductor: listar, lectura y descarga con sus conmutadores;
    // el borrado, fijo, siempre con solicitud.
    expect(screen.getByRole('columnheader', { name: 'Conductores' })).toBeInTheDocument()
    expect(screen.getAllByRole('radiogroup', { name: /cómo pide el conductor su borrado/ })).toHaveLength(ALL_TYPES.length)
    const lecturaContrato = screen.getByRole('radiogroup', { name: 'Contrato · cómo lo ve el conductor' })
    expect(within(lecturaContrato).getByRole('radio', { name: 'Enviar solicitud' })).toHaveAttribute('aria-checked', 'true')
    const descargaSeguro = screen.getByRole('radiogroup', { name: 'Seguro · cómo se lo baja el conductor' })
    expect(within(descargaSeguro).getByRole('radio', { name: 'Enviar solicitud' })).toHaveAttribute('aria-checked', 'true')
    // Y la tercera posición: no permitir.
    expect(within(descargaSeguro).getByRole('radio', { name: 'No permitir' })).toHaveAttribute('aria-checked', 'false')
    // El borrado es un mando de dos: con solicitud o no permitido.
    const borradoContrato = screen.getByRole('radiogroup', { name: 'Contrato · cómo pide el conductor su borrado' })
    expect(within(borradoContrato).getAllByRole('radio')).toHaveLength(2)
    expect(within(borradoContrato).getByRole('radio', { name: 'No permitir' })).toHaveAttribute('aria-checked', 'true')

    const guardar = screen.getByRole('button', { name: 'Guardar cambios' })
    expect(guardar).toBeDisabled()

    await user.click(supContrato)
    const listarFicha = screen.getByRole('radiogroup', { name: 'Ficha técnica · lo que lista el conductor' })
    // Tres posiciones: no listar, lo suyo, todo.
    expect(within(listarFicha).getAllByRole('radio')).toHaveLength(3)
    expect(within(listarFicha).getByRole('radio', { name: 'No listar ninguno' })).toHaveAttribute('aria-checked', 'false')
    expect(within(listarFicha).getByRole('radio', { name: /otros usuarios/ })).toHaveAttribute('aria-checked', 'true')
    // Con «No listar», lectura, descarga y borrado no aplican: apagados.
    const descargaFicha = screen.getByRole('radiogroup', { name: 'Ficha técnica · cómo se lo baja el conductor' })
    await user.click(within(listarFicha).getByRole('radio', { name: 'No listar ninguno' }))
    expect(within(descargaFicha).getByRole('radio', { name: 'Enviar solicitud' })).toBeDisabled()
    expect(descargaFicha).toHaveAttribute('title', 'No aplica: el conductor no lista este documento.')
    await user.click(within(listarFicha).getByRole('radio', { name: /Solo los subidos/ }))
    expect(within(descargaFicha).getByRole('radio', { name: 'Enviar solicitud' })).toBeEnabled()
    await user.click(within(descargaFicha).getByRole('radio', { name: 'Enviar solicitud' }))
    expect(screen.getByText('2 tipos cambiados sin guardar')).toBeInTheDocument()
    await user.click(guardar)

    await waitFor(() => expect(mocks.updateDocumentTypeAccess).toHaveBeenCalledTimes(2))
    expect(mocks.updateDocumentTypeAccess).toHaveBeenCalledWith('contract', {
      supervisor_read: true,
      driver_read: 'own',
      driver_view: 'request',
      driver_download: 'allow',
      driver_delete: 'deny',
    })
    expect(mocks.updateDocumentTypeAccess).toHaveBeenCalledWith('technical_datasheet', {
      supervisor_read: true,
      driver_read: 'own',
      driver_view: 'allow',
      driver_download: 'request',
      driver_delete: 'request',
    })
    // Tras guardar se vuelven a pedir las reglas (son las de la columna «Acceso»).
    await waitFor(() => expect(mocks.listDocumentTypeAccess).toHaveBeenCalledTimes(2))
    expect(await screen.findByText(/Ajustes guardados/)).toBeInTheDocument()
  })

  it('en la fila, «Acceso» ajusta ESE documento y pisa lo de su tipo', async () => {
    mocks.listDocuments.mockResolvedValue(
      page([
        doc(12, 'itv_report', {
          effective_access: {
            supervisor_read: true,
            driver_read: 'all',
            driver_view: 'allow',
            driver_download: 'allow',
            driver_delete: 'request',
          },
          access_adjusted: false,
          supervisor_read_override: null,
          driver_read_override: null,
          driver_view_override: null,
          driver_download_override: null,
          driver_delete_override: null,
        }),
      ]),
    )
    mocks.updateDocument.mockResolvedValue({})
    renderAt('/documentos?tab=documentos')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Acceso de Informe de ITV' }))

    const modal = screen.getByRole('dialog')
    // Cada mando dice lo que el tipo manda hoy y nace en «según el tipo».
    const descarga = within(modal).getByRole('radiogroup', { name: 'Cómo se lo baja el conductor' })
    expect(within(descarga).getByRole('radio', { name: 'Según el tipo (Permitir)' })).toHaveAttribute('aria-checked', 'true')
    await user.click(within(descarga).getByRole('radio', { name: 'Enviar solicitud' }))
    await user.click(within(modal).getByRole('button', { name: 'Guardar' }))

    // Viaja el ajuste entero: lo que sigue «según el tipo» va como nulo.
    await waitFor(() =>
      expect(mocks.updateDocument).toHaveBeenCalledWith(12, {
        supervisor_read_override: null,
        driver_read_override: null,
        driver_view_override: null,
        driver_download_override: 'request',
        driver_delete_override: null,
      }),
    )
    // Y el listado se vuelve a pedir: la columna lee lo que vale ahora.
    await waitFor(() => expect(mocks.listDocuments).toHaveBeenCalledTimes(2))
  })
})
