import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CatalogsPage } from './CatalogsPage.tsx'
import { ConfirmProvider } from '../components/ConfirmDialog.tsx'
import { LanguageProvider } from '../i18n.tsx'

const mocks = vi.hoisted(() => ({
  listCatalog: vi.fn(),
  fetchCatalogs: vi.fn(),
  createCatalogEntry: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listCatalog: mocks.listCatalog,
  fetchCatalogs: mocks.fetchCatalogs,
  createCatalogEntry: mocks.createCatalogEntry,
}))

const page = (rows: unknown[]) => ({ count: rows.length, next: null, previous: null, results: rows })

const PROGRAMAS = [
  {
    id: 1,
    name: 'Revisión general',
    every_km: 30000,
    every_months: 12,
    cycle_label: '30000 km / 12 meses',
    notes: 'Incluye filtros',
  },
  {
    id: 2,
    name: 'Cambio de aceite',
    every_km: 15000,
    every_months: null,
    cycle_label: '15000 km',
    notes: '',
  },
]

function renderPage() {
  return render(
    <LanguageProvider>
      <ConfirmProvider>
        <CatalogsPage />
      </ConfirmProvider>
    </LanguageProvider>,
  )
}

describe('CatalogsPage (Ajustes → Catálogos)', () => {
  beforeEach(() => {
    document.documentElement.lang = 'es'
    mocks.listCatalog.mockImplementation((resource: string) =>
      Promise.resolve(page(resource === 'maintenance-programs' ? PROGRAMAS : [])),
    )
    mocks.fetchCatalogs.mockResolvedValue({ peps: [], brands: [] })
    mocks.createCatalogEntry.mockResolvedValue({ id: 3 })
  })

  it('los programas de mantenimiento son un catálogo más, con su ciclo', async () => {
    renderPage()
    await userEvent.click(
      await screen.findByRole('tab', { name: 'Programas de mantenimiento' }),
    )
    await waitFor(() => expect(screen.getByText('Revisión general')).toBeInTheDocument())

    // El «cada cuánto» se lee en la tabla, en sus dos columnas.
    expect(screen.getByRole('columnheader', { name: /Cada \(km\)/ })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /Cada \(meses\)/ })).toBeInTheDocument()
    expect(screen.getByText('30000')).toBeInTheDocument()
    expect(screen.getByText('15000')).toBeInTheDocument()
  })

  it('el alta pide el nombre y el ciclo, y un ciclo vacío viaja como «no aplica»', async () => {
    renderPage()
    await userEvent.click(
      await screen.findByRole('tab', { name: 'Programas de mantenimiento' }),
    )
    await waitFor(() => expect(screen.getByText('Revisión general')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Crear' }))
    const dialogo = await screen.findByRole('dialog')
    // El campo de cada etiqueta (el DS no ata <label> e <input> por id).
    const campo = (label: string) =>
      within(dialogo).getByText(label).closest('div')!.querySelector('input')!
    await userEvent.type(campo('Nombre'), 'Neumáticos')
    await userEvent.type(campo('Cada (km)'), '40000')
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Crear' }))

    await waitFor(() => expect(mocks.createCatalogEntry).toHaveBeenCalled())
    expect(mocks.createCatalogEntry).toHaveBeenCalledWith('maintenance-programs', {
      name: 'Neumáticos',
      every_km: '40000',
      // Sin ciclo por tiempo: null, que es como el back guarda «no aplica»
      // (mandar '' lo rechazaría por no ser un entero).
      every_months: null,
      notes: '',
    })
  })
})
