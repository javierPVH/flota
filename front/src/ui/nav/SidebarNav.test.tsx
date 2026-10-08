import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { Base } from '../layout/Base.tsx'
import { SidebarNav, SidebarNavButton, SidebarNavGroup, SidebarNavItem } from './SidebarNav.tsx'

function sidebar(onLogout = vi.fn()) {
  return (
    <SidebarNav ariaLabel="Navegación" footer={<SidebarNavButton onClick={onLogout}>Salir</SidebarNavButton>}>
      <SidebarNavGroup title="Flota">
        <SidebarNavItem to="/vehiculos" count={3}>
          Vehículos
        </SidebarNavItem>
        <SidebarNavItem to="/conductores">Conductores</SidebarNavItem>
      </SidebarNavGroup>
    </SidebarNav>
  )
}

describe('SidebarNav', () => {
  it('marca el enlace de la ruta actual con aria-current y enseña el contador', () => {
    render(<MemoryRouter initialEntries={['/vehiculos']}>{sidebar()}</MemoryRouter>)
    expect(screen.getByRole('navigation', { name: 'Navegación' })).toBeInTheDocument()
    const vehicles = screen.getByRole('link', { name: /Vehículos/ })
    expect(vehicles).toHaveAttribute('aria-current', 'page')
    expect(vehicles).toHaveTextContent('3')
    expect(screen.getByRole('link', { name: 'Conductores' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('group', { name: 'Flota' })).toBeInTheDocument()
  })

  it('las acciones que no navegan son botones', () => {
    const onLogout = vi.fn()
    render(<MemoryRouter>{sidebar(onLogout)}</MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Salir' }))
    expect(onLogout).toHaveBeenCalledTimes(1)
  })
})

describe('Base con barra lateral', () => {
  it('pinta el <aside> etiquetado y, abierto, lleva el foco dentro y cierra con Escape', () => {
    const onDrawerOpenChange = vi.fn()
    render(
      <MemoryRouter>
        <Base
          sidebar={sidebar()}
          sidebarId="nav-lateral"
          sidebarLabel="Menú"
          drawerOpen
          onDrawerOpenChange={onDrawerOpenChange}
          section={{ content: <p>Contenido</p> }}
        />
      </MemoryRouter>,
    )
    const aside = screen.getByRole('complementary', { name: 'Menú' })
    expect(aside).toHaveAttribute('id', 'nav-lateral')
    expect(aside).toContainElement(document.activeElement as HTMLElement)
    expect(screen.getByRole('main')).toHaveTextContent('Contenido')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onDrawerOpenChange).toHaveBeenCalledWith(false)
  })

  it('sin barra lateral conserva el marco de siempre', () => {
    render(<Base section={{ content: <p>Contenido</p> }} />)
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    expect(screen.getByText('Contenido')).toBeInTheDocument()
  })
})
