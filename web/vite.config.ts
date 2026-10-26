import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Gera /sw.js no build a partir de sw-template.js, com a lista de todos os arquivos
 * do build para pré-carregar (o app inteiro abre offline, inclusive telas nunca visitadas).
 */
function serviceWorker(): Plugin {
  return {
    name: 'razao-sw',
    apply: 'build',
    generateBundle(_, bundle) {
      // Fontes de alfabetos que o app não usa ficam de fora (o navegador nem baixa, pelo unicode-range).
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map') && f !== 'index.html' && !/(cyrillic|greek|vietnamese)/.test(f))
      const precache = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/favicon-32.png', '/favicon-48.png', '/logo-mark.png', ...files.map((f) => `/${f}`)]
      const version = createHash('sha1').update(files.sort().join('|')).digest('hex').slice(0, 10)
      const source = readFileSync(new URL('./sw-template.js', import.meta.url), 'utf8')
        .replace('__VERSION__', version)
        .replace('__PRECACHE__', JSON.stringify(precache))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), serviceWorker()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:5180' },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        // Bibliotecas em pedaços próprios: mudam raramente, ficam em cache entre deploys.
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (/recharts|d3-|victory-vendor|decimal\.js|eventemitter3|immer|reselect|redux/.test(id)) return 'charts'
          if (/react-dom|react-router|scheduler|[\/]react[\/]/.test(id)) return 'react'
          if (/@tanstack|idb-keyval/.test(id)) return 'data'
          if (/lucide-react/.test(id)) return 'icons'
        },
      },
    },
  },
})
