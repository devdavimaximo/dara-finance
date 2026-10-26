import { QueryCache, QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider, type PersistQueryClientOptions } from '@tanstack/react-query-persist-client'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { ApiError } from './lib/api'
import { isNetworkError } from './lib/network'
import { CACHE_MAX_AGE, persister, registerMutationDefaults } from './lib/offline'
import './index.css'

const qc: QueryClient = new QueryClient({
  // Sessão expirou no meio do uso: volta para o login.
  queryCache: new QueryCache({
    onError: (err) => {
      if (!(err instanceof ApiError)) return
      if (err.status === 401) qc.setQueryData(['me'], null)
      // Senha redefinida pelo admin enquanto o app estava aberto: vai para a tela de criar senha.
      if (err.code === 'password_change_required') qc.invalidateQueries({ queryKey: ['me'] })
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 20_000,
      gcTime: CACHE_MAX_AGE, // precisa ser ≥ maxAge para o cache persistido sobreviver
      refetchOnWindowFocus: true,
      networkMode: 'offlineFirst',
      retry: (n, err) => !isNetworkError(err) && !(err instanceof ApiError && err.status < 500) && n < 2,
    },
  },
})
registerMutationDefaults(qc)

const persistOptions: Omit<PersistQueryClientOptions, 'queryClient'> = {
  persister,
  maxAge: CACHE_MAX_AGE,
  buster: 'razao-v2',
  dehydrateOptions: {
    // Guarda toda consulta com dados — inclusive as que estão em "erro" porque a última
    // tentativa falhou por falta de rede (os dados anteriores continuam válidos).
    shouldDehydrateQuery: (q) => q.state.data !== undefined,
    // E as alterações ainda não enviadas ao servidor.
    shouldDehydrateMutation: (m) => m.state.isPaused || m.state.status === 'pending',
  },
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={qc}
      persistOptions={persistOptions}
      // Alterações feitas offline numa sessão anterior: envia assim que possível.
      // Sem `return`: o provider espera a promise do onSuccess para liberar a tela, e offline
      // ela só resolve quando a rede voltar.
      onSuccess={() => { void qc.resumePausedMutations() }}
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </PersistQueryClientProvider>
  </StrictMode>,
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}
