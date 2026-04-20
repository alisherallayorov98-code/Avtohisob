import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './index.css'
import './lib/i18n'
import './stores/themeStore'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 4xx/5xx status kelsa qayta urinmaymiz — faqat network xatolarida 1 marta
      retry: (failureCount, error: any) => {
        const status = error?.response?.status
        if (status && status >= 400) return false
        return failureCount < 1
      },
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
)
