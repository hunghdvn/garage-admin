import { Routes, Route, Navigate } from 'react-router-dom'
import { LoginPage } from './pages/LoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { SettingsPage } from './pages/SettingsPage'
import { AppShell } from './components/AppShell'
import { useAuth } from './auth/AuthContext'
import { BucketsPage } from './pages/BucketsPage'
import { BucketDetailPage } from './pages/BucketDetailPage'
import { KeysPage } from './pages/KeysPage'
import { KeyDetailPage } from './pages/KeyDetailPage'
import { ClusterPage } from './pages/ClusterPage'

export function App() {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/buckets" element={<BucketsPage />} />
        <Route path="/buckets/:id" element={<BucketDetailPage />} />
        <Route path="/keys" element={<KeysPage />} />
        <Route path="/keys/:id" element={<KeyDetailPage />} />
        <Route path="/cluster" element={<ClusterPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  )
}
