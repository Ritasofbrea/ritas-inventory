'use client'

import { useState } from 'react'

// Renaming to a name that already exists elsewhere in the same checklist merges
// the two sections (server-side) — allowed, since nothing stops that from being
// intentional, but worth knowing before confirming.
export default function RenameSectionModal({
  checklistName,
  currentSection,
  onClose,
  onSaved,
}: {
  checklistName: string
  currentSection: string
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(currentSection)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    setError('')
    if (!name.trim()) return setError('Section name cannot be empty.')
    setSaving(true)
    try {
      const res = await fetch('/api/task-templates/rename-section', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checklist_name: checklistName, old_section: currentSection, new_section: name }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not rename. Try again.')
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not rename. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
        <div>
          <h2 className="text-xl font-bold text-gray-900">Rename Section</h2>
          <p className="text-sm text-gray-500 mt-1">{checklistName}</p>
        </div>
        <input
          type="text"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
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
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
