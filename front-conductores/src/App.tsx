import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { RequireAuth } from './auth.ts'
import { AccessGate } from './components/AccessGate.tsx'
import { Layout } from './components/Layout.tsx'
import { LoginPage } from './pages/LoginPage.tsx'
import { MyVehiclesPage } from './pages/MyVehiclesPage.tsx'

// M7: rutas secundarias en chunks propios (presupuesto de JS móvil). Login y
// "Mis vehículos" van en el bundle principal: son la primera pintura.
const AlertsPage = lazy(() => import('./pages/AlertsPage.tsx').then((m) => ({ default: m.AlertsPage })))
const GroupPage = lazy(() => import('./pages/GroupPage.tsx').then((m) => ({ default: m.GroupPage })))
const NewIncidentPage = lazy(() =>
  import('./pages/NewIncidentPage.tsx').then((m) => ({ default: m.NewIncidentPage })),
)
const RegisterKmPage = lazy(() =>
  import('./pages/RegisterKmPage.tsx').then((m) => ({ default: m.RegisterKmPage })),
)
const VehicleFieldPage = lazy(() =>
  import('./pages/VehicleFieldPage.tsx').then((m) => ({ default: m.VehicleFieldPage })),
)
const RequestAccessPage = lazy(() =>
  import('./pages/RequestAccessPage.tsx').then((m) => ({ default: m.RequestAccessPage })),
)
const SinFlotaPage = lazy(() =>
  import('./pages/SinFlotaPage.tsx').then((m) => ({ default: m.SinFlotaPage })),
)

const fallback = <p className="gate-checking">Cargando…</p>

export default function App() {
  return (
    <Suspense fallback={fallback}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        {/* Pantallas del portón: requieren sesión pero NO tener vehículo. */}
        <Route
          path="/solicitar"
          element={
            <RequireAuth>
              <RequestAccessPage />
            </RequireAuth>
          }
        />
        <Route
          path="/sin-flota"
          element={
            <RequireAuth>
              <SinFlotaPage />
            </RequireAuth>
          }
        />
        {/* App de campo: solo con vehículo/flota (AccessGate decide). */}
        <Route
          element={
            <RequireAuth>
              <AccessGate>
                <Layout />
              </AccessGate>
            </RequireAuth>
          }
        >
          <Route path="/" element={<MyVehiclesPage />} />
          <Route path="/vehiculos/:id" element={<VehicleFieldPage />} />
          <Route path="/registrar" element={<RegisterKmPage />} />
          <Route path="/alertas" element={<AlertsPage />} />
          <Route path="/grupo" element={<GroupPage />} />
          <Route path="/grupo/incidencias/nueva" element={<NewIncidentPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
