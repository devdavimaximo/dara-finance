import clsx from 'clsx'
import { Download, Share, SquarePlus } from 'lucide-react'
import { useState } from 'react'
import { useInstall } from '../lib/install'
import { Button, Sheet } from './ui'

/** Botão "Instalar app". Some sozinho quando o app já está instalado (ou o navegador não permite). */
export function InstallButton({ compact, className }: { compact?: boolean; className?: string }) {
  const { mode, prompt } = useInstall()
  const [iosHelp, setIosHelp] = useState(false)
  if (!mode) return null

  const onClick = () => (mode === 'prompt' ? void prompt() : setIosHelp(true))
  return (
    <>
      {compact ? (
        <button onClick={onClick} aria-label="Instalar app" title="Instalar app"
          className={clsx('grid size-11 shrink-0 place-items-center rounded-2xl text-fg-2 transition hover:bg-surface-2', className)}>
          <Download size={20} />
        </button>
      ) : (
        <button onClick={onClick}
          className={clsx('flex h-11 w-full items-center gap-3 rounded-xl px-3 text-[15px] font-semibold text-muted transition hover:bg-surface-2/60 hover:text-fg-2', className)}>
          <Download size={19} /> Instalar app
        </button>
      )}
      <Sheet open={iosHelp} onClose={() => setIosHelp(false)} title="Instalar no iPhone">
        <ol className="space-y-4 text-[15px]">
          <Step n={1}>Abra este site no <b>Safari</b> (no Chrome do iPhone o caminho é o mesmo, pelo menu de compartilhar).</Step>
          <Step n={2}>Toque em <b>Compartilhar</b> <Share size={16} className="inline -mt-1" /> na barra de baixo.</Step>
          <Step n={3}>Role e toque em <b>Adicionar à Tela de Início</b> <SquarePlus size={16} className="inline -mt-1" />.</Step>
          <Step n={4}>Toque em <b>Adicionar</b>. Depois abra o dara pelo ícone: ele fica em tela cheia e pode receber avisos.</Step>
        </ol>
        <Button className="mt-6 w-full" onClick={() => setIosHelp(false)}>Entendi</Button>
      </Sheet>
    </>
  )
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent text-sm font-bold text-accent-ink">{n}</span>
      <span className="pt-0.5">{children}</span>
    </li>
  )
}
