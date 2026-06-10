import React from 'react'
import ReactDOM from 'react-dom/client'
import { MantineProvider } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import { ModalsProvider } from '@mantine/modals'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import { App } from './App'
import { themes, loadThemeName, resolverFor } from './theme/themes'
import { AuthProvider } from './auth/AuthContext'
import { ClusterProvider } from './cluster/ClusterContext'

const queryClient = new QueryClient()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MantineProvider theme={themes[loadThemeName()]} cssVariablesResolver={resolverFor(loadThemeName())} defaultColorScheme="auto">
      <ModalsProvider>
      <Notifications />
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <ClusterProvider>
              <App />
            </ClusterProvider>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
      </ModalsProvider>
    </MantineProvider>
  </React.StrictMode>,
)
