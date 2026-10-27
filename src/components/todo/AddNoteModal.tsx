'use client'

import { useRef, useState } from 'react'
import { Staff } from '@/lib/tasks'
import { uploadNotePhoto } from '@/lib/photo'

// Small add-note form: free text plus a tap-to-pick name grid (same idea as
// StaffPicker — whoever's adding the note picks their own name, no typing,
// no PIN). Anyone can add a note, so this never checks role/canManage —
// except the "Needs Acknowledgment" toggle below, which is owner/shift-lead
// only (same canManage gate as "+ Add Task"); regular staff never see it,
// so their notes are never ack-required.
export default function AddNoteModal({
  staff,
  canManage,
  onClose,
  onSaved,
}: {
  staff: Staff[]
  canManage: boolean
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const [content, setContent] = useState('')
  const [createdBy, setCreatedBy] = useState('')
  const [requiresAck, setRequiresAck] = useState(false)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handlePhotoSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setPhotoFile(file)
    setPhotoPreview(URL.createObjectURL(file))
  }

  const removePhoto = () => {
    if (photoPreview) URL.revokeObjectURL(photoPreview)
    setPhotoFile(null)
    setPhotoPreview(null)
  }

  const save = async () => {
    setError('')
    if (!content.trim()) return setError('Write something first.')
    if (!createdBy) return setError('Pick your name.')
    setSaving(true)
    try {
      // Reference photo is always optional (unlike task photos, there's no
      // required-photo mode here) and, since the note doesn't exist yet,
      // gets uploaded to its own random path first — the resulting URL just
      // rides along in the note's own insert.
      const photoUrl = photoFile ? await uploadNotePhoto(photoFile) : null
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, created_by: createdBy, requires_ack: canManage && requiresAck, photo_url: photoUrl }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not save')
      onSaved('Note added')
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
          <h2 className="text-xl font-bold text-gray-900">Add Note</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-3xl leading-none px-2" aria-label="Close">
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-4 flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Note</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={4}
              placeholder="e.g. Catering order on the 16th, 1 gallon cotton candy ice for Mike, pickup at 12, needs cups and scraper."
              className="border border-gray-200 rounded-xl px-4 py-3 text-base text-gray-900 focus:outline-none focus:border-green-500"
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Photo (optional)</label>
            {photoPreview ? (
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoPreview} alt="" className="w-16 h-16 rounded-lg object-cover border border-gray-200" />
                <button
                  type="button"
                  onClick={removePhoto}
                  className="text-xs font-semibold text-red-600 hover:text-red-700 px-2 py-1"
                >
                  Remove photo
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="self-start text-xs font-semibold text-blue-600 hover:text-blue-700 px-2 py-1"
              >
                📷 Add Photo
              </button>
            )}
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoSelected} />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Your name</label>
            <div className="grid grid-cols-2 gap-2">
              {staff.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setCreatedBy(s.name)}
                  className={`min-h-[48px] rounded-xl px-3 py-2 border font-semibold transition-colors ${
                    createdBy === s.name
                      ? 'bg-[#1a7a3c] text-white border-[#1a7a3c]'
                      : 'bg-green-50 hover:bg-green-100 text-gray-900 border-green-100'
                  }`}
                >
                  {s.name}
                </button>
              ))}
              {staff.length === 0 && <p className="col-span-2 text-gray-400 text-sm py-2">No staff names yet.</p>}
            </div>
          </div>

          {canManage && (
            <label className="flex items-center gap-2 text-sm text-gray-700 font-medium">
              <input
                type="checkbox"
                checked={requiresAck}
                onChange={(e) => setRequiresAck(e.target.checked)}
                className="w-4 h-4 accent-[#1a7a3c]"
              />
              Needs Acknowledgment
            </label>
          )}

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
            {saving ? 'Saving…' : 'Add Note'}
          </button>
        </div>
      </div>
    </div>
  )
}
