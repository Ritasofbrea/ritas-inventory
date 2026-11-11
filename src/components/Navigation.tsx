'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { clearRole, getRole, getOwnerName } from '@/lib/auth'
import { useEffect, useRef, useState } from 'react'
import { Role } from '@/lib/types'
import { SKIP_LOGIN_AUTOSKIP_KEY } from '@/components/SessionGuard'
import { urgencyRank, formatTimeOfDay, vendorDisplayLabel, VendorDueStatus } from '@/lib/vendor-schedule'

const MORE_DROPDOWN_MARGIN = 16

const MORE_LINKS = [
  { href: '/count', label: 'Count Entry' },
  { href: '/receive-order', label: 'Receive Order' },
  { href: '/scan-invoice', label: 'Scan Invoice' },
  { href: '/adjust', label: 'Adjustment' },
  { href: '/par-settings', label: 'Par Levels' },
  { href: '/manage-items', label: 'Manage Items' },
  { href: '/vendor-schedules', label: 'Vendor Schedules' },
  { href: '/notification-settings', label: 'Notification Settings' },
  { href: '/reports', label: 'Reports' },
  { href: '/clover-mapping', label: 'Clover Mapping' },
  { href: '/staff', label: 'Staff' },
  { href: '/shift-leads', label: 'Shift Leads' },
  { href: '/flavors-catalog', label: 'Flavors Catalog' },
  { href: '/pin-settings', label: 'Change PIN' },
]

export default function Navigation() {
  const pathname = usePathname()
  const router = useRouter()
  const [role, setRole] = useState<Role | null>(null)
  const [roleLoaded, setRoleLoaded] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [moreTop, setMoreTop] = useState(80)
  const moreRef = useRef<HTMLDivElement>(null)
  const moreButtonRef = useRef<HTMLButtonElement>(null)
  const [notifStatus, setNotifStatus] = useState<'idle' | 'requesting' | 'granted' | 'denied'>('idle')
  const [linkMessage, setLinkMessage] = useState('')
  const [todoBadge, setTodoBadge] = useState(0)
  const [dueVendors, setDueVendors] = useState<{ vendor: string; cutoff_time: string; status: VendorDueStatus; itemCount: number }[]>([])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: resolve role once on mount, this app's standard page-load pattern
    setRole(getRole())
    setRoleLoaded(true)
    if (typeof Notification !== 'undefined') {
      if (Notification.permission === 'granted') setNotifStatus('granted')
      else if (Notification.permission === 'denied') setNotifStatus('denied')
    }
  }, [])

  // To-Do tab badge: open tasks due today (past-due ones become 'missed' and
  // drop out of this count). Refreshes on navigation and whenever the To-Do
  // page changes something (it fires 'tasks-changed').
  useEffect(() => {
    let cancelled = false
    const loadBadge = () => {
      fetch('/api/tasks?view=badge')
        .then((r) => r.json())
        .then((d) => { if (!cancelled && typeof d.count === 'number') setTodoBadge(d.count) })
        .catch(() => {})
    }
    loadBadge()
    window.addEventListener('tasks-changed', loadBadge)
    return () => {
      cancelled = true
      window.removeEventListener('tasks-changed', loadBadge)
    }
  }, [pathname])

  // Patch 44: persistent in-app banner for a vendor that's due today or
  // past cutoff — no snooze, same urgency set the push reminders use.
  // Owner-only (matches every vendor-schedule-aware screen). Fix (live
  // testing): this used to only refresh on navigation, so pressing "Order
  // Placed"/"Nothing to order" on /order-list never updated the banner
  // without leaving and coming back — it could keep saying overdue after
  // both vendors had already been marked. Now also listens for
  // 'vendor-status-changed' (same pattern as the To-Do badge's
  // 'tasks-changed'), fired by order-list/page.tsx right after a
  // successful press, so the banner updates immediately, same screen.
  useEffect(() => {
    if (role !== 'owner') return
    let cancelled = false
    const loadDueVendors = () => {
      fetch('/api/vendor-schedules')
        .then((r) => (r.ok ? r.json() : []))
        .then((rows: { vendor: string; cutoff_time: string; status: VendorDueStatus; itemCount: number }[]) => {
          if (cancelled) return
          setDueVendors(rows.filter((v) => (v.status === 'due_today' || v.status === 'overdue') && v.itemCount > 0))
        })
        .catch(() => {})
    }
    loadDueVendors()
    window.addEventListener('vendor-status-changed', loadDueVendors)
    return () => {
      cancelled = true
      window.removeEventListener('vendor-status-changed', loadDueVendors)
    }
  }, [role, pathname])

  // Bug fix: push_subscriptions.owner_name only gets set on this POST, but
  // the old code only ever ran it from a fresh "Enable Notifications" tap
  // — an owner whose browser already had permission (and an existing
  // subscription) saw the dropdown collapse to a static "🔔 Notifications
  // on" line with no button at all, so that device's row could never get
  // attributed to them, and order reminders could never reach it.
  //
  // `silent=true` is the auto-link path: runs on every mount for a logged-
  // in owner, and does NOTHING unless permission is already granted AND a
  // subscription already exists — it only ever re-sends what's already
  // there to keep owner_name current (e.g. after switching owners on a
  // shared device), never prompts, never creates a new subscription, never
  // touches notifStatus/linkMessage on failure. `silent=false` is the
  // explicit button tap: prompts for permission if needed, creates a
  // subscription if none exists, and always gives visible feedback.
  //
  // Either way, reuses an existing subscription instead of unsubscribing
  // and resubscribing (the old code's behavior) — POSTing the SAME
  // endpoint to /api/subscribe just updates that one row's owner_name
  // (upsert by endpoint), it never creates a duplicate.
  const linkNotifications = async (silent: boolean) => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
    if (!silent) {
      setNotifStatus('requesting')
      setLinkMessage('')
      setMoreOpen(false)
    }
    try {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(registrations.map((r) => r.update()))

      if (silent && Notification.permission !== 'granted') return
      const permission = silent ? Notification.permission : await Notification.requestPermission()
      if (permission !== 'granted') {
        if (!silent) setNotifStatus('denied')
        return
      }

      const reg = await navigator.serviceWorker.ready
      let sub = await reg.pushManager.getSubscription()
      if (!sub) {
        if (silent) return // auto-link only re-sends an EXISTING subscription, never creates one
        const rawKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!
        const padding = '='.repeat((4 - (rawKey.length % 4)) % 4)
        const base64 = (rawKey + padding).replace(/-/g, '+').replace(/_/g, '/')
        const applicationServerKey = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })
      }

      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      })
      if (!res.ok) throw new Error('subscribe failed')
      setNotifStatus('granted')
      if (!silent) setLinkMessage(`Notifications linked to ${getOwnerName() ?? 'you'}`)
    } catch (e) {
      console.error('enable notifications error:', e)
      if (!silent) {
        setNotifStatus('idle')
        setLinkMessage('Could not link notifications. Try again.')
      }
    }
  }

  const enableNotifications = () => linkNotifications(false)

  // Auto-heal on every page an owner opens — see linkNotifications' comment.
  // Also what keeps a shared device correctly attributed after switching
  // owners: as soon as the new owner's session loads a page, this re-sends
  // the browser's (unchanged) subscription under THEIR name, overwriting
  // whatever owner_name it had before.
  useEffect(() => {
    if (role !== 'owner') return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: auto-heal attempt on mount/role-change, same pattern as this file's own role-loading effect above
    linkNotifications(true)
  }, [role])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Patch 30 fix: must AWAIT the logout call before navigating. Firing it
  // and immediately pushing to /login (the old code) raced /login's own
  // session check against the cookie actually being cleared — if the GET
  // /api/session on /login's mount won that race, it would see the
  // still-valid old cookie and bounce straight back to that role's page
  // (most visibly: a staff session always wins that race back to /todo,
  // since /login auto-skips any valid staff session unconditionally,
  // making Home/Switch look like it does nothing). Awaiting guarantees the
  // cookie is gone, server- and browser-side, before /login ever checks.
  //
  // Hardening: a hung or failed request must never strand someone on this
  // page with a dead button. A 3s AbortController timeout bounds the wait,
  // and the try/catch covers both a network failure and that abort — either
  // way we still clear local state and navigate to /login. If the request
  // never actually reached the server, the cookie may still exist — for
  // owner/shift_lead that's fine (/login no longer auto-skips those), but a
  // lingering STAFF cookie would otherwise auto-skip straight back to
  // /todo, reproducing the original symptom via a real network failure
  // instead of a race. SKIP_LOGIN_AUTOSKIP_KEY tells /login to show the
  // three buttons this one time regardless, so a deliberate Home/Switch tap
  // always works even when logout couldn't actually reach the server.
  // Bug fix: on a shared device, logging out must not leave this device's
  // push subscription silently attributed to the owner who just left — if
  // it sits unattended with no one logging back in for a while, pushes
  // meant for THAT owner would keep landing on a device they're no longer
  // using. Unlinks (deletes, doesn't just null out) this browser's
  // push_subscriptions row while still authenticated as the outgoing
  // owner — the browser's own subscription object is untouched, so the
  // next owner to log in and open the app gets it re-attributed to them
  // automatically via the auto-link effect above, no re-prompt needed.
  // Owner-only (shift_lead/staff never have a push subscription to begin
  // with). Best-effort: a failure here must never block logging out.
  const unlinkNotificationsForLogout = async () => {
    if (role !== 'owner') return
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (!sub) return
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 2000)
      try {
        await fetch('/api/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timeout)
      }
    } catch {
      // best-effort — never block logout over this (timed out, failed, or no subscription API)
    }
  }

  const handleLogout = async () => {
    await unlinkNotificationsForLogout()
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 3000)
      try {
        await fetch('/api/logout', { method: 'POST', signal: controller.signal })
      } finally {
        clearTimeout(timeout)
      }
    } catch {
      // ignore -- timed out or failed; clear local state and navigate regardless
    }
    clearRole()
    try {
      sessionStorage.setItem(SKIP_LOGIN_AUTOSKIP_KEY, '1')
    } catch {
      // ignore — private browsing / storage blocked; worst case is the old
      // staff-auto-skip behavior if the logout request also failed
    }
    router.push('/login')
  }

  const navLink = (href: string, label: string, badge = 0) => (
    <Link
      href={href}
      className={`px-1.5 py-2 rounded-lg font-medium text-sm whitespace-nowrap transition-colors ${
        pathname === href
          ? 'bg-[#c8102e] text-white'
          : 'text-green-100 hover:bg-[#155f2f]'
      }`}
    >
      {label}
      {badge > 0 && (
        <span
          aria-label={`${badge} open`}
          className={`ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-bold leading-none ${
            pathname === href ? 'bg-white text-[#c8102e]' : 'bg-[#c8102e] text-white'
          }`}
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
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
            {role && (
              <span className="text-xs text-green-200">
                {role === 'owner' ? 'Owner' : 'Shift Lead'}
              </span>
            )}
            <button
              onClick={handleLogout}
              className="text-xs text-green-200 hover:text-white px-2 py-1 rounded border border-green-700 hover:border-white"
            >
              {!roleLoaded || role ? 'Switch' : 'Home'}
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
              {navLink('/todo', 'To-Do', todoBadge)}
              {navLink('/flavors', 'Flavors')}
              {navLink('/pin-settings', 'Change PIN')}
            </div>
          )}

          {/* No role: reached the To-Do List straight from the login screen.
              Flavors is read-only for this audience (patch 20) but still
              visible — same "anyone can look" tier as To-Do itself. */}
          {roleLoaded && role === null && (
            <div className="flex items-center gap-0.5">
              {navLink('/todo', 'To-Do', todoBadge)}
              {navLink('/flavors', 'Flavors')}
            </div>
          )}

          {role === 'owner' && (
            <>
              <div className="flex items-center gap-0.5 overflow-x-auto scrollbar-hide min-w-0">
                {navLink('/dashboard', 'Dashboard')}
                {navLink('/current-stock', 'Stock')}
                {navLink('/history', 'History')}
                {navLink('/order-list', 'Order List')}
                {navLink('/todo', 'To-Do', todoBadge)}
                {navLink('/flavors', 'Flavors')}
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
                      {notifStatus === 'denied' ? (
                        <span className="block px-4 py-2.5 text-sm text-gray-400">Notifications blocked</span>
                      ) : (
                        // Bug fix: this used to be a static, unclickable
                        // span once granted, with no way to re-link a
                        // device whose subscription existed before
                        // push_subscriptions.owner_name did. Always a real
                        // button now, so it can always be tapped again.
                        <button
                          onClick={enableNotifications}
                          disabled={notifStatus === 'requesting'}
                          className={`block w-full text-left px-4 py-2.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 ${notifStatus === 'granted' ? 'text-green-600' : 'text-gray-700'}`}
                        >
                          {notifStatus === 'requesting' ? 'Enabling…' : notifStatus === 'granted' ? '🔔 Notifications on (tap to relink)' : '🔔 Enable Notifications'}
                        </button>
                      )}
                      {linkMessage && <p className="px-4 pb-2 text-xs text-gray-500">{linkMessage}</p>}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

      </div>

      {role === 'owner' && dueVendors.length > 0 && (
        <button
          onClick={() => router.push('/order-list')}
          className="w-full bg-gray-800 hover:bg-gray-900 text-white text-sm font-semibold px-4 py-2 flex items-center justify-center gap-2 text-center"
        >
          {[...dueVendors].sort((a, b) => urgencyRank(a.status) - urgencyRank(b.status)).map((v, i) => (
            <span key={v.vendor}>
              {i > 0 && <span className="text-gray-400 mx-1">·</span>}
              {vendorDisplayLabel(v.vendor)} {v.status === 'overdue' ? 'is overdue' : `due by ${formatTimeOfDay(v.cutoff_time)}`} ({v.itemCount})
            </span>
          ))}
        </button>
      )}
    </nav>
  )
}
