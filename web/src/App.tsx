import { useIsRestoring } from '@tanstack/react-query'
import { WifiOff } from 'lucide-react'
import { lazy, Suspense, type ComponentType } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Empty, Spinner } from './components/ui'
import { useMe, useStatus } from './lib/api'
import { isNetworkError } from './lib/network'
import { SessionProvider } from './lib/session'

/**
 * Telas carregadas sob demanda. Se um deploy novo apagou o pedaço antigo do servidor
 * (aba aberta há dias), recarrega uma vez para pegar a versão nova.
 */
function page<P extends object = object>(load: () => Promise<Record<string, unknown>>, name: string) {
  return lazy<ComponentType<P>>(async () => {
    try {
      const m = await load()
      sessionStorage.removeItem('razao.reloaded')
      return { default: m[name] as ComponentType<P> }
    } catch (e) {
      if (!sessionStorage.getItem('razao.reloaded')) {
        sessionStorage.setItem('razao.reloaded', '1')
        location.reload()
      }
      throw e
    }
  })
}

const AuthPage = page<{ mode: 'login' | 'setup' }>(() => import('./pages/Auth'), 'AuthPage')
const ForcePasswordPage = page(() => import('./pages/Auth'), 'ForcePasswordPage')
const NoSpacePage = page(() => import('./pages/Auth'), 'NoSpacePage')
const DashboardPage = page(() => import('./pages/Dashboard'), 'DashboardPage')
const EntriesPage = page(() => import('./pages/Entries'), 'EntriesPage')
const ReportsPage = page(() => import('./pages/Reports'), 'ReportsPage')
const SettingsPage = page(() => import('./pages/Settings'), 'SettingsPage')
const ImportPage = page(() => import('./pages/Import'), 'ImportPage')
const PotesPage = page(() => import('./pages/Potes'), 'PotesPage')
const GoalDetailPage = page(() => import('./pages/GoalDetail'), 'GoalDetailPage')

export default function App() {
  const status = useStatus()
  const me = useMe()
  const restoring = useIsRestoring()

  // Enquanto o cache do aparelho é lido, nada de decidir entre login/offline/app.
  if (restoring || (status.isLoading && !status.data) || (me.isLoading && me.data === undefined)) return <Spinner className="min-h-dvh" />
  if (me.data === undefined && isNetworkError(me.error))
    return <div className="grid min-h-dvh place-items-center"><Empty icon={WifiOff} title="Sem conexão" hint="Conecte-se uma vez para entrar. Depois disso o app funciona offline." /></div>

  const auth = (mode: 'login' | 'setup') => <Suspense fallback={<Spinner className="min-h-dvh" />}><AuthPage mode={mode} /></Suspense>
  if (status.data?.needsSetup) return auth('setup')
  if (!me.data) return auth('login')
  if (me.data.mustChangePassword) return <Suspense fallback={<Spinner className="min-h-dvh" />}><ForcePasswordPage /></Suspense>
  if (me.data.workspaces.length === 0)
    return <Suspense fallback={<Spinner className="min-h-dvh" />}><NoSpacePage /></Suspense>

  return (
    <SessionProvider me={me.data}>
      <Layout>
        <Suspense fallback={<Spinner />}>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/lancamentos" element={<EntriesPage />} />
            <Route path="/relatorios" element={<ReportsPage />} />
            <Route path="/importar" element={<ImportPage />} />
            <Route path="/potes" element={<PotesPage />} />
            <Route path="/objetivos/:id" element={<GoalDetailPage />} />
            <Route path="/ajustes" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </Layout>
    </SessionProvider>
  )
}
