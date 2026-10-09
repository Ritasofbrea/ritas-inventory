'use client'

import { useCallback, useEffect, useState } from 'react'
import { formatDateTime } from '@/lib/tasks'

type PinName = 'owner' | 'shift_lead'
const PIN_LABELS: Record<PinName, string> = { owner: 'Owner PIN', shift_lead: 'Shift Lead PIN' }

const segBtn = (active: boolean) =>
  `flex-1 min-h-[44px] rounded-xl text-sm font-semibold border transition-colors ${
    active ? 'bg-[#1a7a3c] text-white border-[#1a7a3c]' : 'bg-white text-gray-600 border-gray-200'
  }`

// Owner-only: change the Owner or Shift Lead login PIN, stored in Supabase
// (the `pins` table) rather than the NEXT_PUBLIC_OWNER_PIN / _SHIFT_LEAD_PIN
// env vars — this is the only place those PINs can be changed without a
// Vercel redeploy. Same trust model as everywhere else in the app: a correct
// PIN check gates the form, not real server-side auth.
export default function PinManagementView() {
  const [which, setWhich] = useState<PinName>('owner')
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [lastChanged, setLastChanged] = useState<Record<PinName, string | null>>({ owner: null, shift_lead: null })
  const [loading, setLoading] = useState(true)

  const loadLastChanged = useCallback(async () => {
    try {
      const res = await fetch('/api/pins')
      if (!res.ok) throw new Error()
      const rows: { name: PinName; updated_at: string }[] = await res.json()
      const next: Record<PinName, string | null> = { owner: null, shift_lead: null }
      rows.forEach((r) => { next[r.name] = r.updated_at })
      setLastChanged(next)
    } catch {
      // not critical — the form still works without this
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadLastChanged()
  }, [loadLastChanged])

  const save = async () => {
    setError('')
    setNotice('')
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
      setNotice(`✓ ${PIN_LABELS[which]} changed.`)
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

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500 font-medium">Which PIN?</label>
          <div className="flex gap-2">
            <button type="button" className={segBtn(which === 'owner')} onClick={() => { setWhich('owner'); setError(''); setNotice('') }}>Owner</button>
            <button type="button" className={segBtn(which === 'shift_lead')} onClick={() => { setWhich('shift_lead'); setError(''); setNotice('') }}>Shift Lead</button>
          </div>
          {!loading && (
            <p className="text-xs text-gray-400 mt-1">
              {lastChanged[which] ? `Last changed ${formatDateTime(lastChanged[which] as string)}` : 'Not yet changed'}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500 font-medium">Current {PIN_LABELS[which]}</label>
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
