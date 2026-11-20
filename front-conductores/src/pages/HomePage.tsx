import { lazy, Suspense } from 'react'
import { useOutletContext } from 'react-router-dom'

import { useAuth } from '../auth.ts'
import { HelpWelcome } from '../components/HelpLinks.tsx'
import type { LayoutContext } from '../components/Layout.tsx'
import { useLang } from '../i18n.tsx'
import { MyVehiclesPage } from './MyVehiclesPage.tsx'

// La flota es la rama del supervisor: en chunk propio (M7), el conductor no la paga.
const FleetPage = lazy(() => import('./FleetPage.tsx').then((m) => ({ default: m.FleetPage })))

/**
 * La home sigue al switch del shell: "Mi vehículo" (la vista personal de
 * siempre) o "Flota" (la lista a cargo del supervisor, por grupos de estado).
 * Para el conductor no hay switch y esto es siempre su vehículo.
 *
 * El Suspense va AQUÍ y no fuera: mientras baja el chunk de la flota solo
 * espera el contenido — el shell (header, switch, nav) no parpadea.
 */
export function HomePage() {
  const ctx = useOutletContext<LayoutContext | null>()
  const { t } = useLang()
  const { user } = useAuth()
  // La primera vez, una tarjeta pequeña con el vídeo y la ayuda (no tapa nada:
  // se cierra con «Ahora no» y no vuelve a salir en este dispositivo).
  const welcome = user ? <HelpWelcome userId={user.id} /> : null
  if (ctx?.fleetMode) {
    return (
      <>
        {welcome}
        <Suspense fallback={<p role="status" className="gate-checking">{t.common.loading}</p>}>
          <FleetPage />
        </Suspense>
      </>
    )
  }
  return (
    <>
      {welcome}
      <MyVehiclesPage onGoFleet={ctx ? () => ctx.setFleetMode(true) : undefined} />
    </>
  )
}
