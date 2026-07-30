import { Suspense, lazy, type ComponentType } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { RequireAuth } from './auth.ts'
import { AdminGate } from './components/AdminGate.tsx'
import { ConfirmProvider } from './components/ConfirmDialog.tsx'
import { Layout } from './components/Layout.tsx'
// El login queda estático: es el primer paint y no debe esperar a un chunk.
import { LoginPage } from './pages/LoginPage.tsx'

// PF2: TODAS las páginas internas son perezosas — el bundle inicial se queda
// en shell + login y cada vista carga su chunk al navegar.
function page<T extends Record<string, ComponentType>>(
  loader: () => Promise<T>,
  name: keyof T & string,
) {
  return lazy(() => loader().then((m) => ({ default: m[name] })))
}

const DashboardPage = page(() => import('./pages/DashboardPage.tsx'), 'DashboardPage')
const VehiclesPage = page(() => import('./pages/VehiclesPage.tsx'), 'VehiclesPage')
const VehicleDetailPage = page(() => import('./pages/VehicleDetailPage.tsx'), 'VehicleDetailPage')
const VehicleFormPage = page(() => import('./pages/VehicleFormPage.tsx'), 'VehicleFormPage')
const IncidentsPage = page(() => import('./pages/IncidentsPage.tsx'), 'IncidentsPage')
const ProposalsPage = page(() => import('./pages/ProposalsPage.tsx'), 'ProposalsPage')
const MileagePage = page(() => import('./pages/MileagePage.tsx'), 'MileagePage')
const AlertsPage = page(() => import('./pages/AlertsPage.tsx'), 'AlertsPage')
const ReportsPage = page(() => import('./pages/ReportsPage.tsx'), 'ReportsPage')
const RequestsPage = page(() => import('./pages/RequestsPage.tsx'), 'RequestsPage')
const InvoicesPage = page(() => import('./pages/InvoicesPage.tsx'), 'InvoicesPage')
const CatalogsPage = page(() => import('./pages/CatalogsPage.tsx'), 'CatalogsPage')
const UsersPage = page(() => import('./pages/UsersPage.tsx'), 'UsersPage')
const UserDetailPage = page(() => import('./pages/UserDetailPage.tsx'), 'UserDetailPage')
const ErratasPage = page(() => import('./pages/ErratasPage.tsx'), 'ErratasPage')
const EmailTemplatesPage = page(
  () => import('./pages/EmailTemplatesPage.tsx'),
  'EmailTemplatesPage',
)
// PF2: el ui-kit era una ruta PÚBLICA en producción — ahora solo existe en dev
// (el import dinámico condicionado deja el chunk fuera del build de prod).
const UiKitPage = import.meta.env.DEV
  ? page(() => import('./pages/UiKitPage.tsx'), 'UiKitPage')
  : null

const fallback = <p className="loading-state" role="status">Cargando…</p>

export default function App() {
  return (
    <Suspense fallback={fallback}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        {/* QA visual del design system — SOLO en desarrollo. */}
        {UiKitPage && <Route path="/ui-kit" element={<UiKitPage />} />}
        <Route
          element={
            <RequireAuth>
              <AdminGate>
                <ConfirmProvider>
                  <Layout />
                </ConfirmProvider>
              </AdminGate>
            </RequireAuth>
          }
        >
          <Route path="/" element={<DashboardPage />} />
          <Route path="/vehiculos" element={<VehiclesPage />} />
          <Route path="/vehiculos/nuevo" element={<VehicleFormPage />} />
          <Route path="/vehiculos/:id" element={<VehicleDetailPage />} />
          <Route path="/vehiculos/:id/editar" element={<VehicleFormPage />} />
          <Route path="/incidencias" element={<IncidentsPage />} />
          <Route path="/propuestas" element={<ProposalsPage />} />
          <Route path="/kilometraje" element={<MileagePage />} />
          <Route path="/alertas" element={<AlertsPage />} />
          <Route path="/informes" element={<ReportsPage />} />
          <Route path="/solicitudes" element={<RequestsPage />} />
          <Route path="/facturas" element={<InvoicesPage />} />
          <Route path="/catalogos" element={<CatalogsPage />} />
          <Route path="/erratas" element={<ErratasPage />} />
          <Route path="/plantillas" element={<EmailTemplatesPage />} />
          <Route path="/conductores" element={<UsersPage />} />
          <Route path="/conductores/:id" element={<UserDetailPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
