import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LanguageProvider } from '../i18n.tsx'
import { OwnerDocumentsAccess } from './OwnerDocumentsAccess.tsx'

/**
 * La documentación del titular en dos pasos: se marcan documentos y después
 * se decide cómo los leen los CONDUCTORES —el mismo acceso para todos o uno
 * propio por documento—, concediendo de paso a quien pide lo que le siga
 * yendo con solicitud.
 */
const mocks = vi.hoisted(() => ({
  listDocuments: vi.fn(),
  listDocumentTypeAccess: vi.fn(),
  grantDocumentAccess: vi.fn(),
  updateDocument: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listDocuments: mocks.listDocuments,
  listDocumentTypeAccess: mocks.listDocumentTypeAccess,
  grantDocumentAccess: mocks.grantDocumentAccess,
  updateDocument: mocks.updateDocument,
}))

/** Un documento tal y como lo manda el listado «visto como» quien pide. */
function documento(over: Record<string, unknown>) {
  return {
    id: 100,
    vehicle: 3,
    user: null,
    type: 'contract',
    type_display: 'Contrato',
    notes: '',
    created_at: '2026-09-01T09:00:00Z',
    uploaded_by: 1,
    uploaded_by_name: 'Admin',
    supervisor_read_override: null,
    driver_read_override: null,
    driver_view_override: null,
    driver_download_override: null,
    driver_delete_override: null,
    effective_access: {
      supervisor_read: true,
      driver_read: 'own',
      driver_view: 'request',
      driver_download: 'request',
      driver_delete: 'request',
    },
    access_adjusted: false,
    can_view: false,
    can_download: false,
    view_request: '',
    download_request: '',
    subject_lists: true,
    ...over,
  }
}

// El contrato lo subió Carlos, que es quien pide; el resto, otros.
const CONTRATO = documento({ id: 100, uploaded_by: 9, uploaded_by_name: 'Carlos Ruiz' })
const FICHA = documento({
  id: 101,
  type: 'technical_datasheet',
  type_display: 'Ficha técnica',
  can_view: true,
  can_download: true,
  driver_delete_override: 'deny',
  effective_access: {
    supervisor_read: true,
    driver_read: 'all',
    driver_view: 'allow',
    driver_download: 'allow',
    driver_delete: 'deny',
  },
})
const POLIZA = documento({ id: 102, type: 'insurance', type_display: 'Seguro', subject_lists: false })
const FOTOS = documento({
  id: 103,
  type: 'damage_photos',
  type_display: 'Fotos de daños',
  can_view: true,
  can_download: true,
})

const SIN_AJUSTE = {
  driver_read_override: null,
  driver_view_override: null,
  driver_download_override: null,
  driver_delete_override: null,
}

function pintar() {
  const onChanged = vi.fn()
  render(
    <LanguageProvider>
      <OwnerDocumentsAccess
        owner={{ vehicle: 3 }}
        ownerLabel="8888TRX"
        requester={{ id: 9, name: 'Carlos Ruiz' }}
        onChanged={onChanged}
      />
    </LanguageProvider>,
  )
  return { user: userEvent.setup(), onChanged }
}

async function lista() {
  return screen.findByRole('region', { name: 'Documentación de 8888TRX' })
}

describe('Documentación del titular: marcar y decidir el acceso de los conductores', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listDocuments.mockResolvedValue({ count: 3, next: null, results: [CONTRATO, FICHA, POLIZA] })
    mocks.listDocumentTypeAccess.mockResolvedValue([
      {
        type: 'contract',
        type_display: 'Contrato',
        supervisor_read: true,
        driver_read: 'own',
        driver_view: 'request',
        driver_download: 'request',
        driver_delete: 'request',
      },
    ])
    mocks.grantDocumentAccess.mockResolvedValue({})
    mocks.updateDocument.mockResolvedValue({})
  })

  it('el primer paso solo marca: una casilla por fila, cómo lo leen los conductores y cómo le va a quien pide', async () => {
    pintar()
    const region = await lista()
    const barra = within(region).getByRole('group', { name: 'Acciones sobre los documentos marcados' })
    expect(within(barra).getByText(/Marca documentos para decidir/)).toBeInTheDocument()
    expect(within(barra).getByRole('button', { name: 'Dar acceso a los marcados (0)' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Marcar Contrato' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Marcar Seguro' })).toBeInTheDocument()
    // Lo del conductor, nada de la supervisión; y cómo le va a Carlos.
    expect(within(region).getAllByText('Los suyos').length).toBeGreaterThan(0)
    expect(within(region).queryByText('Lee')).not.toBeInTheDocument()
    expect(within(region).getByText('Lo ve')).toBeInTheDocument()
    expect(within(region).getByText('No le sale en su lista')).toBeInTheDocument()
    // Sin nada que conceder ni ajustar fila a fila: eso es el segundo paso.
    expect(within(region).queryByRole('button', { name: /Conceder|Acceso del grupo/ })).not.toBeInTheDocument()
  })

  it('se filtra por tipo (todos los tipos, con cuántos hay) y por quién lo subió, sin perder lo marcado', async () => {
    mocks.listDocuments.mockResolvedValue({ count: 4, next: null, results: [CONTRATO, FICHA, POLIZA, FOTOS] })
    const { user } = pintar()
    const region = await lista()
    // Cada fila dice quién lo subió.
    const contrato = within(region).getByRole('checkbox', { name: 'Marcar Contrato' }).closest('tr') as HTMLElement
    expect(within(contrato).getByText(/Carlos Ruiz/)).toBeInTheDocument()
    // El tipo: TODOS los del enumerado, también los vacíos, con cuántos hay.
    const tipo = within(region).getByRole('combobox', { name: 'Tipo de documento' })
    expect(tipo).toHaveValue('')
    const opciones = within(tipo).getAllByRole('option').map((o) => o.textContent)
    expect(opciones).toHaveLength(13)
    expect(opciones[0]).toBe('Todos (4)')
    expect(opciones).toContain('Contrato (1)')
    expect(opciones).toContain('Fotos de daños (1)')
    expect(opciones).toContain('Factura de taller (0)')
    expect(opciones).toContain('Permiso de conducir (0)')

    // Se marca con un tipo, se cambia a otro, y lo marcado sigue.
    await user.selectOptions(tipo, 'damage_photos')
    expect(within(region).queryByRole('checkbox', { name: 'Marcar Contrato' })).not.toBeInTheDocument()
    await user.click(within(region).getByRole('checkbox', { name: 'Marcar todos los que se ven' }))
    expect(within(region).getByText('1 documento marcado')).toBeInTheDocument()
    await user.selectOptions(tipo, 'contract')
    await user.click(within(region).getByRole('checkbox', { name: 'Marcar Contrato' }))
    expect(within(region).getByText('2 documentos marcados')).toBeInTheDocument()
    await user.selectOptions(tipo, '')
    expect(within(region).getByRole('checkbox', { name: 'Marcar Fotos de daños' })).toBeChecked()
    expect(within(region).getByRole('checkbox', { name: 'Marcar Contrato' })).toBeChecked()

    // Y quién lo subió: lo de quien pide o lo de otros, con cuántos; los dos
    // filtros se suman y cada uno cuenta sobre lo que deja pasar el otro.
    const subido = within(region).getByRole('combobox', { name: 'Subido por' })
    expect(within(subido).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Cualquiera (4)',
      'Carlos Ruiz (1)',
      'Otros (3)',
    ])
    await user.selectOptions(subido, 'requester')
    expect(within(region).getByRole('checkbox', { name: 'Marcar Contrato' })).toBeInTheDocument()
    expect(within(region).queryByRole('checkbox', { name: 'Marcar Ficha técnica' })).not.toBeInTheDocument()
    expect(within(tipo).getByRole('option', { name: 'Todos (1)' })).toBeInTheDocument()
    expect(within(tipo).getByRole('option', { name: 'Ficha técnica (0)' })).toBeInTheDocument()
    await user.selectOptions(subido, 'others')
    expect(within(region).queryByRole('checkbox', { name: 'Marcar Contrato' })).not.toBeInTheDocument()
    expect(within(region).getByRole('checkbox', { name: 'Marcar Ficha técnica' })).toBeInTheDocument()
    // Lo marcado no se ha movido: el segundo paso los lleva a los dos.
    expect(within(region).getByText('2 documentos marcados')).toBeInTheDocument()
    await user.click(within(region).getByRole('button', { name: 'Dar acceso a los marcados (2)' }))
    await user.click(screen.getByRole('radio', { name: 'Uno propio por documento' }))
    expect(screen.getByRole('row', { name: 'Fotos de daños' })).toBeInTheDocument()
    expect(within(screen.getByRole('row', { name: 'Contrato' })).getByText(/Carlos Ruiz/)).toBeInTheDocument()
  })

  it('el mismo acceso para todos: un PATCH por marcado con SOLO los mandos del conductor', async () => {
    const { user, onChanged } = pintar()
    await lista()
    await user.click(screen.getByRole('checkbox', { name: 'Marcar Contrato' }))
    await user.click(screen.getByRole('checkbox', { name: 'Marcar Ficha técnica' }))
    expect(screen.getByText('2 documentos marcados')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Dar acceso a los marcados (2)' }))

    expect(screen.getByRole('heading', { name: 'Acceso de los conductores a 2 documento(s)' })).toBeInTheDocument()
    // De salida, el mismo para todos; con dos tipos distintos «según el
    // tipo» no dice qué es hoy, porque es distinto en cada uno.
    const modo = screen.getByRole('radiogroup', { name: 'Cómo se decide' })
    expect(within(modo).getByRole('radio', { name: 'El mismo acceso para todos' })).toBeChecked()
    expect(screen.queryByRole('radiogroup', { name: 'La supervisión lo lee' })).not.toBeInTheDocument()
    // Los mandos van en la fila «Todos los marcados», como iconos.
    const todos = screen.getByRole('row', { name: 'Todos los marcados (2)' })
    const lectura = within(todos).getByRole('radiogroup', { name: 'Cómo lo ve el conductor' })
    expect(within(lectura).getByRole('radio', { name: 'Según el tipo de cada documento' })).toBeChecked()
    await user.click(within(lectura).getByRole('radio', { name: 'Permitir' }))
    // Y cada documento enseña en qué le queda: el contrato pasa a «Permitir».
    const contrato = screen.getByRole('row', { name: 'Contrato' })
    expect(within(contrato).getByRole('img', { name: 'Permitir' })).toBeInTheDocument()
    expect(within(contrato).queryByRole('radiogroup')).not.toBeInTheDocument()
    // Sin conceder nada a Carlos esta vez.
    await user.click(screen.getByRole('checkbox', { name: /Concederle a Carlos Ruiz/ }))
    await user.click(screen.getByRole('button', { name: 'Guardar en 2' }))

    await waitFor(() => expect(mocks.updateDocument).toHaveBeenCalledTimes(2))
    expect(mocks.updateDocument).toHaveBeenCalledWith(100, { ...SIN_AJUSTE, driver_view_override: 'allow' })
    expect(mocks.updateDocument).toHaveBeenCalledWith(101, { ...SIN_AJUSTE, driver_view_override: 'allow' })
    const cuerpo = mocks.updateDocument.mock.calls[0][1] as Record<string, unknown>
    expect(cuerpo).not.toHaveProperty('supervisor_read_override')
    expect(mocks.grantDocumentAccess).not.toHaveBeenCalled()
    // Vuelve a la lista con el acuse, y quien la monta recarga.
    expect(await screen.findByRole('status')).toHaveTextContent('Acceso de los conductores guardado en 2 documento(s).')
    expect(screen.getByRole('checkbox', { name: 'Marcar todos' })).toBeInTheDocument()
    expect(onChanged).toHaveBeenCalled()
    await waitFor(() => expect(mocks.listDocuments).toHaveBeenCalledTimes(2))
  })

  it('uno propio por documento: cada marcado con sus mandos, abiertos con lo que ya tiene', async () => {
    const { user } = pintar()
    await lista()
    await user.click(screen.getByRole('checkbox', { name: 'Marcar Contrato' }))
    await user.click(screen.getByRole('checkbox', { name: 'Marcar Ficha técnica' }))
    await user.click(screen.getByRole('button', { name: 'Dar acceso a los marcados (2)' }))
    await user.click(screen.getByRole('radio', { name: 'Uno propio por documento' }))

    // Sin fila «Todos»: cada documento lleva sus conmutadores en su fila.
    expect(screen.queryByRole('row', { name: /Todos los marcados/ })).not.toBeInTheDocument()
    const contrato = screen.getByRole('row', { name: 'Contrato' })
    const ficha = screen.getByRole('row', { name: 'Ficha técnica' })
    // La ficha técnica trae su ajuste de hoy (borrado no permitido); el
    // contrato, todo según su tipo (y el tipo dice qué es hoy).
    const borradoFicha = within(ficha).getByRole('radiogroup', { name: 'Cómo pide el conductor su borrado' })
    expect(within(borradoFicha).getByRole('radio', { name: 'No permitir' })).toBeChecked()
    const descargaContrato = within(contrato).getByRole('radiogroup', { name: 'Cómo se lo baja el conductor' })
    expect(within(descargaContrato).getByRole('radio', { name: /^Según el tipo \(/ })).toBeChecked()
    await user.click(within(descargaContrato).getByRole('radio', { name: 'Permitir' }))
    await user.click(screen.getByRole('checkbox', { name: /Concederle a Carlos Ruiz/ }))
    await user.click(screen.getByRole('button', { name: 'Guardar en 2' }))

    await waitFor(() => expect(mocks.updateDocument).toHaveBeenCalledTimes(2))
    expect(mocks.updateDocument).toHaveBeenCalledWith(100, { ...SIN_AJUSTE, driver_download_override: 'allow' })
    // La ficha técnica se guarda con lo que tenía: no se le borra su ajuste.
    expect(mocks.updateDocument).toHaveBeenCalledWith(101, { ...SIN_AJUSTE, driver_delete_override: 'deny' })
  })

  it('al guardar, concede a quien pide lo que le siga yendo con solicitud en los marcados', async () => {
    const { user } = pintar()
    await lista()
    await user.click(screen.getByRole('checkbox', { name: 'Marcar todos' }))
    await user.click(screen.getByRole('button', { name: 'Dar acceso a los marcados (3)' }))
    expect(screen.getByRole('checkbox', { name: /Concederle a Carlos Ruiz/ })).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Guardar en 3' }))

    await waitFor(() => expect(mocks.updateDocument).toHaveBeenCalledTimes(3))
    // La lista se vuelve a mirar como Carlos: el contrato le sigue yendo con
    // solicitud (lectura y descarga); la ficha técnica ya la ve y la póliza
    // ni le sale en su lista.
    await waitFor(() => expect(mocks.grantDocumentAccess).toHaveBeenCalledTimes(2))
    expect(mocks.grantDocumentAccess).toHaveBeenCalledWith(100, { user: 9, kind: 'view' })
    expect(mocks.grantDocumentAccess).toHaveBeenCalledWith(100, { user: 9, kind: 'download' })
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Acceso de los conductores guardado en 3 documento(s). A Carlos Ruiz se le han concedido 2 acceso(s) que le iban con solicitud.',
    )
  })

  it('si un documento falla, se guarda el resto y se dice cuántos no', async () => {
    mocks.updateDocument.mockImplementation((id: number) =>
      id === 101 ? Promise.reject(new Error('500')) : Promise.resolve({}),
    )
    const { user } = pintar()
    await lista()
    await user.click(screen.getByRole('checkbox', { name: 'Marcar todos' }))
    await user.click(screen.getByRole('button', { name: 'Dar acceso a los marcados (3)' }))
    await user.click(screen.getByRole('checkbox', { name: /Concederle a Carlos Ruiz/ }))
    await user.click(screen.getByRole('button', { name: 'Guardar en 3' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Acceso de los conductores guardado en 2 documento(s). No se pudo guardar en 1 documento(s).',
    )
  })

  it('el paso del acceso resume cómo quedará cada documento, en vivo', async () => {
    const { user } = pintar()
    await lista()
    await user.click(screen.getByRole('checkbox', { name: 'Marcar Contrato' }))
    await user.click(screen.getByRole('checkbox', { name: 'Marcar Seguro' }))
    await user.click(screen.getByRole('button', { name: 'Dar acceso a los marcados (2)' }))

    const resumen = screen.getByRole('region', { name: 'Cómo quedará cada documento' })
    const fila = (nombre: string) => within(resumen).getByRole('row', { name: nombre })
    // Las celdas: documento, los cuatro mandos y lo de Carlos.
    const bajaDe = (nombre: string) => within(fila(nombre)).getAllByRole('cell')[3]
    const para = (nombre: string) => within(fila(nombre)).getAllByRole('cell')[5]
    const todos = within(resumen).getByRole('row', { name: 'Todos los marcados (2)' })
    // Según el tipo (nada tocado): el contrato le sigue yendo con solicitud,
    // y como la casilla de conceder está marcada, se le concederá ahora.
    expect(within(para('Contrato')).getByText('Lo verá (se le concede ahora)')).toBeInTheDocument()
    expect(within(para('Contrato')).getByText('Se lo bajará (se le concede ahora)')).toBeInTheDocument()
    // La póliza no le sale hoy en su lista, y con el listar sin cambiar
    // vale lo que el back dice hoy.
    expect(within(para('Seguro')).getByText('No le saldrá en su lista')).toBeInTheDocument()

    // Sin conceder: lo que le va con solicitud se queda con solicitud.
    await user.click(screen.getByRole('checkbox', { name: /Concederle a Carlos Ruiz/ }))
    expect(within(para('Contrato')).getByText('Lectura con solicitud')).toBeInTheDocument()
    // Con «Permitir» en la lectura, lo verá; con «No permitir» en la
    // descarga, no se lo bajará; y «después» lo dice en sus chapas.
    const lectura = within(todos).getByRole('radiogroup', { name: 'Cómo lo ve el conductor' })
    await user.click(within(lectura).getByRole('radio', { name: 'Permitir' }))
    const descarga = within(todos).getByRole('radiogroup', { name: 'Cómo se lo baja el conductor' })
    await user.click(within(descarga).getByRole('radio', { name: 'No permitir' }))
    expect(within(para('Contrato')).getByText('Lo verá')).toBeInTheDocument()
    expect(within(para('Contrato')).getByText('No se lo bajará')).toBeInTheDocument()
    // La celda del mando dice en qué se resuelve, y que pisa el tipo.
    expect(within(bajaDe('Contrato')).getByRole('img', { name: 'No permitir' })).toHaveClass('is-adjusted')
    // Y si lista «Todos», la póliza le saldrá.
    const listar = within(todos).getByRole('radiogroup', { name: 'Lo que lista el conductor' })
    await user.click(within(listar).getByRole('radio', { name: 'También los subidos por otros usuarios' }))
    expect(within(para('Seguro')).queryByText('No le saldrá en su lista')).not.toBeInTheDocument()
    expect(within(para('Seguro')).getByText('Lo verá')).toBeInTheDocument()
    expect(mocks.updateDocument).not.toHaveBeenCalled()
  })

  it('«Atrás» vuelve a la lista con lo marcado', async () => {
    const { user } = pintar()
    await lista()
    await user.click(screen.getByRole('checkbox', { name: 'Marcar Contrato' }))
    await user.click(screen.getByRole('button', { name: 'Dar acceso a los marcados (1)' }))
    await user.click(screen.getByRole('button', { name: 'Atrás' }))
    expect(screen.getByRole('checkbox', { name: 'Marcar Contrato' })).toBeChecked()
    expect(mocks.updateDocument).not.toHaveBeenCalled()
  })
})
