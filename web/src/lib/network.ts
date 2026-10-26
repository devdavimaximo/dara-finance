import { onlineManager } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'

/**
 * Conectividade real, não só `navigator.onLine`: o celular pode dizer que está online
 * (Wi-Fi sem internet, VPS fora do ar) e mesmo assim o fetch falhar. Quando uma chamada à API
 * falha por rede, marcamos offline e sondamos /api/health até voltar.
 */
export class NetworkError extends Error {
  constructor() {
    super('Sem conexão com o servidor.')
    this.name = 'NetworkError'
  }
}

export const isNetworkError = (e: unknown): boolean => e instanceof NetworkError

let probe: ReturnType<typeof setInterval> | null = null

export function markOffline() {
  if (onlineManager.isOnline()) onlineManager.setOnline(false)
  if (probe) return
  probe = setInterval(async () => {
    try {
      const r = await fetch('/api/health', { cache: 'no-store' })
      if (r.ok) markOnline()
    } catch { /* continua offline */ }
  }, 8000)
}

export function markOnline() {
  if (probe) { clearInterval(probe); probe = null }
  onlineManager.setOnline(true)
}

// Eventos do navegador: "offline" é confiável; "online" só significa "tente de novo".
if (typeof window !== 'undefined') {
  window.addEventListener('offline', markOffline)
  window.addEventListener('online', () => {
    fetch('/api/health', { cache: 'no-store' }).then((r) => (r.ok ? markOnline() : markOffline())).catch(markOffline)
  })
  onlineManager.setEventListener(() => () => {}) // nós controlamos o estado
  if (!navigator.onLine) markOffline()
}

export const useOnline = () =>
  useSyncExternalStore(
    (cb) => onlineManager.subscribe(cb),
    () => onlineManager.isOnline(),
    () => true,
  )

/** UUID v4 — `crypto.randomUUID` só existe em contexto seguro (HTTPS/localhost). */
export const newId = () =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
        (Number(c) ^ (crypto.getRandomValues(new Uint8Array(1))[0]! & (15 >> (Number(c) / 4)))).toString(16))
