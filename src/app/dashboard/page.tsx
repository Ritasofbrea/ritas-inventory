'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Navigation from '@/components/Navigation'
import { getRole } from '@/lib/auth'
import { Item, getStockStatus, CATEGORIES } from '@/lib/types'

interface ShortRecord {
  id: string
  created_at: string
  notes: string
  resolved: boolean
  order_history_items: { item_name: string; quantity: number; unit: string }[]
}

export default function DashboardPage() {
  const router = useRouter()
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [shorts, setShorts] = useState<ShortRecord[]>([])
  const [resolvingId, setResolvingId] = useState<string | null>(null)
  const [notifStatus, setNotifStatus] = useState<'idle' | 'requesting' | 'granted' | 'denied'>('idle')
  const [testResult, setTestResult] = useState<string | null>(null)

  useEffect(() => {
    const role = getRole()
    if (!role) { router.replace('/login'); return }
    if (role !== 'owner') { router.replace('/count'); return }
    fetchItems()
    fetchShorts()
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      setNotifStatus('granted')
    } else if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
      setNotifStatus('denied')
    }
  }, [router])

  const enableNotifications = async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
    setNotifStatus('requesting')
    try {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(registrations.map((r) => r.update()))

      const permission = await Notification.requestPermission()
      if (permission !== 'granted') { setNotifStatus('denied'); return }

      const reg = await navigator.serviceWorker.ready

      const existing = await reg.pushManager.getSubscription()
      if (existing) await existing.unsubscribe()

      // Convert base64url VAPID key to Uint8Array — required by Apple/W3C spec
      const rawKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!
      const padding = '='.repeat((4 - (rawKey.length % 4)) % 4)
      const base64 = (rawKey + padding).replace(/-/g, '+').replace(/_/g, '/')
      const applicationServerKey = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      })

      await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      })
      setNotifStatus('granted')
    } catch (e) {
      console.error('enable notifications error:', e)
      setNotifStatus('idle')
    }
  }

  const fetchItems = async () => {
    try {
      const res = await fetch('/api/items')
      const data = await res.json()
      setItems(data)
      setLastUpdated(new Date())
    } finally {
      setLoading(false)
    }
  }

  const fetchShorts = async () => {
    const res = await fetch('/api/order-history?type=short&unresolved=true')
    if (res.ok) {
      const data = await res.json()
      setShorts(Array.isArray(data) ? data : [])
    } else {
      console.error('fetchShorts failed', res.status, await res.text().catch(() => ''))
    }
  }

  const resolveShort = async (id: string) => {
    setResolvingId(id)
    await fetch('/api/order-history', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, resolved: true }) })
    setShorts((prev) => prev.filter((s) => s.id !== id))
    setResolvingId(null)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-400 text-lg">Loading…</p>
      </div>
    )
  }

  const outItems = items.filter((i) => getStockStatus(i) === 'out')
  const lowItems = items.filter((i) => getStockStatus(i) === 'low')
  const okItems = items.filter((i) => getStockStatus(i) === 'ok')

  const needsAttention = outItems.length + lowItems.length

  return (
    <div className="min-h-screen flex flex-col bg-[#d4edda]">
      <Navigation />

      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-6">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Order Dashboard</h1>
            {lastUpdated && (
              <p className="text-gray-400 text-sm mt-0.5">
                Updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            {notifStatus !== 'granted' && notifStatus !== 'denied' && (
              <button
                onClick={enableNotifications}
                disabled={notifStatus === 'requesting'}
                className="text-sm bg-[#c8102e] hover:bg-[#a00d24] text-white font-semibold px-3 py-1.5 rounded-lg disabled:opacity-60"
              >
                {notifStatus === 'requesting' ? 'Enabling…' : '🔔 Enable Notifications'}
              </button>
            )}
            {notifStatus === 'granted' && (
              <div className="flex gap-2">
                <button onClick={enableNotifications} className="text-sm text-green-700 border border-green-200 bg-green-50 hover:bg-green-100 px-3 py-1.5 rounded-lg">🔔 Notifications on</button>
                <button
                  onClick={async () => {
                    setTestResult('Sending…')
                    const r = await fetch('/api/send-push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Test', body: 'Push is working!' }) })
                    const d = await r.json()
                    setTestResult(d.failures?.length ? `Error: ${d.failures[0]}` : `Sent ${d.sent}/${d.total}`)
                    setTimeout(() => setTestResult(null), 6000)
                  }}
                  className="text-sm border border-gray-200 bg-white hover:bg-gray-50 px-3 py-1.5 rounded-lg text-gray-600"
                >
                  Test
                </button>
              </div>
            )}
            {notifStatus === 'denied' && (
              <span className="text-sm text-gray-500 border border-gray-200 px-3 py-1.5 rounded-lg">Notifications blocked</span>
            )}
            <button
              onClick={() => { fetchItems(); fetchShorts() }}
              className="text-sm text-blue-600 hover:text-blue-800 border border-blue-200 hover:border-blue-400 px-3 py-1.5 rounded-lg"
            >
              Refresh
            </button>
          </div>
        </div>

        {testResult && (
          <div className={`mb-4 px-4 py-3 rounded-xl text-sm font-medium ${testResult.startsWith('Error') ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>
            {testResult}
          </div>
        )}

        {/* Short shipment alerts */}
        {shorts.length > 0 && (
          <div className="mb-6 flex flex-col gap-3">
            {shorts.map((short) => (
              <div key={short.id} className="bg-red-600 text-white rounded-2xl px-5 py-4 shadow-md">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-lg flex items-center gap-2">
                      ⚠️ Short Shipment
                    </p>
                    <p className="text-red-100 text-sm mt-0.5">{new Date(short.created_at).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</p>
                    <ul className="mt-2 space-y-1">
                      {short.order_history_items.map((item, i) => (
                        <li key={i} className="text-sm font-semibold">
                          {item.item_name} — <span className="font-bold">{item.quantity} {item.unit} still outstanding</span>
                        </li>
                      ))}
                    </ul>
                    {short.notes && <p className="text-red-200 text-xs mt-2 italic">{short.notes}</p>}
                  </div>
                  <button
                    onClick={() => resolveShort(short.id)}
                    disabled={resolvingId === short.id}
                    className="flex-shrink-0 bg-white text-red-700 hover:bg-red-50 font-bold text-sm px-4 py-2 rounded-xl transition-colors disabled:opacity-60"
                  >
                    {resolvingId === short.id ? '…' : 'Resolved ✓'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Summary banner */}
        {needsAttention === 0 ? (
          <div className="bg-green-50 border border-green-200 rounded-2xl px-5 py-4 mb-6 flex items-center gap-3">
            <span className="text-2xl">✅</span>
            <p className="text-green-800 font-semibold text-lg">Everything is stocked!</p>
          </div>
        ) : (
          <div className="bg-red-50 border border-red-200 rounded-2xl px-5 py-4 mb-6">
            <p className="text-red-800 font-bold text-lg">
              {needsAttention} item{needsAttention !== 1 ? 's' : ''} need{needsAttention === 1 ? 's' : ''} ordering
            </p>
            <p className="text-red-600 text-sm mt-0.5">
              {outItems.length} out of stock · {lowItems.length} running low
            </p>
          </div>
        )}

        {/* OUT items */}
        {outItems.length > 0 && (
          <section className="mb-6">
            <h2 className="text-xs font-bold uppercase tracking-widest text-red-500 mb-3">
              Out of Stock – Order Now
            </h2>
            <div className="bg-white rounded-2xl shadow-sm border border-red-100 overflow-hidden">
              {outItems.map((item, idx) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  isLast={idx === outItems.length - 1}
                  badge="OUT"
                  badgeColor="bg-red-100 text-red-700"
                />
              ))}
            </div>
          </section>
        )}

        {/* LOW items */}
        {lowItems.length > 0 && (
          <section className="mb-6">
            <h2 className="text-xs font-bold uppercase tracking-widest text-amber-500 mb-3">
              Running Low – Order Soon
            </h2>
            <div className="bg-white rounded-2xl shadow-sm border border-amber-100 overflow-hidden">
              {lowItems.map((item, idx) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  isLast={idx === lowItems.length - 1}
                  badge="LOW"
                  badgeColor="bg-amber-100 text-amber-700"
                />
              ))}
            </div>
          </section>
        )}

        {/* OK items – collapsed summary */}
        {okItems.length > 0 && (
          <details className="mb-6">
            <summary className="cursor-pointer text-xs font-bold uppercase tracking-widest text-gray-400 mb-3 list-none flex items-center gap-2">
              <span>▶ Well Stocked ({okItems.length} items)</span>
            </summary>
            <div className="mt-3 bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              {CATEGORIES.map((cat) => {
                const catItems = okItems.filter((i) => i.category === cat)
                if (catItems.length === 0) return null
                return catItems.map((item, idx) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    isLast={idx === catItems.length - 1 && okItems[okItems.length - 1].id === item.id}
                    badge="OK"
                    badgeColor="bg-green-100 text-green-700"
                  />
                ))
              })}
            </div>
          </details>
        )}
      </main>
    </div>
  )
}

function ItemRow({
  item,
  isLast,
  badge,
  badgeColor,
}: {
  item: Item
  isLast: boolean
  badge: string
  badgeColor: string
}) {
  return (
    <div
      className={`flex items-center gap-4 px-5 py-4 ${
        !isLast ? 'border-b border-gray-100' : ''
      }`}
    >
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-gray-900">{item.name}</p>
        <p className="text-sm text-gray-400">{item.category}</p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-sm text-gray-500">
          <span className="font-bold text-gray-900 text-lg">{item.current_count}</span>
          {' / '}
          <span className="text-gray-400">{item.par_level} {item.unit}</span>
        </p>
      </div>
      <span
        className={`flex-shrink-0 text-xs font-bold px-2.5 py-1 rounded-lg ${badgeColor}`}
      >
        {badge}
      </span>
    </div>
  )
}
