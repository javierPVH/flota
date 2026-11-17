// R5-45: el asistente de importación masiva (IMPORTACION_MASIVA.md), de punta a
// punta con el back simulado: fichero → mapeo → previsualización → tandas.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BulkImportModal } from './BulkImportModal.tsx'
import { LanguageProvider } from '../../i18n.tsx'

const mocks = vi.hoisted(() => ({
  detectImportColumns: vi.fn(),
  previewImport: vi.fn(),
  bulkCreateImport: vi.fn(),
  exportCsv: vi.fn(),
}))

vi.mock('../../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api.ts')>()),
  detectImportColumns: mocks.detectImportColumns,
  previewImport: mocks.previewImport,
  bulkCreateImport: mocks.bulkCreateImport,
}))

vi.mock('../../csv.ts', () => ({ exportCsv: mocks.exportCsv }))

const FILE = new File(['matricula;marca\n1234KLM;Seat\n5678BCD;Ford'], 'flota.csv', {
  type: 'text/csv',
})

const DETECT = {
  columns: ['Matrícula', 'Marca'],
  auto_mapping: { plate: 0, brand: 1 },
  total_rows: 2,
  omitted_count: 1,
  sheet_names: [],
}

const PREVIEW = {
  records: [
    { _row: 2, plate: '1234KLM', brand: 'Seat' },
    { _row: 3, plate: '5678BCD', brand: 'Ford' },
  ],
  warnings: { mapping_errors: [], data_errors: [] },
  ready_count: 2,
  total_rows: 2,
}

function renderModal(defaults: Record<string, unknown> = { is_substitute: false }) {
  const onClose = vi.fn()
  const onDone = vi.fn()
  render(
    <LanguageProvider>
      <BulkImportModal open entity="vehicles" defaults={defaults} onClose={onClose} onDone={onDone} />
    </LanguageProvider>,
  )
  return { onClose, onDone }
}

/** Sube el fichero por el input oculto del paso 1 y espera el paso de mapeo. */
async function subirFichero() {
  const input = screen.getByRole('dialog').querySelector('input[type="file"]') as HTMLInputElement
  await userEvent.upload(input, FILE)
  await screen.findByText('flota.csv')
}

describe('BulkImportModal (importación masiva por pasos)', () => {
  beforeEach(() => {
    document.documentElement.lang = 'es'
    mocks.detectImportColumns.mockReset().mockResolvedValue(DETECT)
    mocks.previewImport.mockReset().mockResolvedValue(PREVIEW)
    mocks.bulkCreateImport.mockReset()
    mocks.exportCsv.mockReset()
  })

  it('fichero → mapeo automático → validar → importar; sin errores cierra y recarga', async () => {
    mocks.bulkCreateImport.mockResolvedValue({ created: 2, ids: [1, 2], errors: [] })
    const { onClose, onDone } = renderModal()
    expect(screen.getByRole('dialog', { name: 'Importar vehículos' })).toBeInTheDocument()

    await subirFichero()
    expect(mocks.detectImportColumns).toHaveBeenCalledWith('vehicles', FILE)
    // Lo que se ha leído del fichero y el mapeo que propone el back.
    expect(screen.getByText(/2 filas detectadas · 1 filas vacías omitidas/)).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Matrícula' })).toHaveValue('0')
    expect(screen.getByRole('combobox', { name: 'Marca' })).toHaveValue('1')
    expect(screen.getByText('2 de 31 campos asignados')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Validar fichero' }))
    await waitFor(() =>
      expect(mocks.previewImport).toHaveBeenCalledWith('vehicles', FILE, DETECT.auto_mapping, {
        is_substitute: false,
      }),
    )
    // Previsualización: las filas válidas y el botón de importar con su cuenta.
    const importar = await screen.findByRole('button', { name: 'Importar 2 registros' })
    expect(screen.getByText('5678BCD')).toBeInTheDocument()
    await userEvent.click(importar)

    await waitFor(() => expect(mocks.bulkCreateImport).toHaveBeenCalledWith('vehicles', PREVIEW.records))
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('avisa de que se actualiza lo existente y, al terminar, resume campos modificados y no', async () => {
    mocks.previewImport.mockResolvedValue({
      ...PREVIEW,
      records: [{ ...PREVIEW.records[0], _exists: true }, PREVIEW.records[1]],
      create_count: 1,
      update_count: 1,
    })
    mocks.bulkCreateImport.mockResolvedValue({
      created: 1,
      ids: [9],
      errors: [],
      updated: 1,
      unchanged: 0,
      updates: [
        {
          row_number: 2,
          plate: '1234KLM',
          changed: [{ field: 'brand', old: 'Seat', new: 'Ford' }],
          unchanged: ['year'],
          ignored: [],
        },
      ],
    })
    const { onClose, onDone } = renderModal()
    await subirFichero()
    // Aviso en el mapeo: para solo actualizar, mapear solo lo necesario.
    expect(screen.getByRole('note')).toHaveTextContent(/mapea únicamente los campos que necesitas actualizar/)

    await userEvent.click(screen.getByRole('button', { name: 'Validar fichero' }))
    expect(await screen.findByText('1 se crearán · 1 ya existen y se actualizarán')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Importar 2 registros' }))

    // No se cierra solo: tabla de resultados con lo modificado y lo que no.
    expect(await screen.findByText('Actualizado')).toBeInTheDocument()
    expect(screen.getByText('Creado')).toBeInTheDocument()
    expect(screen.getByRole('listitem')).toHaveTextContent('Marca: Seat → Ford')
    expect(screen.getByText(/Sin cambios en: Año/)).toBeInTheDocument() // ya coincidía
    expect(onClose).not.toHaveBeenCalled()
    const cerrar = screen.getAllByRole('button', { name: 'Cerrar' })
    await userEvent.click(cerrar[cerrar.length - 1])
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('si una actualización cambia el Km inicial, avisa y exige confirmar y elegir qué hacer con las lecturas', async () => {
    mocks.previewImport.mockResolvedValue({
      ...PREVIEW,
      records: [{ ...PREVIEW.records[0], _exists: true, km_start: 6000 }],
      ready_count: 1,
      create_count: 0,
      update_count: 1,
      km_changes: [
        {
          row: 2,
          plate: '1234KLM',
          old_km_start: 1000,
          new_km_start: 6000,
          last_reading_km: 5000,
          last_reading_date: '2026-06-10',
        },
      ],
    })
    mocks.bulkCreateImport.mockResolvedValue({
      created: 0,
      ids: [],
      errors: [],
      updated: 1,
      unchanged: 0,
      updates: [
        {
          row_number: 2,
          plate: '1234KLM',
          changed: [{ field: 'km_start', old: '1000', new: '6000' }],
          unchanged: [],
          ignored: [],
          km_action: 'add_new',
        },
      ],
    })
    renderModal()
    await subirFichero()
    await userEvent.click(screen.getByRole('button', { name: 'Validar fichero' }))

    // Aviso con el vehículo afectado y su última lectura; no se puede importar sin confirmar.
    expect(await screen.findByText(/trae un Km inicial distinto para 1 vehículos/)).toBeInTheDocument()
    // Y las dos opciones que NO tocan el Km inicial de la ficha.
    expect(screen.getByRole('radio', { name: /No cambiar el Km inicial: solo añadir una lectura nueva/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /No cambiar el Km inicial: solo modificar la última lectura/ })).toBeInTheDocument()
    expect(screen.getByText('5000 km (2026-06-10)')).toBeInTheDocument()
    const importar = screen.getByRole('button', { name: 'Importar 1 registros' })
    expect(importar).toBeDisabled()

    await userEvent.click(screen.getByRole('radio', { name: /Cambiar el Km inicial y añadir una lectura nueva/ }))
    await userEvent.click(screen.getByRole('checkbox', { name: /Confirmo la opción elegida/ }))
    expect(importar).toBeEnabled()
    await userEvent.click(importar)

    await waitFor(() =>
      expect(mocks.bulkCreateImport).toHaveBeenCalledWith('vehicles', expect.any(Array), {
        km_mode: 'add_new',
      }),
    )
    expect(await screen.findByText('Km inicial cambiado; lectura nueva añadida')).toBeInTheDocument()
  })

  it('sin la matrícula mapeada no se puede validar; «Cambiar fichero» vuelve al paso 1', async () => {
    mocks.detectImportColumns.mockResolvedValue({ ...DETECT, auto_mapping: { brand: 1 } })
    renderModal()
    await subirFichero()
    expect(screen.getByRole('button', { name: 'Validar fichero' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Cambiar fichero' }))
    expect(screen.getByText('Arrastra un fichero o pulsa para elegirlo')).toBeInTheDocument()
  })

  it('un obligatorio que llega por `defaults` no hace falta mapearlo', async () => {
    mocks.detectImportColumns.mockResolvedValue({ ...DETECT, auto_mapping: { brand: 1 } })
    renderModal({ plate: 'X' })
    await subirFichero()
    expect(screen.getByRole('button', { name: 'Validar fichero' })).toBeEnabled()
  })

  it('con errores de validación la pestaña «Errores» los lista y se pueden descargar', async () => {
    mocks.previewImport.mockResolvedValue({
      ...PREVIEW,
      records: [PREVIEW.records[0]],
      ready_count: 1,
      warnings: {
        mapping_errors: [],
        data_errors: [{ row: 3, field: 'plate', message: 'Matrícula repetida' }],
      },
    })
    renderModal()
    await subirFichero()
    await userEvent.click(screen.getByRole('button', { name: 'Validar fichero' }))
    await screen.findByRole('button', { name: 'Importar 1 registros' })
    await userEvent.click(screen.getByRole('button', { name: /Errores/ }))
    const tabla = screen.getByRole('table')
    expect(within(tabla).getByText('Matrícula repetida')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Descargar errores (CSV)' }))
    expect(mocks.exportCsv).toHaveBeenCalledWith(
      'errores-validacion',
      expect.any(Array),
      [{ row: 3, field: 'plate', message: 'Matrícula repetida' }],
    )
  })

  it('las tandas van por `computeBatchSize`; con errores no cierra, y al cerrar recarga lo creado', async () => {
    const records = Array.from({ length: 250 }, (_, i) => ({ _row: i + 2, plate: `R${i}` }))
    mocks.previewImport.mockResolvedValue({ ...PREVIEW, records, ready_count: 250 })
    mocks.bulkCreateImport
      .mockResolvedValueOnce({ created: 100, ids: [], errors: [] })
      .mockResolvedValueOnce({ created: 99, ids: [], errors: [{ index: 5, row_number: 107, error: 'VIN repetido' }] })
      .mockResolvedValueOnce({ created: 50, ids: [], errors: [] })
    const { onClose, onDone } = renderModal()
    await subirFichero()
    await userEvent.click(screen.getByRole('button', { name: 'Validar fichero' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Importar 250 registros' }))

    await waitFor(() => expect(mocks.bulkCreateImport).toHaveBeenCalledTimes(3))
    // 250 → tandas de 100: 100 + 100 + 50.
    expect(mocks.bulkCreateImport.mock.calls.map((c) => (c[1] as unknown[]).length)).toEqual([100, 100, 50])
    expect(await screen.findByText('Importados 249 registros · 1 con errores.')).toBeInTheDocument()
    // El índice del error se recoloca sobre el total (5 de la 2ª tanda → 105).
    await userEvent.click(screen.getByRole('button', { name: 'Descargar errores (CSV)' }))
    expect(mocks.exportCsv).toHaveBeenCalledWith('errores-importacion', expect.any(Array), [
      { index: 105, row_number: 107, error: 'VIN repetido' },
    ])
    // No se cierra solo; al cerrar, como algo se creó, se recarga el listado.
    expect(onClose).not.toHaveBeenCalled()
    // Dos «Cerrar» (la X del modal y el botón del resumen): los dos recargan.
    const cerrar = screen.getAllByRole('button', { name: 'Cerrar' })
    await userEvent.click(cerrar[cerrar.length - 1])
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('si una tanda falla, se dice y se conserva lo ya creado', async () => {
    mocks.bulkCreateImport.mockRejectedValue(new Error('502 Bad Gateway'))
    const { onClose } = renderModal()
    await subirFichero()
    await userEvent.click(screen.getByRole('button', { name: 'Validar fichero' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Importar 2 registros' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('502 Bad Gateway')
    expect(screen.getByText('0 creados')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('un fichero que el back no entiende deja el error en el paso 1', async () => {
    mocks.detectImportColumns.mockRejectedValue(new Error('Cabecera vacía'))
    renderModal()
    const input = screen.getByRole('dialog').querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(input, FILE)
    expect(await screen.findByRole('alert')).toHaveTextContent('Cabecera vacía')
    expect(screen.getByText('Arrastra un fichero o pulsa para elegirlo')).toBeInTheDocument()
  })
})
