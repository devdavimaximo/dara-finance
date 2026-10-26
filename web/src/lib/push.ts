import { api } from './api'

/** Web Push no aparelho atual. No iPhone só funciona com o app instalado na Tela de Início (iOS 16.4+). */
export const pushSupported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

async function registration() {
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) throw new Error('O app precisa estar publicado (build de produção) para receber avisos.')
  return navigator.serviceWorker.ready
}

export async function currentSubscription() {
  if (!pushSupported()) return null
  const reg = await navigator.serviceWorker.getRegistration()
  return reg ? reg.pushManager.getSubscription() : null
}

export async function enablePush() {
  if (!pushSupported()) throw new Error('Este navegador não suporta avisos.')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Permissão de notificação negada. Libere nas configurações do navegador.')
  const reg = await registration()
  const { publicKey } = await api<{ publicKey: string }>('/push/key')
  const sub = (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }))
  const json = sub.toJSON()
  const device = /iphone|ipad/i.test(navigator.userAgent) ? 'iPhone' : /android/i.test(navigator.userAgent) ? 'Android' : 'Computador'
  await api('/push/subscribe', { method: 'POST', body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, device }) })
}

export async function disablePush() {
  const sub = await currentSubscription()
  if (!sub) return
  await api('/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {})
  await sub.unsubscribe()
}
