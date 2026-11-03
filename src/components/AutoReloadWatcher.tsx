'use client'

import { useEffect, useRef } from 'react'
import { isReloadBlocked } from '@/lib/reload-guard'

// Patch 30. Silent — no visible UI, no banner, no version label. Mounted
// once in the root layout, so it covers every page (store screen, owner,
// shift lead) from one place.
//
// The page's own build id is whatever NEXT_PUBLIC_BUILD_ID was at the
// moment THIS bundle was built (see next.config.ts) — a plain module-level
// constant, fixed for the page's whole lifetime. /api/version always
// reflects whatever's running on the server RIGHT NOW, so a mismatch means
// a newer deploy has happened since this tab opened.
const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? 'local-dev'

const CHECK_INTERVAL_MS = 5 * 60 * 1000
const IDLE_RECHECK_MS = 3000
const IDLE_THRESHOLD_MS = 30000
const LOOP_GUARD_MS = 10 * 60 * 1000
const LOG_KEY = 'ritas_autoreload_log'
const VERSION_FETCH_TIMEOUT_MS = 5000

// Loop guard: once localStorage proves unreadable/unwritable, this flips
// permanently true for the rest of the page's life and every future call
// just refuses to reload — erring on the side of doing nothing rather than
// risking a reload loop with no way to remember the last one.
let storageUnavailable = false

function canReloadNow(): boolean {
  if (storageUnavailable) return false
  try {
    const raw = localStorage.getItem(LOG_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (typeof parsed?.ts === 'number' && Date.now() - parsed.ts < LOOP_GUARD_MS) {
        return false
      }
    }
    return true
  } catch {
    storageUnavailable = true
    return false
  }
}

function recordReload(build: string) {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify({ ts: Date.now(), build }))
  } catch {
    storageUnavailable = true
  }
}

export default function AutoReloadWatcher() {
  const pendingRef = useRef(false)
  // 0 at render time (impure Date.now() can't run during render) -- set to
  // a real timestamp as soon as the effect below mounts.
  const lastActivityRef = useRef(0)

  useEffect(() => {
    lastActivityRef.current = Date.now()
    const markActivity = () => {
      lastActivityRef.current = Date.now()
    }
    window.addEventListener('pointerdown', markActivity, { passive: true })
    window.addEventListener('touchstart', markActivity, { passive: true })
    window.addEventListener('keydown', markActivity, { passive: true })
    window.addEventListener('scroll', markActivity, { passive: true, capture: true })
    return () => {
      window.removeEventListener('pointerdown', markActivity)
      window.removeEventListener('touchstart', markActivity)
      window.removeEventListener('keydown', markActivity)
      window.removeEventListener('scroll', markActivity, { capture: true })
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    // Failure safety: any error, timeout, or unexpected shape -- do
    // nothing. Never throws, never retries aggressively (the caller's own
    // interval controls cadence).
    const fetchVersion = async (): Promise<{ build: string; autoReload: boolean } | null> => {
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), VERSION_FETCH_TIMEOUT_MS)
        const res = await fetch('/api/version', { cache: 'no-store', signal: controller.signal })
        clearTimeout(timer)
        if (!res.ok) return null
        const data = await res.json()
        if (typeof data?.build !== 'string' || typeof data?.autoReload !== 'boolean') return null
        return data
      } catch {
        return null
      }
    }

    const checkVersion = async () => {
      const data = await fetchVersion()
      if (!data) return
      if (data.build !== BUILD_ID) pendingRef.current = true
    }

    const isIdleNow = (): boolean => {
      if (isReloadBlocked()) return false
      const active = document.activeElement as HTMLElement | null
      if (active) {
        const tag = active.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false
        if (active.isContentEditable) return false
      }
      if (Date.now() - lastActivityRef.current < IDLE_THRESHOLD_MS) return false
      return true
    }

    // Re-checked every few seconds while an update is pending (cheap,
    // local-only checks until everything looks safe) -- only then does it
    // touch the network again, right before actually reloading.
    const maybeReload = async () => {
      if (cancelled || !pendingRef.current) return
      if (!isIdleNow()) return

      const data = await fetchVersion()
      if (!data) return // fetch failed -- do not reload
      if (data.build === BUILD_ID) {
        pendingRef.current = false // somehow caught up already
        return
      }
      if (data.autoReload === false) return
      if (!canReloadNow()) return
      if (!isIdleNow()) return // re-verify right before the actual reload
      if (cancelled) return

      recordReload(data.build)
      window.location.reload()
    }

    checkVersion()
    const pollInterval = setInterval(checkVersion, CHECK_INTERVAL_MS)
    const idleInterval = setInterval(maybeReload, IDLE_RECHECK_MS)

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') checkVersion()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    // One-line hookup, feature-detected -- a new SW taking control usually
    // means a new deploy just landed.
    const onControllerChange = () => checkVersion()
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
    }

    return () => {
      cancelled = true
      clearInterval(pollInterval)
      clearInterval(idleInterval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
      }
    }
  }, [])

  return null
}
