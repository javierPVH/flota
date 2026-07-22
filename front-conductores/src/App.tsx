import { Navigate, Route, Routes } from 'react-router-dom'

import { RequireAuth } from './auth.ts'
import { AccessGate } from './components/AccessGate.tsx'
import { Layout } from './components/Layout.tsx'
import { LoginPage } from './pages/LoginPage.tsx'
import { MyVehiclesPage } from './pages/MyVehiclesPage.tsx'
import { AlertsPage } from './pages/AlertsPage.tsx'
import { RegisterKmPage } from './pages/RegisterKmPage.tsx'
import { VehicleFieldPage } from './pages/VehicleFieldPage.tsx'
import { RequestAccessPage } from './pages/RequestAccessPage.tsx'
import { SinFlotaPage } from './pages/SinFlotaPage.tsx'

export default function App() {
  return (
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
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
