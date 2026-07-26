import { Navigate, Route, Routes } from 'react-router-dom'

import { RequireAuth } from './auth.ts'
import { AdminGate } from './components/AdminGate.tsx'
import { ConfirmProvider } from './components/ConfirmDialog.tsx'
import { Layout } from './components/Layout.tsx'
import { LoginPage } from './pages/LoginPage.tsx'
import { DashboardPage } from './pages/DashboardPage.tsx'
import { VehiclesPage } from './pages/VehiclesPage.tsx'
import { VehicleDetailPage } from './pages/VehicleDetailPage.tsx'
import { VehicleFormPage } from './pages/VehicleFormPage.tsx'
import { IncidentsPage } from './pages/IncidentsPage.tsx'
import { ProposalsPage } from './pages/ProposalsPage.tsx'
import { MileagePage } from './pages/MileagePage.tsx'
import { AlertsPage } from './pages/AlertsPage.tsx'
import { ReportsPage } from './pages/ReportsPage.tsx'
import { RequestsPage } from './pages/RequestsPage.tsx'
import { InvoicesPage } from './pages/InvoicesPage.tsx'
import { CatalogsPage } from './pages/CatalogsPage.tsx'
import { UsersPage } from './pages/UsersPage.tsx'
import { UserDetailPage } from './pages/UserDetailPage.tsx'
import { UiKitPage } from './pages/UiKitPage.tsx'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {/* QA visual del design system (dev). Público: sin auth ni backend. */}
      <Route path="/ui-kit" element={<UiKitPage />} />
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
        <Route path="/conductores" element={<UsersPage />} />
        <Route path="/conductores/:id" element={<UserDetailPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
