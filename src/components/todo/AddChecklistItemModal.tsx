'use client'

import { useState } from 'react'
import { Staff, EVERYONE, TASK_CREATORS, PhotoSetting } from '@/lib/tasks'

const segBtn = (active: boolean) =>
  `flex-1 min-h-[44px] rounded-xl text-sm font-semibold border transition-colors ${
    active ? 'bg-[#1a7a3c] text-white border-[#1a7a3c]' : 'bg-white text-gray-600 border-gray-200'
  }`

// Adds a new line item to an EXISTING checklist + section — the recurrence
// (daily / which weekday) is inherited server-side from the section's other
// items, so this form only asks for what's actually new about this item.
export default function AddChecklistItemModal({
  staff,
  checklistName,
  sections,
  onClose,
  onSaved,
}: {
  staff: Staff[]
  checklistName: string
  sections: string[]
  onClose: () => void
  onSaved: () => void
}) {
  const [section, setSection] = useState(sections[0] ?? '')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [createdBy, setCreatedBy] = useState('')
  const [photo, setPhoto] = useState<PhotoSetting>('optional')
  const [dueTime, setDueTime] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    setError('')
    if (!section) return setError('Pick a section.')
    if (!title.trim()) return setError('Give the item a title.')
    if (!assignedTo) return setError('Pick who this is assigned to.')
    if (!createdBy) return setError('Pick who added this task.')
    setSaving(true)
    try {
      const res = await fetch('/api/task-templates/checklist-item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          checklist_name: checklistName,
          section,
          title,
          description,
          assigned_to: assignedTo,
          created_by: createdBy,
          photo_setting: photo,
          due_time: dueTime || null,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not save')
      onSaved()
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
          <h2 className="text-xl font-bold text-gray-900">Add to {checklistName}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-3xl leading-none px-2" aria-label="Close">
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-4 flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Section</label>
            <select
              value={section}
              onChange={(e) => setSection(e.target.value)}
              className="border border-gray-200 rounded-xl px-3 py-3 text-base text-gray-900 bg-white focus:outline-none focus:border-green-500"
            >
              {sections.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Assigned to</label>
            <select
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
              className="border border-gray-200 rounded-xl px-3 py-3 text-base text-gray-900 bg-white focus:outline-none focus:border-green-500"
            >
              <option value="">Select a name…</option>
              <option value={EVERYONE}>{EVERYONE}</option>
              {staff.map((s) => (
                <option key={s.id} value={s.name}>{s.name}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Added by</label>
            <select
              value={createdBy}
              onChange={(e) => setCreatedBy(e.target.value)}
              className="border border-gray-200 rounded-xl px-3 py-3 text-base text-gray-900 bg-white focus:outline-none focus:border-green-500"
            >
              <option value="">Select a name…</option>
              {TASK_CREATORS.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Task</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Wipe down the counters"
              className="border border-gray-200 rounded-xl px-4 py-3 text-base text-gray-900 focus:outline-none focus:border-green-500"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Details <span className="text-gray-400 font-normal">(optional)</span></label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="border border-gray-200 rounded-xl px-4 py-3 text-base text-gray-900 focus:outline-none focus:border-green-500"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Photo</label>
            <div className="flex gap-2">
              <button type="button" className={segBtn(photo === 'off')} onClick={() => setPhoto('off')}>Off</button>
              <button type="button" className={segBtn(photo === 'optional')} onClick={() => setPhoto('optional')}>Optional</button>
              <button type="button" className={segBtn(photo === 'required')} onClick={() => setPhoto('required')}>Required</button>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">
              Due time <span className="text-gray-400 font-normal">(optional — leave blank to use the checklist&apos;s default)</span>
            </label>
            <input
              type="time"
              value={dueTime}
              onChange={(e) => setDueTime(e.target.value)}
              className="border border-gray-200 rounded-xl px-4 py-3 text-base text-gray-900 focus:outline-none focus:border-green-500"
            />
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
            {saving ? 'Saving…' : 'Add Item'}
          </button>
        </div>
      </div>
    </div>
  )
}
