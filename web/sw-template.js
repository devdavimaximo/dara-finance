/* Service worker do dara — gerado no build (vite.config.ts preenche VERSION e PRECACHE).
 * - Pré-carrega o app inteiro (todas as telas, fontes e ícones): abre e navega offline.
 * - Navegação: rede primeiro (com limite de tempo), cópia local se não houver rede.
 * - API: nunca passa por aqui — dados offline ficam no IndexedDB do app.
 * - Push: mostra o aviso de vencimento e abre o app ao tocar.
 */
const VERSION = '__VERSION__'
const CACHE = `razao-${VERSION}`
const PRECACHE = __PRECACHE__

self.addEventListener('install', (e) => {
  // cache: 'reload' ignora o cache HTTP: arquivos de nome fixo (ícones, manifest) vêm sempre na versão do deploy.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('razao-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))

self.addEventListener('fetch', (e) => {
  const req = e.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return

  if (req.mode === 'navigate') {
    // Wi-Fi ruim não pode travar a abertura: 3,5 s e cai para a cópia local.
    e.respondWith(
      Promise.race([fetch(req), timeout(3500)])
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('/', copy)) }
          return res
        })
        .catch(() => caches.match('/', { cacheName: CACHE }).then((r) => r || caches.match('/'))),
    )
    return
  }

  // Arquivos com hash no nome nunca mudam: cache primeiro.
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok && (url.pathname.startsWith('/assets/') || /\.(png|svg|webmanifest)$/.test(url.pathname))) {
        const copy = res.clone()
        caches.open(CACHE).then((c) => c.put(req, copy))
      }
      return res
    })),
  )
})

self.addEventListener('push', (e) => {
  let data = { title: 'dara', body: '', url: '/lancamentos', tag: 'razao' }
  try { data = { ...data, ...e.data.json() } } catch { /* payload vazio */ }
  e.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag,
    renotify: true,
    data: { url: data.url },
  }))
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const target = new URL(e.notification.data?.url || '/', location.origin).href
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const win = wins.find((w) => new URL(w.url).origin === location.origin)
      if (win) return win.focus().then(() => win.navigate(target))
      return self.clients.openWindow(target)
    }),
  )
})
