'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { setRole, setOwnerName, setShiftLeadName, clearRole } from '@/lib/auth'
import { fetchSession } from '@/lib/client-session'
import { LOGIN_MESSAGE_KEY } from '@/components/SessionGuard'

export default function LoginPage() {
  const router = useRouter()
  const [showPinEntry, setShowPinEntry] = useState(false)
  const [pinRole, setPinRole] = useState<'owner' | 'shift_lead'>('owner')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [notice, setNotice] = useState('')
  const [checkingSession, setCheckingSession] = useState(true)

  // Patch 29 added auto-skip for ANY valid session here; patch 30's fix
  // narrows it back to staff only. Staff auto-skip is the point of a
  // returning store-screen device (one-time pick, then never again for 365
  // days) and is safe now that Home/Switch (Navigation.tsx) awaits the
  // logout call before navigating here — so a deliberate logout always
  // clears the cookie first. Owner and shift_lead sessions now match how
  // this screen behaved before patch 29: always show the three buttons,
  // never auto-skip, even if a valid owner/shift_lead cookie exists — so
  // tapping Switch/Home can never bounce back to a page the person is
  // trying to leave, no race possible either way.
  useEffect(() => {
    try {
      const msg = sessionStorage.getItem(LOGIN_MESSAGE_KEY)
      if (msg) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: resolve once on mount, this app's standard page-load pattern
        setNotice(msg)
        sessionStorage.removeItem(LOGIN_MESSAGE_KEY)
      }
    } catch {
      // ignore
    }
    fetchSession().then(({ role }) => {
      if (role === 'staff') {
        router.replace('/todo')
      } else {
        setCheckingSession(false)
      }
    })
  }, [router])

  const handleShiftLead = () => {
    setPinRole('shift_lead')
    setShowPinEntry(true)
    setError('')
    setPin('')
  }

  const handleOwnerClick = () => {
    setPinRole('owner')
    setShowPinEntry(true)
    setError('')
    setPin('')
  }

  // To-Do is open to everyone: no owner/shift_lead role is kept (so a
  // previously stored one can't carry over into the role-less To-Do view),
  // and — same as main, pre-patch-29 — no visible prompt of any kind here.
  // The only addition is a silent POST /api/session first, to give the
  // server a staff-tier session to check (named no one; see
  // src/app/api/session/route.ts) so staff-tier routes aren't wide open to
  // literally anyone with no cookie at all. Awaited (not fire-and-forget) so
  // the cookie actually exists before landing on /todo — otherwise the
  // page's first staff-tier fetch could 401 before the cookie arrives. No
  // loading state is shown for this; it's a single fast same-origin call,
  // same tap-to-todo feel as before. If it fails, still navigate — To-Do
  // stays reachable regardless, same as it always was.
  const handleTodo = async () => {
    clearRole()
    try {
      await fetch('/api/session', { method: 'POST' })
    } catch {
      // ignore — navigate anyway, see comment above
    }
    router.push('/todo')
  }

  // Both roles now check against named, individual PINs (owners: Josh/Gina;
  // shift leads: each person added via the owner-only management screen) —
  // equal access within each role either way, stored in Supabase so they can
  // be changed in-app instead of via Vercel env vars. There's no "who are
  // you" step before the PIN — whichever PIN matches is who logged in, and
  // the server tells us which one so it can be remembered for auto-fill.
  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setVerifying(true)
    try {
      const res = await fetch('/api/pins/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: pinRole, pin }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not verify PIN')
      if (body.valid) {
        setRole(pinRole)
        if (pinRole === 'owner' && body.name) setOwnerName(body.name)
        if (pinRole === 'shift_lead' && body.name) setShiftLeadName(body.name)
        router.push(pinRole === 'owner' ? '/dashboard' : '/count')
      } else {
        setError('Wrong PIN. Try again.')
        setPin('')
      }
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Could not check the PIN. Check your connection and try again.')
    } finally {
      setVerifying(false)
    }
  }

  if (checkingSession) {
    return (
      <div className="min-h-[100dvh] bg-[#1a7a3c] flex items-center justify-center">
        <p className="text-green-100">Loading…</p>
      </div>
    )
  }

  return (
    <div className="min-h-[100dvh] bg-[#1a7a3c] flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="flex justify-center mb-4">
            <Image src="/Ritas_Logo_4c.png" alt="Rita's Italian Ice" width={200} height={200} priority />
          </div>
          <p className="text-green-200 mt-1 font-medium tracking-wide">Brea Location – Inventory</p>
        </div>

        {notice && (
          <p className="text-center text-yellow-200 bg-black/20 rounded-xl py-2 px-3 mb-4 text-sm font-medium">{notice}</p>
        )}

        {!showPinEntry ? (
          <div className="flex flex-col gap-4">
            <p className="text-center text-green-100 font-medium mb-2">Who are you?</p>

            <button
              onClick={handleOwnerClick}
              className="w-full bg-white hover:bg-green-50 active:bg-green-100 text-[#1a7a3c] text-xl font-semibold py-5 rounded-2xl shadow-lg border-2 border-white transition-colors"
            >
              I&apos;m an Owner
            </button>

            <button
              onClick={handleShiftLead}
              className="w-full bg-[#c8102e] hover:bg-[#a50d26] active:bg-[#8a0b1f] text-white text-xl font-semibold py-5 rounded-2xl shadow-lg transition-colors"
            >
              I&apos;m a Shift Lead
            </button>

            <button
              onClick={handleTodo}
              className="w-full bg-yellow-400 hover:bg-yellow-300 active:bg-yellow-500 text-[#1a7a3c] text-xl font-semibold py-5 rounded-2xl shadow-lg transition-colors"
            >
              To-Do List
            </button>

            {error && (
              <p className="text-center text-[#c8102e] bg-white rounded-xl py-2 px-3 font-medium">{error}</p>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-xl p-6">
            <h2 className="text-xl font-bold text-[#1a7a3c] mb-4">{pinRole === 'owner' ? 'Owner PIN' : 'Shift Lead PIN'}</h2>
            <form onSubmit={handlePinSubmit} className="flex flex-col gap-4">
              <input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="Enter PIN"
                autoFocus
                disabled={verifying}
                className="w-full border-2 border-gray-200 rounded-xl px-4 py-4 text-2xl text-center tracking-widest focus:outline-none focus:border-[#1a7a3c] disabled:opacity-50"
              />
              {error && (
                <p className="text-[#c8102e] text-center font-medium">{error}</p>
              )}
              <button
                type="submit"
                disabled={verifying || !pin}
                className="w-full bg-[#c8102e] hover:bg-[#a50d26] disabled:bg-red-200 text-white text-lg font-semibold py-4 rounded-xl"
              >
                {verifying ? 'Checking…' : 'Sign In'}
              </button>
              <button
                type="button"
                onClick={() => setShowPinEntry(false)}
                disabled={verifying}
                className="text-gray-400 hover:text-gray-600 disabled:opacity-50 text-sm"
              >
                ← Back
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
