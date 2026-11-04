'use client'

import { useState } from 'react'
import { useBlockReload } from '@/lib/reload-guard'

// Create a new list, or rename an existing one (patch 36) — same single
// name field either way, just a different submit action and title.
export default function ManageListModal({
  mode,
  currentName,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'rename'
  currentName?: string
  onClose: () => void
  onSaved: () => void
}) {
  useBlockReload(true) // patch 30: open modal, never auto-reload while it is
  const [name, setName] = useState(mode === 'rename' ? currentName ?? '' : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    setError('')
    if (!name.trim()) return setError('Give the list a name.')
    setSaving(true)
    try {
      const res = await fetch('/api/checklists', {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'create' ? { name } : { name: currentName, rename_to: name }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error || 'Could not save. Try again.')
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
        <div>
          <h2 className="text-xl font-bold text-gray-900">{mode === 'create' ? 'New List' : 'Rename List'}</h2>
          {mode === 'rename' && <p className="text-sm text-gray-500 mt-1">{currentName}</p>}
        </div>
        <input
          type="text"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Weekend Prep"
          className="border-2 border-gray-200 rounded-xl px-4 py-3 text-base text-gray-900 focus:outline-none focus:border-green-500"
        />
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-600 font-semibold py-3 rounded-xl"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 bg-[#1a7a3c] hover:bg-[#155f2f] disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold py-3 rounded-xl"
          >
            {saving ? 'Saving…' : mode === 'create' ? 'Create' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
