'use client'

import { useState } from 'react'
import ConfirmModal from './ConfirmModal'
import TimeField from './TimeField'
import { getOwnerName } from '@/lib/auth'
import {
  Staff,
  TaskTemplate,
  TaskTemplateStep,
  TaskInstance,
  PhotoSetting,
  Priority,
  StepStyle,
  WEEKDAY_LABELS,
  EVERYONE,
  TASK_CREATORS,
  photoSettingOf,
  toHM,
} from '@/lib/tasks'

type Kind = 'one-off' | 'recurring'
type Freq = 'daily' | 'weekly' | 'custom'

const segBtn = (active: boolean) =>
  `flex-1 min-h-[44px] rounded-xl text-sm font-semibold border transition-colors ${
    active ? 'bg-[#1a7a3c] text-white border-[#1a7a3c]' : 'bg-white text-gray-600 border-gray-200'
  }`

// Add-task form (one-off or recurring); when `template` is given, the template
// edit form; when `instance` is given, a full edit of a single standalone
// (one-off, still-open) task — same fields, but there's no recurrence to set.
export default function TaskFormModal({
  staff,
  template,
  instance,
  onClose,
  onSaved,
  onDelete,
}: {
  staff: Staff[]
  template?: TaskTemplate
  instance?: TaskInstance
  onClose: () => void
  onSaved: (message: string) => void
  // Only passed by the owner-only Repeating view; when absent no Delete button is shown
  onDelete?: () => Promise<void>
}) {
  const source = template ?? instance
  const editing = !!source
  const [assignedTo, setAssignedTo] = useState(source?.assigned_to ?? '')
  // New task/template: default "Added by" to whichever owner is currently
  // logged in (still changeable) instead of requiring a manual pick every
  // time. Editing an existing one keeps its own created_by untouched.
  const [createdBy, setCreatedBy] = useState(source?.created_by ?? getOwnerName() ?? '')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [title, setTitle] = useState(source?.title ?? '')
  const [description, setDescription] = useState(source?.description ?? '')
  const [kind, setKind] = useState<Kind>('one-off')
  const [photo, setPhoto] = useState<PhotoSetting>(source ? photoSettingOf(source) : 'optional')
  const [priority, setPriority] = useState<Priority>(source?.priority ?? 'normal')
  // Named-checklist items ignore priority entirely — this form is never used to
  // CREATE one (that's AddChecklistItemModal), but it IS used to edit one.
  const showPriority = !source || !source.checklist_name
  const [dueTime, setDueTime] = useState(toHM(source?.due_time) ?? '')
  // Checklist items can inherit their checklist's default due time, so the
  // label makes that explicit; standalone tasks have no checklist to inherit from.
  const dueTimeLabel = source?.checklist_name
    ? "Due time (optional — leave blank to use the checklist's default)"
    : 'Due time (optional)'
  const [freq, setFreq] = useState<Freq>(
    template && template.recurrence !== 'none' ? (template.recurrence as Freq) : 'daily'
  )
  const [weekday, setWeekday] = useState<number | null>(template?.weekday ?? null)
  const [customDays, setCustomDays] = useState<number[]>(template?.custom_days ?? [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Steps (patch 28) — only ever relevant for a repeating task (template),
  // never a one-off. The style itself can be set at creation, but the actual
  // steps list can't exist until the template row does, so the add/edit/
  // reorder editor below only renders once `template` is a real saved row.
  const [stepStyle, setStepStyle] = useState<StepStyle>(template?.step_style ?? 'none')
  const [steps, setSteps] = useState<TaskTemplateStep[]>(template?.steps ?? [])
  const [newStepText, setNewStepText] = useState('')
  const [stepBusy, setStepBusy] = useState(false)
  const [stepError, setStepError] = useState('')
  const [deletingStep, setDeletingStep] = useState<TaskTemplateStep | null>(null)
  // Switching away from 'checklist' while it has steps doesn't delete them
  // (they just stop being shown) — confirm first so that isn't a surprise.
  const [pendingStyleSwitch, setPendingStyleSwitch] = useState<StepStyle | null>(null)

  const handleStyleClick = (next: StepStyle) => {
    if (stepStyle === 'checklist' && steps.length > 0 && next !== 'checklist') setPendingStyleSwitch(next)
    else setStepStyle(next)
  }

  const handleAddStep = async () => {
    if (!template || !newStepText.trim()) return
    setStepBusy(true)
    setStepError('')
    try {
      const res = await fetch('/api/task-templates/steps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_id: template.id, content: newStepText.trim() }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not add step')
      setSteps(body.steps)
      setNewStepText('')
    } catch (e) {
      setStepError(e instanceof Error ? e.message : 'Could not add step. Try again.')
    } finally {
      setStepBusy(false)
    }
  }

  const handleStepBlur = async (step: TaskTemplateStep) => {
    if (!step.content.trim()) {
      setStepError("Step text can't be empty")
      return
    }
    setStepBusy(true)
    setStepError('')
    try {
      const res = await fetch('/api/task-templates/steps', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: step.id, content: step.content.trim() }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not save step')
      setSteps(body.steps)
    } catch (e) {
      setStepError(e instanceof Error ? e.message : 'Could not save step. Try again.')
    } finally {
      setStepBusy(false)
    }
  }

  const handleMoveStep = async (id: string, direction: 'up' | 'down') => {
    setStepBusy(true)
    setStepError('')
    try {
      const res = await fetch('/api/task-templates/steps', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, direction }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not reorder')
      setSteps(body.steps)
    } catch (e) {
      setStepError(e instanceof Error ? e.message : 'Could not reorder. Try again.')
    } finally {
      setStepBusy(false)
    }
  }

  const confirmDeleteStep = async () => {
    if (!deletingStep) return
    setStepBusy(true)
    setStepError('')
    try {
      const res = await fetch('/api/task-templates/steps', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: deletingStep.id }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not delete step')
      setSteps(body.steps)
      setDeletingStep(null)
    } catch (e) {
      setStepError(e instanceof Error ? e.message : 'Could not delete step. Try again.')
    } finally {
      setStepBusy(false)
    }
  }

  // Editing a one-off instance never offers recurrence — it's a single already-
  // created task, not a template; "repeating" only applies when adding new or
  // editing a template. Steps are hidden for one-off tasks too — same condition.
  const recurring = !instance && (editing || kind === 'recurring')

  // An assignee may no longer be a choice (e.g. someone who has since been removed from
  // staff) — keep showing it rather than a blank select. "Added by" has no such fallback:
  // it's a fixed, short list (Josh/Gina/Valerie) and must never show anything else, even
  // for an older template whose created_by predates that list.
  const assignedOptions: string[] = [EVERYONE, ...staff.map((s) => s.name)]
  if (source && !assignedOptions.includes(source.assigned_to)) assignedOptions.push(source.assigned_to)
  const creatorOptions: string[] = [...TASK_CREATORS]

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
      if (template) {
        res = await fetch('/api/task-templates', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: template.id,
            title,
            description,
            photo_setting: photo,
            ...recurrenceFields,
            // only send fields that were actually changed
            ...(assignedTo !== template.assigned_to ? { assigned_to: assignedTo } : {}),
            ...(createdBy !== template.created_by ? { created_by: createdBy } : {}),
            ...(showPriority && priority !== template.priority ? { priority } : {}),
            ...(dueTime !== (toHM(template.due_time) ?? '') ? { due_time: dueTime || null } : {}),
            ...(stepStyle !== template.step_style ? { step_style: stepStyle } : {}),
          }),
        })
      } else if (instance) {
        res = await fetch('/api/tasks', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: instance.id,
            action: 'edit',
            title,
            description,
            photo_setting: photo,
            // only send fields that were actually changed
            ...(assignedTo !== instance.assigned_to ? { assigned_to: assignedTo } : {}),
            ...(createdBy !== instance.created_by ? { created_by: createdBy } : {}),
            ...(showPriority && priority !== instance.priority ? { priority } : {}),
            ...(dueTime !== (toHM(instance.due_time) ?? '') ? { due_time: dueTime || null } : {}),
          }),
        })
      } else {
        res = await fetch(recurring ? '/api/task-templates' : '/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            description,
            assigned_to: assignedTo,
            created_by: createdBy,
            photo_setting: photo,
            priority,
            due_time: dueTime || null,
            ...recurrenceFields,
            ...(recurring ? { step_style: stepStyle } : {}),
          }),
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

          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">{dueTimeLabel}</label>
            <TimeField value={dueTime} onChange={setDueTime} />
          </div>

          {showPriority && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">Priority</label>
              <div className="flex gap-2">
                <button type="button" className={segBtn(priority === 'normal')} onClick={() => setPriority('normal')}>Normal</button>
                <button type="button" className={segBtn(priority === 'high')} onClick={() => setPriority('high')}>⭐ High</button>
              </div>
            </div>
          )}

          {recurring && (
            <div className="flex flex-col gap-2">
              <label className="text-xs text-gray-500 font-medium">Steps</label>
              <div className="flex gap-2">
                <button type="button" className={segBtn(stepStyle === 'none')} onClick={() => handleStyleClick('none')}>None</button>
                <button type="button" className={segBtn(stepStyle === 'reference')} onClick={() => handleStyleClick('reference')}>Instructions text</button>
                <button type="button" className={segBtn(stepStyle === 'checklist')} onClick={() => handleStyleClick('checklist')}>Checkable steps</button>
              </div>

              {stepStyle === 'reference' && (
                <p className="text-xs text-gray-400">Shown as an expandable &quot;Instructions&quot; section, using the Details box above.</p>
              )}

              {stepStyle === 'checklist' && (
                template ? (
                  <div className="flex flex-col gap-2 mt-1">
                    {stepError && <p className="text-red-500 text-sm">{stepError}</p>}
                    {steps.map((s, i) => (
                      <div key={s.id} className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={s.content}
                          onChange={(e) => setSteps((prev) => prev.map((x) => (x.id === s.id ? { ...x, content: e.target.value } : x)))}
                          onBlur={() => handleStepBlur(s)}
                          className="flex-1 min-w-0 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-green-500"
                        />
                        <button
                          type="button"
                          onClick={() => handleMoveStep(s.id, 'up')}
                          disabled={i === 0 || stepBusy}
                          aria-label="Move step up"
                          className="w-8 h-8 flex-shrink-0 bg-gray-100 hover:bg-gray-200 disabled:opacity-30 text-gray-600 font-bold rounded-lg text-xs"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMoveStep(s.id, 'down')}
                          disabled={i === steps.length - 1 || stepBusy}
                          aria-label="Move step down"
                          className="w-8 h-8 flex-shrink-0 bg-gray-100 hover:bg-gray-200 disabled:opacity-30 text-gray-600 font-bold rounded-lg text-xs"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingStep(s)}
                          disabled={stepBusy}
                          aria-label="Delete step"
                          className="w-8 h-8 flex-shrink-0 bg-red-50 hover:bg-red-100 disabled:opacity-30 text-red-600 font-bold rounded-lg text-xs"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newStepText}
                        onChange={(e) => setNewStepText(e.target.value)}
                        placeholder="Add a step…"
                        className="flex-1 min-w-0 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-green-500"
                      />
                      <button
                        type="button"
                        onClick={handleAddStep}
                        disabled={stepBusy || !newStepText.trim()}
                        className="flex-shrink-0 px-3 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 text-sm font-semibold"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-gray-400">Save this task first, then edit it again to add steps.</p>
                )
              )}
            </div>
          )}

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

      {pendingStyleSwitch && (
        <ConfirmModal
          message={`Switching away from Checkable steps will hide this task's ${steps.length} existing step${steps.length === 1 ? '' : 's'} — they won't be deleted, and you can switch back later. Continue?`}
          confirmLabel="Switch"
          onConfirm={() => {
            setStepStyle(pendingStyleSwitch)
            setPendingStyleSwitch(null)
          }}
          onCancel={() => setPendingStyleSwitch(null)}
        />
      )}

      {deletingStep && (
        <ConfirmModal
          message={`Delete this step? Any day's progress on it is removed too. This can't be undone.`}
          busy={stepBusy}
          onConfirm={confirmDeleteStep}
          onCancel={() => setDeletingStep(null)}
        />
      )}
    </div>
  )
}
