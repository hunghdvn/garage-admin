import React from 'react'
import ReactDOM from 'react-dom/client'
import { MantineProvider } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import { ModalsProvider } from '@mantine/modals'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router'
import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import 'h2d-glass-ui/styles.css'
import './i18n'
import { App } from './App'
import { Toaster } from 'h2d-glass-ui'
import { AuthProvider } from './auth/AuthContext'
import { ClusterProvider } from './cluster/ClusterContext'

const queryClient = new QueryClient()

// Apply stored color scheme to <html> for h2d-glass-ui theming.
const storedScheme = (localStorage.getItem('colorScheme') as 'light' | 'dark' | 'auto' | null) || 'auto'
const resolved = storedScheme === 'auto' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : storedScheme
document.documentElement.setAttribute('data-flg-theme', resolved)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MantineProvider defaultColorScheme="auto">
      <ModalsProvider>
      <Notifications />
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <ClusterProvider>
              <App />
              <Toaster />
            </ClusterProvider>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
      </ModalsProvider>
    </MantineProvider>
  </React.StrictMode>,
)