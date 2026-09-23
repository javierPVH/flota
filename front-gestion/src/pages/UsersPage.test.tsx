import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ConfirmProvider } from '../components/ConfirmDialog.tsx'
import { LanguageProvider } from '../i18n.tsx'

const mocks = vi.hoisted(() => ({
  listUsers: vi.fn(),
  listAll: vi.fn(),
  // Quién mira: mutable, que hay un caso que entra CON la cuenta del sistema.
  me: { id: 8, username: 'sara', roles: ['admin'] } as { id: number; username: string; roles: string[] },
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listUsers: mocks.listUsers,
  listAll: mocks.listAll,
}))

vi.mock('../auth.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth.ts')>()),
  // Por defecto mira Sara (id 8), que NO es la cuenta del sistema.
  useAuth: () => ({ user: mocks.me }),
}))

import { UsersPage } from './UsersPage.tsx'

const user = (over: Record<string, unknown>) => ({
  id: 1,
  username: 'carlos',
  name: 'Carlos Ruiz',
  first_name: 'Carlos',
  last_name: 'Ruiz',
  email: 'carlos@flota.dev',
  dni: '11111111H',
  phone: '613 211 313',
  license_type: 'B',
  fuel_card: false,
  roles: ['driver'],
  is_active: true,
  is_superuser: false,
  date_joined: '2026-01-10T09:00:00Z',
  ...over,
})

const ADMIN = user({ id: 2, username: 'admin', name: 'Alicia', roles: ['admin'], is_superuser: true })
const YO = user({ id: 8, username: 'sara', name: 'Sara Supervisora', roles: ['admin'] })
const OTRO = user({ id: 1 })

function renderPage() {
  return render(
    <LanguageProvider>
      <ConfirmProvider>
        <MemoryRouter>
          <UsersPage />
        </MemoryRouter>
      </ConfirmProvider>
    </LanguageProvider>,
  )
}

/** La tabla de arriba (las dos cuentas fijas) vive dentro de su sección. */
const ownTable = () =>
  within(document.querySelector('.users-own') as HTMLElement)

/** Nace plegada: hasta que no se despliega, sus botones no están en el árbol. */
async function desplegar() {
  const cabecera = await screen.findByRole('button', { name: 'Tu cuenta y la de administración' })
  fireEvent.click(cabecera)
  return cabecera
}

/** Teclea en la barra de filtros de la página (no en la del modal de exportar). */
function buscar(container: HTMLElement, texto: string) {
  const input = container.querySelector('#users-search') as HTMLInputElement
  fireEvent.change(input, { target: { value: texto } })
}

describe('UsersPage — la cuenta del sistema y la propia van aparte', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.me = { id: 8, username: 'sara', roles: ['admin'] }
    document.documentElement.lang = 'es'
    mocks.listUsers.mockResolvedValue({ count: 3, results: [] })
    mocks.listAll.mockResolvedValue([ADMIN, YO, OTRO])
  })

  it('las pinta arriba y las QUITA del listado de abajo', async () => {
    const { container } = renderPage()
    await desplegar()

    const arriba = ownTable()
    expect(arriba.getByText('Alicia')).toBeInTheDocument()
    expect(arriba.getByText('Sara Supervisora')).toBeInTheDocument()
    expect(arriba.queryByText('Carlos Ruiz')).not.toBeInTheDocument()

    // Abajo queda el resto, y el contador de la barra cuadra con esa tabla.
    const todas = screen.getAllByText('Carlos Ruiz')
    expect(todas).toHaveLength(1)
    expect(screen.getAllByText('Alicia')).toHaveLength(1)
    expect(container.querySelector('.filter-count')?.textContent).toBe('1')
  })

  it('la tarjeta nace plegada y se despliega al pulsar su cabecera', async () => {
    renderPage()
    const cabecera = await screen.findByRole('button', {
      name: 'Tu cuenta y la de administración',
    })
    expect(cabecera).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(cabecera)
    expect(cabecera).toHaveAttribute('aria-expanded', 'true')
    expect(ownTable().getByText('Alicia')).toBeInTheDocument()
  })

  it('la barra de búsqueda también filtra esas dos filas', async () => {
    const { container } = renderPage()
    await desplegar()
    expect(ownTable().getByText('Alicia')).toBeInTheDocument()

    // Buscando a Sara, arriba se queda solo ella (y abajo, nadie).
    buscar(container, 'sara')
    await waitFor(() => expect(ownTable().queryByText('Alicia')).not.toBeInTheDocument())
    expect(ownTable().getByText('Sara Supervisora')).toBeInTheDocument()
    expect(container.querySelector('.filter-count')?.textContent).toBe('0')
  })

  it('la cuenta del sistema no se edita ni se desactiva', async () => {
    renderPage()
    await desplegar()

    const fila = ownTable().getByText('Alicia').closest('tr') as HTMLElement
    expect(within(fila).queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument()
    expect(within(fila).queryByRole('button', { name: 'Desactivar' })).not.toBeInTheDocument()
    // Y dice por qué no hay botones, que es lo que un hueco vacío no explica.
    expect(within(fila).getByText('Cuenta del sistema')).toBeInTheDocument()
  })

  it('la propia SÍ se edita, pero no se desactiva, y su fila va marcada', async () => {
    renderPage()
    await desplegar()

    const fila = ownTable().getByText('Sara Supervisora').closest('tr') as HTMLElement
    expect(within(fila).getByRole('button', { name: 'Editar' })).toBeInTheDocument()
    expect(within(fila).queryByRole('button', { name: 'Desactivar' })).not.toBeInTheDocument()
    expect(within(fila).getByText('Tu cuenta')).toBeInTheDocument()
    // El fondo propio: en dos registros casi iguales, cuál es el tuyo no se
    // averigua leyendo el nombre de usuario.
    expect(fila.className).toContain('row-self')
    const otra = ownTable().getByText('Alicia').closest('tr') as HTMLElement
    expect(otra.className).not.toContain('row-self')
  })

  it('entrando CON la cuenta del sistema, esa fila sí se edita', async () => {
    // Alicia es el superusuario: una sola fila arriba, que es las dos cosas.
    mocks.me = { id: 2, username: 'admin', roles: ['admin'] }
    renderPage()
    await desplegar()

    const fila = ownTable().getByText('Alicia').closest('tr') as HTMLElement
    expect(fila.className).toContain('row-self')
    // Corregir tu propia ficha tiene que poder hacerse desde algún sitio.
    expect(within(fila).getByRole('button', { name: 'Editar' })).toBeInTheDocument()
    // Desactivarla sigue sin ofrecerse, y el hueco dice las DOS razones.
    expect(within(fila).queryByRole('button', { name: 'Desactivar' })).not.toBeInTheDocument()
    expect(within(fila).getByText('Tu cuenta, y la del sistema')).toBeInTheDocument()
    expect(ownTable().queryByText('Sara Supervisora')).not.toBeInTheDocument()
  })

  it('el filtro por rol separa en dos grupos y combina también con HSE', async () => {
    const { container } = renderPage()
    await screen.findByText('Carlos Ruiz')

    const select = container.querySelector('.role-filter select') as HTMLSelectElement
    const grupos = [...select.querySelectorAll('optgroup')].map((g) => g.label)
    expect(grupos).toEqual(['Con este rol', 'Exactamente estos roles'])

    const valores = [...select.querySelectorAll('option')].map((o) => o.value)
    // Los cuatro sueltos, cada combinación de dos o más, y los dos extremos.
    expect(valores).toEqual([
      '',
      'admin',
      'supervisor',
      'driver',
      'hse',
      'admin,supervisor',
      'admin,driver',
      'driver,supervisor',
      'admin,hse',
      'hse,supervisor',
      'driver,hse',
      'admin,driver,supervisor',
      'admin,hse,supervisor',
      'admin,driver,hse',
      'driver,hse,supervisor',
      'admin,driver,hse,supervisor',
      'none',
    ])

    // La etiqueta se lee en el orden de siempre (admin manda, HSE mira).
    const cuatro = [...select.querySelectorAll('option')].find(
      (o) => o.value === 'admin,driver,hse,supervisor',
    )
    expect(cuatro?.textContent).toBe('Admin · Supervisor · Conductor · HSE')
  })

  it('el resto de la gente conserva sus dos acciones', async () => {
    renderPage()
    const nombre = await screen.findByText('Carlos Ruiz')
    const fila = nombre.closest('tr') as HTMLElement
    expect(within(fila).getByRole('button', { name: 'Editar' })).toBeInTheDocument()
    expect(within(fila).getByRole('button', { name: 'Desactivar' })).toBeInTheDocument()
  })

  it('sin cuenta del sistema entre los cargados, arriba solo va la propia', async () => {
    mocks.listAll.mockResolvedValue([YO, OTRO])
    renderPage()
    await desplegar()
    await waitFor(() => expect(ownTable().getByText('Sara Supervisora')).toBeInTheDocument())
    expect(ownTable().queryByText('Alicia')).not.toBeInTheDocument()
  })
})
