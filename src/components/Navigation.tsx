'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { clearRole, getRole } from '@/lib/auth'
import { useEffect, useRef, useState } from 'react'
import { Role } from '@/lib/types'

const MORE_DROPDOWN_MARGIN = 16

const MORE_LINKS = [
  { href: '/count', label: 'Count Entry' },
  { href: '/receive-order', label: 'Receive Order' },
  { href: '/adjust', label: 'Adjustment' },
  { href: '/par-settings', label: 'Par Levels' },
  { href: '/manage-items', label: 'Manage Items' },
  { href: '/reports', label: 'Reports' },
  { href: '/clover-mapping', label: 'Clover Mapping' },
]

export default function Navigation() {
  const pathname = usePathname()
  const router = useRouter()
  const [role, setRole] = useState<Role | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [moreTop, setMoreTop] = useState(80)
  const moreRef = useRef<HTMLDivElement>(null)
  const moreButtonRef = useRef<HTMLButtonElement>(null)
  const [notifStatus, setNotifStatus] = useState<'idle' | 'requesting' | 'granted' | 'denied'>('idle')

  useEffect(() => {
    setRole(getRole())
    if (typeof Notification !== 'undefined') {
      if (Notification.permission === 'granted') setNotifStatus('granted')
      else if (Notification.permission === 'denied') setNotifStatus('denied')
    }
  }, [])

  const enableNotifications = async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
    setNotifStatus('requesting')
    setMoreOpen(false)
    try {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(registrations.map((r) => r.update()))
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') { setNotifStatus('denied'); return }
      const reg = await navigator.serviceWorker.ready
      const existing = await reg.pushManager.getSubscription()
      if (existing) await existing.unsubscribe()
      const rawKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!
      const padding = '='.repeat((4 - (rawKey.length % 4)) % 4)
      const base64 = (rawKey + padding).replace(/-/g, '+').replace(/_/g, '/')
      const applicationServerKey = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })
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

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleLogout = () => {
    clearRole()
    router.push('/login')
  }

  const navLink = (href: string, label: string) => (
    <Link
      href={href}
      className={`px-1.5 py-2 rounded-lg font-medium text-sm whitespace-nowrap transition-colors ${
        pathname === href
          ? 'bg-[#c8102e] text-white'
          : 'text-green-100 hover:bg-[#155f2f]'
      }`}
    >
      {label}
    </Link>
  )

  const moreActive = MORE_LINKS.some((l) => l.href === pathname)

  return (
    <nav className="bg-[#1a7a3c] border-b border-[#155f2f] sticky top-0 z-50">
      <div className="max-w-5xl mx-auto px-4">

        {/* Top row: logo + title + switch */}
        <div className="flex items-center justify-between py-2">
          <div className="flex items-center gap-2">
            <Image src="/Ritas_Logo_4c.png" alt="Rita's" width={32} height={32} className="rounded-full flex-shrink-0" />
            <span className="font-bold text-white text-base tracking-wide">
              Brea&apos;s Inventory
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-green-200">
              {role === 'owner' ? 'Owner' : 'Shift Lead'}
            </span>
            <button
              onClick={handleLogout}
              className="text-xs text-green-200 hover:text-white px-2 py-1 rounded border border-green-700 hover:border-white"
            >
              Switch
            </button>
          </div>
        </div>

        {/* Bottom row: nav tabs — scrollable on mobile */}
        <div className="flex items-center gap-0.5 pb-2">
          {role === 'shift_lead' && (
            <div className="flex items-center gap-0.5 overflow-x-auto scrollbar-hide">
              {navLink('/count', 'Count Entry')}
              {navLink('/receive-order', 'Receive Order')}
              {navLink('/adjust', 'Adjustment')}
            </div>
          )}

          {role === 'owner' && (
            <>
              <div className="flex items-center gap-0.5 overflow-x-auto scrollbar-hide min-w-0">
                {navLink('/dashboard', 'Dashboard')}
                {navLink('/current-stock', 'Stock')}
                {navLink('/order-list', 'Order List')}
                {navLink('/history', 'History')}
              </div>

              <div className="relative flex-shrink-0" ref={moreRef}>
                <button
                  ref={moreButtonRef}
                  onClick={() => {
                    if (moreButtonRef.current) {
                      setMoreTop(moreButtonRef.current.getBoundingClientRect().bottom + 4)
                    }
                    setMoreOpen((o) => !o)
                  }}
                  className={`flex items-center gap-0.5 px-1.5 py-2 rounded-lg font-medium text-sm whitespace-nowrap transition-colors ${
                    moreActive
                      ? 'bg-[#c8102e] text-white'
                      : 'text-green-100 hover:bg-[#155f2f]'
                  }`}
                >
                  More
                  <svg className={`w-3 h-3 transition-transform ${moreOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {moreOpen && (
                  <div className="fixed bg-white rounded-xl border border-gray-300 py-1 min-w-[180px] z-[9999]" style={{ top: moreTop, right: MORE_DROPDOWN_MARGIN, boxShadow: '0 8px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.12)' }}>
                    {MORE_LINKS.map((l) => (
                      <Link
                        key={l.href}
                        href={l.href}
                        onClick={() => setMoreOpen(false)}
                        className={`block px-4 py-2.5 text-sm font-medium transition-colors ${
                          pathname === l.href
                            ? 'text-[#c8102e] bg-red-50'
                            : 'text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        {l.label}
                      </Link>
                    ))}
                    <div className="border-t border-gray-100 mt-1 pt-1">
                      {notifStatus === 'granted' ? (
                        <span className="block px-4 py-2.5 text-sm text-green-600 font-medium">🔔 Notifications on</span>
                      ) : notifStatus === 'denied' ? (
                        <span className="block px-4 py-2.5 text-sm text-gray-400">Notifications blocked</span>
                      ) : (
                        <button
                          onClick={enableNotifications}
                          disabled={notifStatus === 'requesting'}
                          className="block w-full text-left px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                          {notifStatus === 'requesting' ? 'Enabling…' : '🔔 Enable Notifications'}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

      </div>
    </nav>
  )
}
