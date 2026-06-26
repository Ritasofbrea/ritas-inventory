const CACHE_NAME = 'ritas-inventory-v1'

const STATIC_ASSETS = [
  '/',
  '/count',
  '/dashboard',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/Ritas_Logo_4c.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('push', (event) => {
  let data = { title: "Brea's Inventory", body: 'New update' }
  try { data = event.data.json() } catch {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      if (list.length > 0) return list[0].focus()
      return clients.openWindow('/dashboard')
    })
  )
})

self.addEventListener('fetch', (event) => {
  // API calls: network first, no cache
  if (event.request.url.includes('/api/')) {
    event.respondWith(fetch(event.request))
    return
  }

  // Everything else: network first, fall back to cache
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const clone = res.clone()
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone))
        return res
      })
      .catch(() => caches.match(event.request))
  )
})
