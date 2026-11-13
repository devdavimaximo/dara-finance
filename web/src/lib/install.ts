import { useEffect, useState } from 'react'
import { isIos, isStandalone } from './push'

/**
 * Instalar o app (PWA). Android/Chrome/Edge disparam `beforeinstallprompt` uma vez, cedo:
 * guardamos o evento aqui (o módulo é importado no main.tsx) para o botão chamar depois.
 * No iPhone não existe API: o botão mostra o passo a passo do Safari.
 */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: InstallPromptEvent | null = null
let installed = typeof window !== 'undefined' && isStandalone()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault() // sem a mini-barra do Chrome: quem oferece é o nosso botão
    deferred = e as InstallPromptEvent
    emit()
  })
  window.addEventListener('appinstalled', () => { installed = true; deferred = null; emit() })
}

export type InstallMode = 'prompt' | 'ios' | null

const currentMode = (): InstallMode => {
  if (installed || isStandalone()) return null
  if (deferred) return 'prompt'
  if (isIos()) return 'ios'
  return null // navegador sem suporte (ex.: Firefox desktop) ou já instalado: nada a oferecer
}

export function useInstall() {
  const [mode, setMode] = useState<InstallMode>(currentMode)
  useEffect(() => {
    const update = () => setMode(currentMode())
    listeners.add(update)
    update()
    return () => { listeners.delete(update) }
  }, [])

  const prompt = async () => {
    if (!deferred) return
    const e = deferred
    deferred = null // o evento só pode ser usado uma vez
    await e.prompt()
    const { outcome } = await e.userChoice
    if (outcome === 'accepted') installed = true
    emit()
  }

  return { mode, prompt }
}
