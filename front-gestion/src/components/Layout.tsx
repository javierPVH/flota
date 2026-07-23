import { useEffect } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { Base } from '@flota/ui/ui'

import { AppHeader } from './AppHeader.tsx'

export function Layout() {
  const navigate = useNavigate()

  // Atajos de teclado (G12): "/" enfoca la búsqueda de la página; "n" abre el
  // alta de vehículo. Nunca mientras se escribe en un campo.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      )
        return
      if (event.key === '/') {
        const search = document.querySelector<HTMLInputElement>('input[type="search"]')
        if (search) {
          event.preventDefault()
          search.focus()
        }
      } else if (event.key.toLowerCase() === 'n' && !event.ctrlKey && !event.metaKey) {
        navigate('/vehiculos/nuevo')
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [navigate])

  return (
    <Base
      header={<AppHeader />}
      section={{ content: <Outlet /> }}
      footer={{ brand: 'Flota', contact: 'Gestión de flota Console' }}
    />
  )
}
