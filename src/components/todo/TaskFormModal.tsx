'use client'

import { useState } from 'react'
import ConfirmModal from './ConfirmModal'
import {
  Staff,
  TaskTemplate,
  PhotoSetting,
  WEEKDAY_LABELS,
  EVERYONE,
  TASK_CREATORS,
  photoSettingOf,
} from '@/lib/tasks'

type Kind = 'one-off' | 'recurring'
type Freq = 'daily' | 'weekly' | 'custom'

const segBtn = (active: boolean) =>
  `flex-1 min-h-[44px] rounded-xl text-sm font-semibold border transition-colors ${
    active ? 'bg-[#1a7a3c] text-white border-[#1a7a3c]' : 'bg-white text-gray-600 border-gray-200'
  }`

// Add-task form (one-off or recurring) and, when `template` is given, the template edit form.
export default function TaskFormModal({
  staff,
  template,
  onClose,
  onSaved,
  onDelete,
}: {
  staff: Staff[]
  template?: TaskTemplate
  onClose: () => void
  onSaved: (message: string) => void
  // Only passed by the owner-only Repeating view; when absent no Delete button is shown
  onDelete?: () => Promise<void>
}) {
  const editing = !!template
  const [assignedTo, setAssignedTo] = useState(template?.assigned_to ?? '')
  const [createdBy, setCreatedBy] = useState(template?.created_by ?? '')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [title, setTitle] = useState(template?.title ?? '')
  const [description, setDescription] = useState(template?.description ?? '')
  const [kind, setKind] = useState<Kind>('one-off')
  const [photo, setPhoto] = useState<PhotoSetting>(template ? photoSettingOf(template) : 'optional')
  const [freq, setFreq] = useState<Freq>(
    template && template.recurrence !== 'none' ? (template.recurrence as Freq) : 'daily'
  )
  const [weekday, setWeekday] = useState<number | null>(template?.weekday ?? null)
  const [customDays, setCustomDays] = useState<number[]>(template?.custom_days ?? [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const recurring = editing || kind === 'recurring'

  // A template's current value may no longer be a choice (e.g. an older "added by" name,
  // or an assignee who has since been removed) — keep showing it rather than a blank select.
  const assignedOptions: string[] = [EVERYONE, ...staff.map((s) => s.name)]
  if (template && !assignedOptions.includes(template.assigned_to)) assignedOptions.push(template.assigned_to)
  const creatorOptions: string[] = [...TASK_CREATORS]
  if (template && !creatorOptions.includes(template.created_by)) creatorOptions.push(template.created_by)

  const confirmDelete = async () => {
    if (!onDelete) return
    setDeleting(true)
    try {
      await onDelete()
    } catch (e) {
      setConfirmingDelete(false)
      setError(e instanceof Error ? e.message : 'Could not delete. Try again.')
    } finally {
      setDeleting(false)
    }
  }

  const toggleCustomDay = (d: number) =>
    setCustomDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))

  const save = async () => {
    setError('')
    if (!editing && !assignedTo) return setError('Pick who this is assigned to.')
    if (!editing && !createdBy) return setError('Pick who added this task.')
    if (!title.trim()) return setError('Give the task a title.')
    if (recurring && freq === 'weekly' && weekday === null) return setError('Pick a day of the week.')
    if (recurring && freq === 'custom' && customDays.length === 0) return setError('Pick at least one day.')

    const recurrenceFields = recurring
      ? { recurrence: freq, weekday: freq === 'weekly' ? weekday : null, custom_days: freq === 'custom' ? customDays : null }
      : {}

    setSaving(true)
    try {
      let res: Response
      if (editing) {
        res = await fetch('/api/task-templates', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: template.id,
            title,
            description,
            photo_setting: photo,
            ...recurrenceFields,
            // only send ownership fields that were actually changed
            ...(assignedTo !== template.assigned_to ? { assigned_to: assignedTo } : {}),
            ...(createdBy !== template.created_by ? { created_by: createdBy } : {}),
          }),
        })
      } else {
        res = await fetch(recurring ? '/api/task-templates' : '/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, description, assigned_to: assignedTo, created_by: createdBy, photo_setting: photo, ...recurrenceFields }),
        })
      }
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not save')
      onSaved(editing ? 'Task updated' : recurring ? 'Recurring task added' : 'Task added')
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
          <h2 className="text-xl font-bold text-gray-900">{editing ? 'Edit Task' : 'Add Task'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-3xl leading-none px-2" aria-label="Close">
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-4 flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Assigned to</label>
            <select
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
              className="border border-gray-200 rounded-xl px-3 py-3 text-base text-gray-900 bg-white focus:outline-none focus:border-green-500"
            >
              {!editing && <option value="">Select a name…</option>}
              {assignedOptions.map((name) => (
                <option key={name} value={name}>{name}</option>
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
              {!editing && <option value="">Select a name…</option>}
              {creatorOptions.map((name) => (
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
              placeholder="e.g. Clean the slush machine"
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

          {!editing && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">How often?</label>
              <div className="flex gap-2">
                <button type="button" className={segBtn(kind === 'one-off')} onClick={() => setKind('one-off')}>Just today</button>
                <button type="button" className={segBtn(kind === 'recurring')} onClick={() => setKind('recurring')}>Repeats</button>
              </div>
            </div>
          )}

          {recurring && (
            <div className="flex flex-col gap-3">
              <div className="flex gap-2">
                <button type="button" className={segBtn(freq === 'daily')} onClick={() => setFreq('daily')}>Daily</button>
                <button type="button" className={segBtn(freq === 'weekly')} onClick={() => setFreq('weekly')}>Weekly</button>
                <button type="button" className={segBtn(freq === 'custom')} onClick={() => setFreq('custom')}>Custom</button>
              </div>
              {freq === 'weekly' && (
                <div>
                  <p className="text-xs text-gray-500 font-medium mb-1">Which day?</p>
                  <div className="grid grid-cols-7 gap-1">
                    {WEEKDAY_LABELS.map((label, i) => (
                      <button key={label} type="button" className={segBtn(weekday === i)} onClick={() => setWeekday(i)}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {freq === 'custom' && (
                <div>
                  <p className="text-xs text-gray-500 font-medium mb-1">Which days? (pick any)</p>
                  <div className="grid grid-cols-7 gap-1">
                    {WEEKDAY_LABELS.map((label, i) => (
                      <button key={label} type="button" className={segBtn(customDays.includes(i))} onClick={() => toggleCustomDay(i)}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Photo</label>
            <div className="flex gap-2">
              <button type="button" className={segBtn(photo === 'off')} onClick={() => setPhoto('off')}>Off</button>
              <button type="button" className={segBtn(photo === 'optional')} onClick={() => setPhoto('optional')}>Optional</button>
              <button type="button" className={segBtn(photo === 'required')} onClick={() => setPhoto('required')}>Required</button>
            </div>
          </div>

          {error && <p className="text-red-500 text-sm">{error}</p>}

          {editing && onDelete && (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="w-full min-h-[48px] bg-red-50 hover:bg-red-100 text-red-600 font-semibold rounded-xl mt-2"
            >
              Delete this repeating task
            </button>
          )}
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
            {saving ? 'Saving…' : editing ? 'Save' : 'Add Task'}
          </button>
        </div>
      </div>

      {confirmingDelete && template && (
        <ConfirmModal
          message={`Permanently delete “${template.title}” and all of its open tasks? Tasks already completed stay in History. This can't be undone.`}
          busy={deleting}
          onConfirm={confirmDelete}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </div>
  )
}
