import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Entry, Me, Workspace } from './types'

const KEY = 'razao.workspace'

const read = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* modo privado */ } }

export interface EntryPreset { goalId?: string; paid?: boolean; categoryId?: string; description?: string }

interface Session {
  me: Me
  workspace: Workspace
  setWorkspace: (id: string) => void
  /** Abre o formulário de lançamento (novo ou edição). `preset` pré-preenche um novo (ex.: já ligado a um objetivo). */
  openEntry: (entry?: Entry | null, kind?: 'Expense' | 'Income', preset?: EntryPreset) => void
  entrySheet: { open: boolean; entry: Entry | null; kind: 'Expense' | 'Income'; preset?: EntryPreset }
  closeEntry: () => void
}

const Ctx = createContext<Session | null>(null)

export function SessionProvider({ me, children }: { me: Me; children: ReactNode }) {
  const [wid, setWid] = useState(() => read(KEY))
  const [entrySheet, setEntrySheet] = useState<Session['entrySheet']>({ open: false, entry: null, kind: 'Expense' })
  const workspace = me.workspaces.find((w) => w.id === wid) ?? me.workspaces[0]!

  const setWorkspace = useCallback((id: string) => { write(KEY, id); setWid(id) }, [])
  const openEntry = useCallback((entry?: Entry | null, kind: 'Expense' | 'Income' = 'Expense', preset?: EntryPreset) =>
    setEntrySheet({ open: true, entry: entry ?? null, kind: entry?.kind ?? kind, preset }), [])
  const closeEntry = useCallback(() => setEntrySheet((s) => ({ ...s, open: false })), [])

  const value = useMemo(
    () => ({ me, workspace, setWorkspace, openEntry, entrySheet, closeEntry }),
    [me, workspace, setWorkspace, openEntry, entrySheet, closeEntry],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSession() {
  const s = useContext(Ctx)
  if (!s) throw new Error('useSession fora do SessionProvider')
  return s
}

export type Theme = 'system' | 'light' | 'dark'
export const getTheme = (): Theme => (read('razao.theme') as Theme) || 'system'
export function setTheme(t: Theme) {
  if (t === 'system') { try { localStorage.removeItem('razao.theme') } catch { /* */ } delete document.documentElement.dataset.theme }
  else { write('razao.theme', t); document.documentElement.dataset.theme = t }
}
