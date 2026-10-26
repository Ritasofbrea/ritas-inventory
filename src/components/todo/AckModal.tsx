'use client'

import { useState } from 'react'
import { Staff } from '@/lib/tasks'

// One-tap "I Understand" for an ack-required note — same tap-to-pick name
// grid as AddNoteModal/AddReplyModal, but no text entry: picking a name logs
// that person's acknowledgment, nothing more. No PIN, same trust level as
// the rest of Notes. Names already in `alreadyAcknowledged` are shown
// checked off and disabled, so the group can see at a glance who's left.
export default function AckModal({
  staff,
  noteId,
  alreadyAcknowledged,
  onClose,
  onSaved,
}: {
  staff: Staff[]
  noteId: string
  alreadyAcknowledged: string[]
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const [staffName, setStaffName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    setError('')
    if (!staffName) return setError('Pick your name.')
    setSaving(true)
    try {
      const res = await fetch('/api/notes/acknowledgments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note_id: noteId, staff_name: staffName }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not save')
      onSaved('Acknowledged')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-3 flex items-center justify-between flex-shrink-0">
          <h2 className="text-xl font-bold text-gray-900">I Understand</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-3xl leading-none px-2" aria-label="Close">
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-4 flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Your name</label>
            <div className="grid grid-cols-2 gap-2">
              {staff.map((s) => {
                const acked = alreadyAcknowledged.includes(s.name)
                return (
                  <button
                    key={s.id}
                    type="button"
                    disabled={acked}
                    onClick={() => setStaffName(s.name)}
                    className={`min-h-[48px] rounded-xl px-3 py-2 border font-semibold transition-colors disabled:opacity-50 ${
                      staffName === s.name
                        ? 'bg-[#1a7a3c] text-white border-[#1a7a3c]'
                        : 'bg-green-50 hover:bg-green-100 text-gray-900 border-green-100'
                    }`}
                  >
                    {acked ? `✓ ${s.name}` : s.name}
                  </button>
                )
              })}
              {staff.length === 0 && <p className="col-span-2 text-gray-400 text-sm py-2">No staff names yet.</p>}
            </div>
          </div>

          {error && <p className="text-red-500 text-sm">{error}</p>}
        </div>

        <div className="px-6 pb-6 pt-2 flex gap-3 flex-shrink-0">
          <button onClick={onClose} className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-600 font-semibold py-3 rounded-xl">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 bg-[#1a7a3c] hover:bg-[#155f2f] disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold py-3 rounded-xl"
          >
            {saving ? 'Saving…' : 'I Understand'}
          </button>
        </div>
      </div>
    </div>
  )
}
