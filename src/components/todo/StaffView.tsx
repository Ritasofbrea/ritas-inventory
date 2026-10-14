'use client'

import { useCallback, useEffect, useState } from 'react'
import StaffName from '@/components/StaffName'
import { Staff } from '@/lib/tasks'

// Owner-only: manage the name list used by the picker. Deactivate instead of deleting.
export default function StaffView({ onChanged }: { onChanged: () => void }) {
  const [staff, setStaff] = useState<Staff[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/staff?all=true')
      if (!res.ok) throw new Error()
      setStaff(await res.json())
    } catch {
      setError('Could not load staff. Try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const add = async () => {
    if (!newName.trim()) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not add')
      setNewName('')
      await load()
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (s: Staff) => {
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/staff', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: s.id, active: !s.active }),
      })
      if (!res.ok) throw new Error()
      await load()
      onChanged()
    } catch {
      setError('Could not update. Try again.')
    } finally {
      setBusy(false)
    }
  }

  // Optional nice-to-have — not required for the color rendering itself,
  // just a quick way to set/clear it without going through SQL each time.
  const setColor = async (s: Staff, color: string | null) => {
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/staff', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: s.id, color }),
      })
      if (!res.ok) throw new Error()
      await load()
      onChanged()
    } catch {
      setError('Could not update. Try again.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <p className="text-gray-400 text-center py-10">Loading…</p>

  return (
    <div>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-4 flex gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="Add a name…"
          className="flex-1 min-w-0 border border-gray-200 rounded-xl px-4 py-3 text-gray-900 focus:outline-none focus:border-green-500"
        />
        <button
          onClick={add}
          disabled={busy || !newName.trim()}
          className="bg-[#1a7a3c] hover:bg-[#155f2f] disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold px-5 rounded-xl"
        >
          Add
        </button>
      </div>
      {error && <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3">{error}</div>}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {staff.map((s, idx) => (
          <div
            key={s.id}
            className={`flex items-center gap-3 px-5 py-3 ${idx < staff.length - 1 ? 'border-b border-gray-100' : ''} ${s.active ? '' : 'opacity-50'}`}
          >
            <p className="flex-1 font-semibold">
              <StaffName name={s.name} staff={staff} />
            </p>
            <input
              type="color"
              value={s.color ?? '#9ca3af'}
              onChange={(e) => setColor(s, e.target.value)}
              disabled={busy}
              aria-label={`Set ${s.name}'s color`}
              title={`Set ${s.name}'s color`}
              className="w-8 h-8 flex-shrink-0 rounded-lg border border-gray-200 disabled:opacity-50"
            />
            {s.color && (
              <button
                onClick={() => setColor(s, null)}
                disabled={busy}
                className="text-xs font-semibold text-gray-400 hover:text-gray-600 disabled:opacity-50 flex-shrink-0"
              >
                Clear
              </button>
            )}
            <button
              onClick={() => toggle(s)}
              disabled={busy}
              className={`min-h-[40px] px-4 rounded-xl text-sm font-semibold disabled:opacity-50 ${
                s.active ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-700'
              }`}
            >
              {s.active ? 'Remove' : 'Restore'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
