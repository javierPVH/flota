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
  listVehiclesCached: vi.fn(),
  fetchVehicleSummariesCached: vi.fn(),
  disablePushOnLogout: vi.fn(),
}))

// FE-3: la baja del push al salir, mockeada para afirmar el ORDEN respecto al
// cierre de sesión y que su fallo no lo impide.
vi.mock('../push.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../push.ts')>()),
  disablePushOnLogout: mocks.disablePushOnLogout,
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  createKmReading: mocks.createKmReading,
  registerItv: mocks.registerItv,
  uploadDocument: mocks.uploadDocument,
  // R4-07: los datos del shell, mockeados para poder afirmar el REFRESCO
  // tras un flush con envíos (dataVersion).
  listVehiclesCached: mocks.listVehiclesCached,
  fetchVehicleSummariesCached: mocks.fetchVehicleSummariesCached,
}))

// R4-07: el `user` debe tener identidad ESTABLE — el efecto de datos del shell
// lo lleva en las deps, y un objeto nuevo por render lo ponía en bucle (solo
// en el test: el useAuth real lo sirve estable desde el contexto).
const STABLE_AUTH = {
  user: { id: 1, username: 'ana', first_name: 'Ana', last_name: 'Pérez', roles: ['driver'] },
  logout: vi.fn(),
}

// El cierre en el servidor se espera y se comprueba: por defecto confirma.
const closeServerSession = vi.fn(async () => true)

vi.mock('../auth.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth.ts')>()),
  useAuth: () => STABLE_AUTH,
  closeServerSession: () => closeServerSession(),
}))

import { Layout } from './Layout.tsx'
import { LanguageProvider } from '../i18n.tsx'
import { clearQueue, enqueue, setQueueOwner } from '../offline/queue.ts'

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
  // FE-2: lo que se encola en estos tests es del usuario del shell (id 1), que
  // es contra quien `flush` compara al montar.
  setQueueOwner(1)
  await clearQueue()
  vi.clearAllMocks()
  mocks.disablePushOnLogout.mockResolvedValue(undefined)
  // Los datos del shell: vacíos y estables (lo que afirmamos es CUÁNTAS veces
  // se piden, no su contenido).
  mocks.listVehiclesCached.mockResolvedValue({ count: 0, results: [] })
  mocks.fetchVehicleSummariesCached.mockResolvedValue([])
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

  it('R4-07: un flush con envíos refresca los datos del shell (dataVersion)', async () => {
    setOnline(false)
    await enqueue(KM)

    renderShell()
    const banner = await screen.findByRole('button', { name: /sin enviar/ })
    // Carga inicial del shell: una petición de vehículos.
    await waitFor(() => expect(mocks.listVehiclesCached).toHaveBeenCalledTimes(1))

    mocks.createKmReading.mockResolvedValue({})
    await userEvent.click(banner)

    expect(await screen.findByText('1 registro pendiente enviado.')).toBeInTheDocument()
    // El envío sube dataVersion → el shell relee (el km reenviado ya cuenta).
    await waitFor(() => expect(mocks.listVehiclesCached).toHaveBeenCalledTimes(2))
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

describe('cerrar sesión (FE-3: el push se da de baja ANTES y nunca lo impide)', () => {
  beforeEach(drain)

  it('da de baja el push y después cierra la sesión y va al login', async () => {
    const orden: string[] = []
    mocks.disablePushOnLogout.mockImplementation(async () => {
      orden.push('push')
    })
    STABLE_AUTH.logout.mockImplementation(() => {
      orden.push('logout')
    })
    renderShell()

    await userEvent.click(await screen.findByRole('button', { name: 'Salir' }))

    await waitFor(() => expect(STABLE_AUTH.logout).toHaveBeenCalledTimes(1))
    // El DELETE de la suscripción va autenticado: primero el push, luego salir.
    expect(orden).toEqual(['push', 'logout'])
  })

  it('si la baja del push falla, se sale igual', async () => {
    mocks.disablePushOnLogout.mockRejectedValue(new TypeError('Failed to fetch'))
    renderShell()

    await userEvent.click(await screen.findByRole('button', { name: 'Salir' }))

    await waitFor(() => expect(STABLE_AUTH.logout).toHaveBeenCalledTimes(1))
    expect(mocks.disablePushOnLogout).toHaveBeenCalledTimes(1)
  })

  it('si el servidor no confirma el cierre, NO se sale y se dice', async () => {
    closeServerSession.mockResolvedValueOnce(false)
    renderShell()

    await userEvent.click(await screen.findByRole('button', { name: 'Salir' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudo cerrar la sesión/)
    expect(STABLE_AUTH.logout).not.toHaveBeenCalled()
    // Se puede reintentar: el botón sigue vivo.
    closeServerSession.mockResolvedValueOnce(true)
    await userEvent.click(screen.getByRole('button', { name: 'Salir' }))
    await waitFor(() => expect(STABLE_AUTH.logout).toHaveBeenCalledTimes(1))
  })
})

describe('avatar del header', () => {
  beforeEach(drain)

  it('es un enlace a Mi perfil (mis datos y mis documentos)', async () => {
    renderShell()

    const avatar = await screen.findByRole('link', { name: /Mi perfil/ })
    expect(avatar).toHaveAttribute('href', '/perfil')
    // Las iniciales siguen siendo la pista visual de quién está dentro.
    expect(avatar).toHaveTextContent('AP')
  })
})
