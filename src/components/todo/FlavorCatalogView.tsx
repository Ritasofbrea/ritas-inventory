'use client'

import { useCallback, useEffect, useState } from 'react'
import ConfirmModal from './ConfirmModal'
import { FLAVOR_TYPES, FLAVOR_TYPE_LABELS, Flavor, FlavorType, groupFlavorsByType } from '@/lib/flavors'

// Owner-only: manage the master flavor catalog used by the weekly planner
// (patch 20). Deactivate hides a flavor from the picker but keeps it listed
// here and doesn't touch any week that already used it — each slot keeps its
// own flavor_name snapshot, independent of the catalog (see
// supabase/add-flavors.sql). Delete is a true hard-delete, separate from
// deactivate and with no precondition; past weeks still display correctly
// either way since they don't depend on the catalog row still existing.
//
// Type (patch 26) is required when adding, and the list is grouped into
// three sections by type rather than tagging every row inline — with ~89
// entries, a section header per group reads cleaner than a repeated badge.
export default function FlavorCatalogView() {
  const [list, setList] = useState<Flavor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<FlavorType | null>(null)
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState<Flavor | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/flavors?all=true')
      if (!res.ok) throw new Error()
      setList(await res.json())
    } catch {
      setError('Could not load flavors. Try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const add = async () => {
    setError('')
    if (!newName.trim()) return
    if (!newType) return setError('Pick a type.')
    setBusy(true)
    try {
      const res = await fetch('/api/flavors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, type: newType }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not add')
      setNewName('')
      setNewType(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (f: Flavor) => {
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/flavors', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: f.id, active: !f.active }),
      })
      if (!res.ok) throw new Error()
      await load()
    } catch {
      setError('Could not update. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async () => {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      const res = await fetch('/api/flavors', {
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

  const groups = groupFlavorsByType(list)

  return (
    <div>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-4 flex flex-col gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Flavor name…"
          className="border border-gray-200 rounded-xl px-4 py-3 text-gray-900 focus:outline-none focus:border-green-500"
        />
        <div className="grid grid-cols-3 gap-2">
          {FLAVOR_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setNewType(t)}
              className={`min-h-[44px] rounded-xl px-2 py-2 text-sm font-semibold border transition-colors ${
                newType === t
                  ? 'bg-[#1a7a3c] text-white border-[#1a7a3c]'
                  : 'bg-green-50 hover:bg-green-100 text-gray-900 border-green-100'
              }`}
            >
              {FLAVOR_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
        <button
          onClick={add}
          disabled={busy || !newName.trim() || !newType}
          className="bg-[#1a7a3c] hover:bg-[#155f2f] disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold py-3 rounded-xl"
        >
          Add Flavor
        </button>
      </div>
      {error && <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3">{error}</div>}

      {groups.map((group) => (
        <div key={group.type} className="mb-4">
          <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">
            {FLAVOR_TYPE_LABELS[group.type]} ({group.flavors.length})
          </h3>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            {group.flavors.map((f, idx) => (
              <div
                key={f.id}
                className={`flex items-center gap-2 px-5 py-3 ${idx < group.flavors.length - 1 ? 'border-b border-gray-100' : ''}`}
              >
                <p className={`flex-1 font-semibold ${f.active ? 'text-gray-900' : 'text-gray-400'}`}>
                  {f.name}
                  {!f.active && <span className="ml-2 text-xs font-bold uppercase tracking-wide text-gray-400">Inactive</span>}
                </p>
                <button
                  onClick={() => toggle(f)}
                  disabled={busy}
                  className={`min-h-[40px] px-4 rounded-xl text-sm font-semibold disabled:opacity-50 flex-shrink-0 ${
                    f.active ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-700'
                  }`}
                >
                  {f.active ? 'Deactivate' : 'Reactivate'}
                </button>
                <button
                  onClick={() => setDeleting(f)}
                  disabled={busy}
                  className="min-h-[40px] px-3 rounded-xl text-sm font-semibold bg-gray-100 text-gray-500 disabled:opacity-50 flex-shrink-0"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
      {list.length === 0 && <p className="text-gray-400 text-center py-6">No flavors yet.</p>}

      {deleting && (
        <ConfirmModal
          message={`Permanently delete "${deleting.name}"? This can't be undone — past weeks that used it will still show its name.`}
          busy={deleteBusy}
          onConfirm={handleDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  )
}
