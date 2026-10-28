'use client'

import { useCallback, useEffect, useState } from 'react'
import ConfirmModal from './ConfirmModal'

interface ShiftLead {
  id: string
  name: string
  active: boolean
  created_at: string
  updated_at: string
}

// Owner-only: manage individual shift lead logins — list, add (name + initial
// PIN), deactivate (soft-delete, same pattern as staff/templates), and reset
// someone's PIN directly (no need to know their current one, since an owner
// doing this for someone else is different from that person's own self-service
// Change PIN flow — see PinManagementView).
export default function ShiftLeadView() {
  const [list, setList] = useState<ShiftLead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [newName, setNewName] = useState('')
  const [newPin, setNewPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [resetting, setResetting] = useState<ShiftLead | null>(null)
  const [resetPin, setResetPin] = useState('')
  const [deleting, setDeleting] = useState<ShiftLead | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/shift-leads')
      if (!res.ok) throw new Error()
      setList(await res.json())
    } catch {
      setError('Could not load shift leads. Try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: fetches on mount, this app's standard load-on-mount pattern
    load()
  }, [load])

  const add = async () => {
    setError('')
    if (!newName.trim()) return
    if (!/^\d{4,6}$/.test(newPin)) return setError('PIN must be 4-6 digits.')
    setBusy(true)
    try {
      const res = await fetch('/api/shift-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, pin: newPin }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not add')
      setNewName('')
      setNewPin('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (sl: ShiftLead) => {
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/shift-leads', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sl.id, active: !sl.active }),
      })
      if (!res.ok) throw new Error()
      await load()
    } catch {
      setError('Could not update. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const confirmReset = async () => {
    if (!resetting) return
    setError('')
    if (!/^\d{4,6}$/.test(resetPin)) return setError('PIN must be 4-6 digits.')
    setBusy(true)
    try {
      const res = await fetch('/api/shift-leads', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: resetting.id, pin: resetPin }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not reset PIN')
      setResetting(null)
      setResetPin('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reset PIN. Try again.')
    } finally {
      setBusy(false)
    }
  }

  // Permanent, only reachable once already inactive — the deactivate toggle
  // already blocks login on its own, so this is purely for clearing the list.
  const handleDelete = async () => {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      const res = await fetch('/api/shift-leads', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: deleting.id }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Could not delete. Try again.')
      setDeleting(null)
      await load()
    } catch (e) {
      setDeleting(null)
      setError(e instanceof Error ? e.message : 'Could not delete. Try again.')
    } finally {
      setDeleteBusy(false)
    }
  }

  if (loading) return <p className="text-gray-400 text-center py-10">Loading…</p>

  return (
    <div>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-4 flex flex-col gap-2">
        <div className="flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Name…"
            className="flex-1 min-w-0 border border-gray-200 rounded-xl px-4 py-3 text-gray-900 focus:outline-none focus:border-green-500"
          />
          <input
            type="password"
            inputMode="numeric"
            value={newPin}
            onChange={(e) => setNewPin(e.target.value)}
            placeholder="Initial PIN"
            className="w-32 border border-gray-200 rounded-xl px-3 py-3 text-gray-900 focus:outline-none focus:border-green-500"
          />
        </div>
        <button
          onClick={add}
          disabled={busy || !newName.trim() || !newPin}
          className="bg-[#1a7a3c] hover:bg-[#155f2f] disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold py-3 rounded-xl"
        >
          Add Shift Lead
        </button>
      </div>
      {error && <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3">{error}</div>}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {list.map((sl, idx) => (
          <div
            key={sl.id}
            className={`flex items-center gap-2 px-5 py-3 ${idx < list.length - 1 ? 'border-b border-gray-100' : ''} ${sl.active ? '' : 'opacity-50'}`}
          >
            <p className="flex-1 font-semibold text-gray-900">{sl.name}</p>
            <button
              onClick={() => { setResetting(sl); setResetPin(''); setError('') }}
              disabled={busy}
              className="min-h-[40px] px-3 rounded-xl text-sm font-semibold bg-blue-50 text-blue-600 disabled:opacity-50 flex-shrink-0"
            >
              Reset PIN
            </button>
            <button
              onClick={() => toggle(sl)}
              disabled={busy}
              className={`min-h-[40px] px-4 rounded-xl text-sm font-semibold disabled:opacity-50 flex-shrink-0 ${
                sl.active ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-700'
              }`}
            >
              {sl.active ? 'Remove' : 'Restore'}
            </button>
            {!sl.active && (
              <button
                onClick={() => setDeleting(sl)}
                disabled={busy}
                className="min-h-[40px] px-3 rounded-xl text-sm font-semibold bg-gray-100 text-gray-500 disabled:opacity-50 flex-shrink-0"
              >
                Delete
              </button>
            )}
          </div>
        ))}
        {list.length === 0 && <p className="text-gray-400 text-center py-6">No shift leads yet.</p>}
      </div>

      {resetting && (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4" onClick={() => setResetting(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
            <div>
              <h2 className="text-xl font-bold text-gray-900">Reset {resetting.name}&apos;s PIN</h2>
              <p className="text-sm text-gray-500 mt-1">No need to know their current PIN — you&apos;re the owner.</p>
            </div>
            <input
              type="password"
              inputMode="numeric"
              autoFocus
              value={resetPin}
              onChange={(e) => setResetPin(e.target.value)}
              placeholder="New PIN (4-6 digits)"
              className="border-2 border-gray-200 rounded-xl px-4 py-3 text-xl text-center tracking-widest focus:outline-none focus:border-green-500"
            />
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <div className="flex gap-3">
              <button
                onClick={() => setResetting(null)}
                disabled={busy}
                className="flex-1 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-600 font-semibold py-3 rounded-xl"
              >
                Cancel
              </button>
              <button
                onClick={confirmReset}
                disabled={busy || !resetPin}
                className="flex-1 bg-[#1a7a3c] hover:bg-[#155f2f] disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold py-3 rounded-xl"
              >
                {busy ? 'Saving…' : 'Reset PIN'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleting && (
        <ConfirmModal
          message={`Permanently delete ${deleting.name}? This can't be undone.`}
          busy={deleteBusy}
          onConfirm={handleDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  )
}
