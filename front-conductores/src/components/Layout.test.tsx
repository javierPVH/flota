// IndexedDB no existe en jsdom: fake-indexeddb lo aporta ANTES de importar la cola.
import 'fake-indexeddb/auto'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createKmReading: vi.fn(),
  registerItv: vi.fn(),
  uploadDocument: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  createKmReading: mocks.createKmReading,
  registerItv: mocks.registerItv,
  uploadDocument: mocks.uploadDocument,
}))

vi.mock('../auth.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth.ts')>()),
  useAuth: () => ({
    user: { id: 1, username: 'ana', first_name: 'Ana', last_name: 'Pérez', roles: ['driver'] },
    logout: vi.fn(),
  }),
}))

import { Layout } from './Layout.tsx'
import { LanguageProvider } from '../i18n.tsx'
import { enqueue, flush } from '../offline/queue.ts'

const KM = {
  kind: 'km' as const,
  payload: { vehicle: 1, km_reading: 32000, reading_date: '2026-07-22' },
}

/** jsdom arranca online; el hook auto-reenvía al montar, así que los tests de
 * banner fijan `navigator.onLine = false` ANTES de renderizar. */
function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value })
}

function renderShell() {
  return render(
    <LanguageProvider>
      <MemoryRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<p>home</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </LanguageProvider>,
  )
}

async function drain() {
  // Vacía la cola entre tests (la BD fake persiste dentro del proceso).
  setOnline(true)
  mocks.createKmReading.mockResolvedValue({})
  mocks.registerItv.mockResolvedValue({})
  mocks.uploadDocument.mockResolvedValue({})
  await flush()
  vi.clearAllMocks()
}

describe('cola offline en el shell (banner → flush → aviso)', () => {
  beforeEach(drain)
  afterEach(() => setOnline(true))

  it('con pendientes y sin red: banner con contador y punto en la pestaña', async () => {
    setOnline(false)
    await enqueue(KM)
    await enqueue(KM)

    const { container } = renderShell()

    expect(
      await screen.findByRole('button', { name: '2 registros sin enviar — toca para reintentar' }),
    ).toBeInTheDocument()
    expect(container.querySelector('.tab-dot')).not.toBeNull()
    // Sin red no se intenta enviar nada al montar.
    expect(mocks.createKmReading).not.toHaveBeenCalled()
  })

  it('tocar el banner reenvía: aviso de enviados y banner/punto fuera', async () => {
    setOnline(false)
    await enqueue(KM)

    const { container } = renderShell()
    const banner = await screen.findByRole('button', {
      name: '1 registro sin enviar — toca para reintentar',
    })

    mocks.createKmReading.mockResolvedValue({})
    await userEvent.click(banner)

    expect(await screen.findByText('1 registro pendiente enviado.')).toBeInTheDocument()
    expect(mocks.createKmReading).toHaveBeenCalledWith(KM.payload)
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /sin enviar/ })).not.toBeInTheDocument()
    })
    expect(container.querySelector('.tab-dot')).toBeNull()
  })

  it('un rechazo del servidor se avisa y NO se reencola', async () => {
    setOnline(false)
    await enqueue(KM)

    renderShell()
    const banner = await screen.findByRole('button', { name: /sin enviar/ })

    mocks.createKmReading.mockRejectedValue(new Error('km_reading: El odómetro no puede retroceder'))
    await userEvent.click(banner)

    expect(
      await screen.findByText(/Rechazados por el servidor: km_reading: El odómetro no puede retroceder/),
    ).toBeInTheDocument()
    // Descartado (reenviarlo repetiría el rechazo): el banner desaparece.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /sin enviar/ })).not.toBeInTheDocument()
    })
  })

  it('al volver la conexión se reenvía solo (evento online)', async () => {
    setOnline(false)
    await enqueue(KM)

    renderShell()
    await screen.findByRole('button', { name: /sin enviar/ })

    mocks.createKmReading.mockResolvedValue({})
    setOnline(true)
    window.dispatchEvent(new Event('online'))

    expect(await screen.findByText('1 registro pendiente enviado.')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /sin enviar/ })).not.toBeInTheDocument()
    })
  })
})
