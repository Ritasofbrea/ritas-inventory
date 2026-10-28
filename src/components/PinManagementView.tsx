'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatDateTime } from '@/lib/tasks'
import { getRole, getOwnerName, getShiftLeadName } from '@/lib/auth'

const segBtn = (active: boolean) =>
  `flex-1 min-h-[44px] rounded-xl text-sm font-semibold border transition-colors ${
    active ? 'bg-[#1a7a3c] text-white border-[#1a7a3c]' : 'bg-white text-gray-600 border-gray-200'
  }`

// Self-service "change my own PIN" (current PIN required first) — not the
// owner-only Shift Lead management screen's reset, which doesn't need that.
// An owner can change Josh's or Gina's PIN (same as before); a shift lead
// can only change their own, never anyone else's — so the selectable list
// depends on who's actually logged in, rather than a fixed 3-way picker.
export default function PinManagementView() {
  const options = useMemo(() => {
    if (getRole() === 'owner') return ['Josh', 'Gina']
    const name = getShiftLeadName()
    return name ? [name] : []
  }, [])

  const [which, setWhich] = useState(options[0] ?? '')
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [lastChanged, setLastChanged] = useState<Record<string, string | null>>({})
  const [loading, setLoading] = useState(true)

  const loadLastChanged = useCallback(async () => {
    try {
      const res = await fetch('/api/pins')
      if (!res.ok) throw new Error()
      const rows: { name: string; updated_at: string }[] = await res.json()
      setLastChanged(Object.fromEntries(rows.map((r) => [r.name, r.updated_at])))
    } catch {
      // not critical — the form still works without this
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: fetches on mount, this app's standard load-on-mount pattern
    loadLastChanged()
  }, [loadLastChanged])

  const save = async () => {
    setError('')
    setNotice('')
    if (!which) return
    if (!current) return setError('Enter the current PIN.')
    if (!/^\d{4,6}$/.test(next)) return setError('New PIN must be 4-6 digits.')
    if (next !== confirm) return setError('New PIN and confirmation do not match.')

    setSaving(true)
    try {
      const res = await fetch('/api/pins', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: which, current_pin: current, new_pin: next }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not change PIN')
      setNotice(`✓ ${which === getOwnerName() || which === getShiftLeadName() ? 'Your' : `${which}'s`} PIN changed.`)
      setCurrent('')
      setNext('')
      setConfirm('')
      loadLastChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change PIN. Try again.')
    } finally {
      setSaving(false)
    }
  }

  if (options.length === 0) {
    return <p className="text-gray-400 text-center py-10">Could not determine who&apos;s logged in. Try logging in again.</p>
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex flex-col gap-4">
        {options.length > 1 && (
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Which PIN?</label>
            <div className="flex gap-2">
              {options.map((name) => (
                <button
                  key={name}
                  type="button"
                  className={segBtn(which === name)}
                  onClick={() => { setWhich(name); setError(''); setNotice('') }}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
        )}

        {!loading && (
          <p className="text-xs text-gray-400 -mt-2">
            {lastChanged[which] ? `Last changed ${formatDateTime(lastChanged[which] as string)}` : 'Not yet changed'}
          </p>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500 font-medium">Current {options.length > 1 ? `${which}'s PIN` : 'PIN'}</label>
          <input
            type="password"
            inputMode="numeric"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className="border border-gray-200 rounded-xl px-4 py-3 text-base text-gray-900 focus:outline-none focus:border-green-500"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500 font-medium">New PIN <span className="text-gray-400 font-normal">(4-6 digits)</span></label>
          <input
            type="password"
            inputMode="numeric"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            className="border border-gray-200 rounded-xl px-4 py-3 text-base text-gray-900 focus:outline-none focus:border-green-500"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500 font-medium">Confirm New PIN</label>
          <input
            type="password"
            inputMode="numeric"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="border border-gray-200 rounded-xl px-4 py-3 text-base text-gray-900 focus:outline-none focus:border-green-500"
          />
        </div>

        {error && <p className="text-red-500 text-sm">{error}</p>}
        {notice && <p className="text-green-600 text-sm font-semibold">{notice}</p>}

        <button
          onClick={save}
          disabled={saving}
          className="w-full bg-[#1a7a3c] hover:bg-[#155f2f] disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold py-3 rounded-xl"
        >
          {saving ? 'Saving…' : 'Change PIN'}
        </button>
      </div>
    </div>
  )
}
