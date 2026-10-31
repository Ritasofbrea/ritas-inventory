'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Navigation from '@/components/Navigation'
import StaffName from '@/components/StaffName'
import StaffPicker from '@/components/todo/StaffPicker'
import PinModal from '@/components/todo/PinModal'
import TaskFormModal from '@/components/todo/TaskFormModal'
import NotesBoard from '@/components/todo/NotesBoard'
import ConfirmModal from '@/components/todo/ConfirmModal'
import HistoryView from '@/components/todo/HistoryView'
import MissedView from '@/components/todo/MissedView'
import TemplatesView from '@/components/todo/TemplatesView'
import { getRole, getShiftLeadName } from '@/lib/auth'
import { uploadTaskPhoto } from '@/lib/photo'
import { Role } from '@/lib/types'
import { Staff, TaskInstance, TaskTemplateStep, buildChecklistGroups, formatDateShort, formatDueTime, formatTime, isOverdue, sortStandalone, todayInTZ } from '@/lib/tasks'

type View = 'today' | 'history' | 'missed' | 'templates'

const VIEW_LABELS: Record<View, string> = {
  today: 'Today',
  history: 'History',
  missed: 'Missed',
  templates: 'Repeating',
}

const notifyTasksChanged = () => window.dispatchEvent(new Event('tasks-changed'))

function CameraIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h1.5l1-2h9l1 2H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  )
}

export default function TodoPage() {
  const [role, setRole] = useState<Role | null>(null)
  const [view, setView] = useState<View>('today')
  const [today, setToday] = useState(todayInTZ())
  const [open, setOpen] = useState<TaskInstance[]>([])
  const [done, setDone] = useState<TaskInstance[]>([])
  const [missedCount, setMissedCount] = useState(0)
  const [staff, setStaff] = useState<Staff[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showDone, setShowDone] = useState(false)
  const [completing, setCompleting] = useState<TaskInstance | null>(null)
  const [completingBusy, setCompletingBusy] = useState(false)
  const [pinUnlocked, setPinUnlocked] = useState(false)
  const [showPin, setShowPin] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [showAddNote, setShowAddNote] = useState(false)
  const [uploadingId, setUploadingId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<TaskInstance | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [editingTask, setEditingTask] = useState<TaskInstance | null>(null)
  const [photoNudgeId, setPhotoNudgeId] = useState<string | null>(null)
  const [expandedChecklists, setExpandedChecklists] = useState<Set<string>>(new Set())
  const [standaloneBusyId, setStandaloneBusyId] = useState<string | null>(null)
  const [undoingId, setUndoingId] = useState<string | null>(null)
  const [expandedTaskSteps, setExpandedTaskSteps] = useState<Set<string>>(new Set())
  const [pendingStepKeys, setPendingStepKeys] = useState<Set<string>>(new Set())
  // Remembers who's been checking off a given task's steps this page load, so
  // StaffPicker only has to ask once per task, not on every single step tap.
  const [stepCheckerNames, setStepCheckerNames] = useState<Record<string, string>>({})
  const [pickingStepFor, setPickingStepFor] = useState<{ task: TaskInstance; step: TaskTemplateStep } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const photoTargetRef = useRef<string | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flash = (msg: string) => {
    setNotice(msg)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(''), 3500)
  }

  const loadTasks = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks?view=today')
      if (!res.ok) throw new Error()
      const data = await res.json()
      setToday(data.today)
      setOpen(data.open)
      setDone(data.done)
      setMissedCount(data.missedCount ?? 0)
      setError('')
    } catch {
      setError('Could not load tasks. Check your connection.')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadStaff = useCallback(async () => {
    try {
      const res = await fetch('/api/staff')
      if (res.ok) setStaff(await res.json())
    } catch {
      // picker just shows an empty list; the tasks list still works
    }
  }, [])

  useEffect(() => {
    // To-Do works with no role at all (the login screen's "To-Do List" button);
    // a role only unlocks the owner views and skips the Add Task PIN.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: resolve role once on mount, this app's standard page-load pattern
    setRole(getRole())
    loadTasks()
    loadStaff()
  }, [loadTasks, loadStaff])

  // A background refetch would yank the task list out from under someone
  // mid-action (staff name picker open, a photo mid-upload, a delete/add
  // modal open, a reorder or undo in flight) — skip the tick rather than
  // interrupt, it'll just catch up on the next one.
  const midInteractionRef = useRef(false)
  useEffect(() => {
    midInteractionRef.current =
      completing !== null || uploadingId !== null || deleting !== null || showAdd ||
      standaloneBusyId !== null || undoingId !== null || editingTask !== null ||
      pendingStepKeys.size > 0 || pickingStepFor !== null
  })

  // Shared checklist: pick up other people's changes when the tab regains focus,
  // and every 5 minutes in the background otherwise (a device left open at the
  // store should see new tasks/completions without anyone reloading).
  useEffect(() => {
    if (view !== 'today') return
    const refresh = () => {
      if (document.visibilityState === 'visible' && !midInteractionRef.current) loadTasks()
    }
    document.addEventListener('visibilitychange', refresh)
    const interval = setInterval(refresh, 5 * 60 * 1000)
    return () => {
      document.removeEventListener('visibilitychange', refresh)
      clearInterval(interval)
    }
  }, [view, loadTasks])

  useEffect(() => {
    return () => { if (noticeTimer.current) clearTimeout(noticeTimer.current) }
  }, [])

  const isOwner = role === 'owner'
  // Owners and shift leads already entered a PIN at login; a role-less visitor
  // (who came in through the login screen's "To-Do List" button) needs to clear
  // the + Add Task PIN gate first. Same condition gates Undo, below.
  const canManage = role !== null || pinUnlocked

  const handleAddClick = () => {
    if (canManage) setShowAdd(true)
    else setShowPin(true)
  }

  // "Jump to Tasks" (combined-header patch): smooth-scrolls past Notes,
  // whatever its length, straight to the view-switcher/Add Task row that
  // sits right above the actual task list — same anchor whether that row
  // is currently rendered above Notes (history/missed/templates views) or
  // below it (today view, see taskListHeader below).
  const scrollToTasks = () => {
    document.getElementById('todo-task-list-start')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const handleCheckboxTap = (task: TaskInstance) => {
    const totalSteps = task.steps?.length ?? 0
    const checkedSteps = task.checked_step_ids?.length ?? 0
    if (task.step_style === 'checklist' && totalSteps > 0 && checkedSteps < totalSteps) {
      flash('✅ Check off all the steps first.')
      return
    }
    if (task.photo_required && !task.photo_url) {
      setPhotoNudgeId(task.id)
      flash('📷 This task needs a photo before it can be marked done.')
      return
    }
    setCompleting(task)
  }

  const toggleTaskSteps = (taskId: string) => {
    setExpandedTaskSteps((prev) => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  // Optimistic check/uncheck: updates local state immediately, fires the API
  // call, and reverts + flashes an error if it fails. The background 5-min/
  // visibility refresh is held off (via pendingStepKeys in midInteractionRef)
  // for as long as any step toggle is in flight, so it can never stomp a tap
  // that just happened.
  const performStepToggle = async (task: TaskInstance, step: TaskTemplateStep, check: boolean, checkedBy: string | null) => {
    const key = `${task.id}:${step.id}`
    const applyToggle = (add: boolean) => (list: TaskInstance[]) =>
      list.map((t) => {
        if (t.id !== task.id) return t
        const ids = new Set(t.checked_step_ids ?? [])
        if (add) ids.add(step.id)
        else ids.delete(step.id)
        return { ...t, checked_step_ids: Array.from(ids) }
      })

    setPendingStepKeys((prev) => new Set(prev).add(key))
    setOpen(applyToggle(check))
    setDone(applyToggle(check))
    try {
      const res = await fetch('/api/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: task.id,
          action: check ? 'check-step' : 'uncheck-step',
          step_id: step.id,
          ...(check ? { checked_by: checkedBy } : {}),
        }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Could not save')
    } catch (e) {
      setOpen(applyToggle(!check))
      setDone(applyToggle(!check))
      flash(e instanceof Error ? e.message : 'Could not save. Try again.')
    } finally {
      setPendingStepKeys((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }

  const handleStepTap = (task: TaskInstance, step: TaskTemplateStep, checked: boolean) => {
    if (checked) {
      performStepToggle(task, step, false, null)
      return
    }
    const remembered = stepCheckerNames[task.id]
    if (remembered) performStepToggle(task, step, true, remembered)
    else setPickingStepFor({ task, step })
  }

  const handleStepNamePicked = (name: string) => {
    if (!pickingStepFor) return
    const { task, step } = pickingStepFor
    setStepCheckerNames((prev) => ({ ...prev, [task.id]: name }))
    setPickingStepFor(null)
    performStepToggle(task, step, true, name)
  }

  const handlePickName = async (name: string) => {
    if (!completing) return
    setCompletingBusy(true)
    try {
      const res = await fetch('/api/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: completing.id, action: 'complete', completed_by: name }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not save')
      // Tell subscribed (owner) devices. Fire-and-forget: a failed push must never
      // affect the completion that already succeeded.
      fetch('/api/send-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Task Completed', body: `${body.title} marked done by ${body.completed_by}` }),
      }).catch(() => {})
      setCompleting(null)
      await loadTasks()
      notifyTasksChanged()
    } catch (e) {
      setCompleting(null)
      flash(e instanceof Error ? e.message : 'Could not save. Try again.')
      loadTasks()
    } finally {
      setCompletingBusy(false)
    }
  }

  const handleDeleteTask = async () => {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      const res = await fetch('/api/tasks', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: deleting.id }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Could not delete. Try again.')
      setDeleting(null)
      flash('✓ Task deleted')
      await loadTasks()
      notifyTasksChanged()
    } catch (e) {
      setDeleting(null)
      flash(e instanceof Error ? e.message : 'Could not delete. Try again.')
    } finally {
      setDeleteBusy(false)
    }
  }

  const openPhotoPicker = (taskId: string) => {
    photoTargetRef.current = taskId
    fileInputRef.current?.click()
  }

  const handlePhotoSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    const taskId = photoTargetRef.current
    e.target.value = ''
    photoTargetRef.current = null
    if (!file || !taskId) return

    setUploadingId(taskId)
    try {
      const photoUrl = await uploadTaskPhoto(taskId, file)
      const res = await fetch('/api/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: taskId, action: 'photo', photo_url: photoUrl }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not save photo')
      setOpen((prev) => prev.map((t) => (t.id === taskId ? body : t)))
      setPhotoNudgeId(null)
    } catch (err) {
      flash(err instanceof Error ? `Photo failed: ${err.message}` : 'Photo failed. Try again.')
    } finally {
      setUploadingId(null)
    }
  }

  const toggleChecklist = (name: string) => {
    setExpandedChecklists((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const afterTaskSaved = (message: string) => {
    setShowAdd(false)
    setEditingTask(null)
    flash(`✓ ${message}`)
    loadTasks()
    notifyTasksChanged()
  }

  const handleUndo = async (task: TaskInstance) => {
    setUndoingId(task.id)
    try {
      const res = await fetch('/api/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: task.id, action: 'undo' }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Could not undo. Try again.')
      flash('✓ Marked not done')
      await loadTasks()
      notifyTasksChanged()
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not undo. Try again.')
    } finally {
      setUndoingId(null)
    }
  }

  // Owner-only: reorder within the standalone list's priority tier, or flip a
  // task's priority tier. Both are day-scoped (today's card only) — see
  // moveStandaloneItem / setInstancePriority in task-server.ts for why.
  const handleMoveStandalone = async (id: string, direction: 'up' | 'down') => {
    setStandaloneBusyId(id)
    try {
      const res = await fetch('/api/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'move', direction }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Could not reorder. Try again.')
      await loadTasks()
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not reorder. Try again.')
    } finally {
      setStandaloneBusyId(null)
    }
  }

  const handleTogglePriority = async (task: TaskInstance) => {
    const next = task.priority === 'high' ? 'normal' : 'high'
    setStandaloneBusyId(task.id)
    try {
      const res = await fetch('/api/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: task.id, action: 'priority', priority: next }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Could not update priority. Try again.')
      await loadTasks()
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not update priority. Try again.')
    } finally {
      setStandaloneBusyId(null)
    }
  }

  // Collapsible "Instructions" (reference) or checkbox sub-steps (checklist)
  // block, shared by open and done cards. Read-only on done cards — once a
  // task is completed, re-ticking its steps doesn't make sense; use Undo first.
  const renderStepsBlock = (task: TaskInstance, readOnly: boolean) => {
    if (!task.step_style || task.step_style === 'none') {
      return task.description ? <p className="text-sm text-gray-500 mt-0.5">{task.description}</p> : null
    }
    const expanded = expandedTaskSteps.has(task.id)
    const total = task.steps?.length ?? 0
    const checked = task.checked_step_ids?.length ?? 0
    return (
      <div className="mt-1">
        <button type="button" onClick={() => toggleTaskSteps(task.id)} className="text-xs font-semibold text-blue-600 hover:text-blue-700">
          {task.step_style === 'checklist' ? `${checked}/${total} steps ` : 'Instructions '}
          {expanded ? '▲' : '▼'}
        </button>
        {expanded && (
          <div className="mt-1 flex flex-col gap-1.5">
            {task.description && <p className="text-sm text-gray-500 whitespace-pre-wrap">{task.description}</p>}
            {task.step_style === 'checklist' &&
              (task.steps ?? []).map((step) => {
                const isChecked = (task.checked_step_ids ?? []).includes(step.id)
                return (
                  <button
                    key={step.id}
                    type="button"
                    disabled={readOnly || pendingStepKeys.has(`${task.id}:${step.id}`)}
                    onClick={() => handleStepTap(task, step, isChecked)}
                    className="flex items-start gap-2 text-left disabled:opacity-80"
                  >
                    <span
                      className={`w-5 h-5 mt-0.5 rounded border-2 flex-shrink-0 flex items-center justify-center text-xs font-bold ${
                        isChecked ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300 bg-white'
                      }`}
                    >
                      {isChecked ? '✓' : ''}
                    </span>
                    <span className={`text-sm ${isChecked ? 'text-gray-400 line-through' : 'text-gray-700'}`}>{step.content}</span>
                  </button>
                )
              })}
          </div>
        )}
      </div>
    )
  }

  // Same card markup whether a task sits in a named checklist's section or in the
  // flat standalone list below — `standalonePos` (only passed in the standalone
  // list) adds the priority star and, for owners, reorder arrows + priority toggle.
  const renderOpenCard = (task: TaskInstance, standalonePos?: { isFirst: boolean; isLast: boolean }) => {
    const overdue = isOverdue(task, today)
    const needsPhoto = task.photo_required && !task.photo_url
    return (
      <div
        key={task.id}
        className={`rounded-2xl shadow-sm border px-4 py-3 flex items-center gap-3 ${
          overdue ? 'bg-red-50 border-red-300' : 'bg-white border-gray-100'
        }`}
      >
        <button
          onClick={() => handleCheckboxTap(task)}
          aria-label={`Mark "${task.title}" done`}
          className="flex-shrink-0 w-11 h-11 flex items-center justify-center"
        >
          <span className={`w-8 h-8 rounded-full border-2 bg-white ${overdue ? 'border-red-400' : 'border-gray-300'}`} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 leading-tight">{task.title}</p>
          <p className="text-xs text-gray-500 mt-0.5">Assigned to <StaffName name={task.assigned_to} staff={staff} /></p>
          {task.due_time && <p className="text-xs text-gray-500 mt-0.5">Due by {formatDueTime(task.due_time)}</p>}
          {overdue && (
            <p className="text-xs font-bold text-red-600 mt-0.5">⚠️ Overdue — was due {formatDateShort(task.due_date)}</p>
          )}
          {renderStepsBlock(task, false)}
          {needsPhoto && <p className="text-xs font-semibold text-amber-700 mt-0.5">📷 Photo required</p>}
          {/* Priority badge — visible to everyone, standalone tasks only */}
          {standalonePos && task.priority === 'high' && (
            <p className="text-xs font-bold text-amber-600 mt-0.5">⭐ High priority</p>
          )}
          {/* Reorder (within the same priority tier) + priority toggle — owner-only */}
          {standalonePos && isOwner && (
            <div className="flex items-center gap-1.5 mt-1.5 -ml-1">
              <button
                onClick={() => handleMoveStandalone(task.id, 'up')}
                disabled={standalonePos.isFirst || standaloneBusyId === task.id}
                aria-label={`Move "${task.title}" up`}
                className="w-9 h-9 flex-shrink-0 bg-gray-100 hover:bg-gray-200 disabled:opacity-30 text-gray-600 font-bold rounded-lg text-sm"
              >
                ↑
              </button>
              <button
                onClick={() => handleMoveStandalone(task.id, 'down')}
                disabled={standalonePos.isLast || standaloneBusyId === task.id}
                aria-label={`Move "${task.title}" down`}
                className="w-9 h-9 flex-shrink-0 bg-gray-100 hover:bg-gray-200 disabled:opacity-30 text-gray-600 font-bold rounded-lg text-sm"
              >
                ↓
              </button>
              <button
                onClick={() => handleTogglePriority(task)}
                disabled={standaloneBusyId === task.id}
                className="h-9 flex-shrink-0 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-600 font-semibold rounded-lg text-xs px-2.5"
              >
                {task.priority === 'high' ? 'Make normal' : '⭐ Make high'}
              </button>
            </div>
          )}
          {/* Owners only, one-off tasks only (repeating tasks are edited/deleted from the Repeating tab) */}
          {isOwner && task.template_id === null && (
            <div className="flex items-center -ml-2 mt-1">
              <button
                onClick={() => setEditingTask(task)}
                className="text-xs font-semibold text-blue-600 hover:text-blue-700 px-2 py-2"
              >
                Edit
              </button>
              <button
                onClick={() => setDeleting(task)}
                className="text-xs font-semibold text-red-600 hover:text-red-700 px-2 py-2"
              >
                Delete
              </button>
            </div>
          )}
        </div>
        {task.photo_allowed && (
          <button
            onClick={() => openPhotoPicker(task.id)}
            disabled={uploadingId === task.id}
            aria-label={task.photo_url ? 'Replace photo' : 'Add photo'}
            className={`flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center border-2 overflow-hidden disabled:opacity-50 ${
              photoNudgeId === task.id ? 'border-amber-400 bg-amber-50 animate-pulse' : 'border-gray-200 bg-gray-50'
            }`}
          >
            {uploadingId === task.id ? (
              <span className="w-5 h-5 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
            ) : task.photo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={task.photo_url} alt="" className="w-full h-full object-cover" />
            ) : (
              <CameraIcon className="w-6 h-6 text-gray-500" />
            )}
          </button>
        )}
      </div>
    )
  }

  const renderDoneCard = (task: TaskInstance) => (
    <div key={task.id} className="bg-gray-100 rounded-2xl border border-gray-200 px-4 py-3 flex items-center gap-3 opacity-80">
      <span className="flex-shrink-0 w-8 h-8 rounded-full bg-green-500 text-white flex items-center justify-center font-bold">✓</span>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-gray-500 line-through leading-tight">{task.title}</p>
        <p className="text-xs text-gray-500 mt-0.5">
          {task.completed_by && <StaffName name={task.completed_by} staff={staff} />}
          {task.completed_at ? ` · ${formatTime(task.completed_at)}` : ''}
        </p>
        {task.due_time && <p className="text-xs text-gray-400 mt-0.5">Due by {formatDueTime(task.due_time)}</p>}
        {renderStepsBlock(task, true)}
        {/* The API only ever returns tasks due today (and done) here, so every
            card shown is same-day by construction — no extra date check needed
            client-side. History (a separate view, separate query) never renders
            this card. */}
        {canManage && (
          <button
            onClick={() => handleUndo(task)}
            disabled={undoingId === task.id}
            className="text-xs font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-50 -ml-2 mt-1 px-2 py-2"
          >
            {undoingId === task.id ? 'Undoing…' : 'Undo'}
          </button>
        )}
      </div>
      {task.photo_url && (
        <a href={task.photo_url} target="_blank" rel="noreferrer" className="flex-shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={task.photo_url} alt="Task photo" className="w-12 h-12 rounded-lg object-cover border border-gray-200" />
        </a>
      )}
    </div>
  )

  const checklistGroups = buildChecklistGroups(open, done)
  const standaloneOpen = sortStandalone(open.filter((t) => t.checklist_name === null))
  const standaloneDone = done.filter((t) => t.checklist_name === null)

  const views: View[] = isOwner ? ['today', 'history', 'missed', 'templates'] : ['today']

  // View-switcher tabs + "+ Add Task", as one unit (combined-header patch:
  // Add Task relocated here, right at the top of the actual task list, so
  // the "Jump to Tasks" anchor lands on the same spot whether this renders
  // above Notes (history/missed/templates — no Notes section on those views
  // to skip past) or below it (today view, right where the task list starts).
  const taskListHeader = (
    <div id="todo-task-list-start" className="flex items-center gap-2 mb-5">
      {views.length > 1 ? (
        <div className="flex-1 flex gap-1 bg-white rounded-xl p-1 border border-gray-100">
          {views.map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`flex-1 min-h-[40px] rounded-lg text-sm font-semibold transition-colors ${
                view === v ? 'bg-[#1a7a3c] text-white' : 'text-gray-500'
              }`}
            >
              {VIEW_LABELS[v]}{v === 'missed' && missedCount > 0 ? ` (${missedCount})` : ''}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex-1" />
      )}
      <button
        onClick={handleAddClick}
        className="flex-shrink-0 bg-[#c8102e] hover:bg-[#a50d26] text-white font-semibold px-4 min-h-[44px] rounded-xl text-sm transition-colors"
      >
        + Add Task
      </button>
    </div>
  )

  return (
    <div className="min-h-screen flex flex-col bg-[#d4edda]">
      <Navigation />

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6">
        <div className="mb-3 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Store Communication/To-Do</h1>
            <p className="text-sm text-gray-500 mt-1">{formatDateShort(today)}</p>
          </div>
          <button
            onClick={() => setShowAddNote(true)}
            className="flex-shrink-0 bg-[#c8102e] hover:bg-[#a50d26] text-white font-semibold px-4 min-h-[44px] rounded-xl text-sm transition-colors"
          >
            + Add Note
          </button>
        </div>

        <button
          onClick={scrollToTasks}
          className="mb-5 text-sm font-semibold text-blue-600 hover:text-blue-700"
        >
          ↓ Jump to Tasks
        </button>

        {view !== 'today' && isOwner && taskListHeader}

        {notice && (
          <div className="mb-4 bg-white border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-sm font-semibold">
            {notice}
          </div>
        )}

        {view === 'today' && (
          <>
            {error && <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3">{error}</div>}

            <NotesBoard
              staff={staff}
              canManage={canManage}
              isOwner={isOwner}
              shiftLeadName={role === 'shift_lead' ? getShiftLeadName() : null}
              showAdd={showAddNote}
              setShowAdd={setShowAddNote}
            />

            {taskListHeader}

            <h2 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">
              Today&apos;s Tasks{open.length > 0 ? ` (${open.length})` : ''}
            </h2>

            {loading ? (
              <p className="text-gray-400 text-center py-10">Loading…</p>
            ) : open.length === 0 && checklistGroups.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-10 text-center">
                <p className="text-2xl mb-1">🎉</p>
                <p className="text-gray-500 font-medium">All done for today!</p>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {/* Named checklists (Opening, Closing, Time to Lean, …), in a fixed order.
                    Completed items stay in place within their section, checked and greyed,
                    so a checklist still reads top-to-bottom like the paper form — they don't
                    move down to Completed Today, which only covers the standalone list below. */}
                {checklistGroups.map((group) => {
                  const expanded = expandedChecklists.has(group.name)
                  return (
                    <section key={group.name}>
                      <button
                        type="button"
                        onClick={() => toggleChecklist(group.name)}
                        aria-expanded={expanded}
                        className="w-full min-h-[48px] flex items-center justify-between gap-3 px-4 py-3 mb-3 bg-white rounded-xl border border-gray-100 shadow-sm active:bg-gray-50 transition-colors"
                      >
                        <span className="text-sm font-bold text-gray-900">{group.name}</span>
                        <span className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-xs font-semibold text-gray-400">{group.done} / {group.total} done</span>
                          <svg
                            className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                          </svg>
                        </span>
                      </button>
                      {expanded && (
                        <div className="flex flex-col gap-4">
                          {group.sections.map((section) => (
                            <div key={section.name}>
                              {section.name && (
                                <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">{section.name}</p>
                              )}
                              <div className="flex flex-col gap-2">
                                {section.items.map((task) => (task.status === 'done' ? renderDoneCard(task) : renderOpenCard(task)))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  )
                })}

                {/* Standalone items (one-offs and anything not part of a named checklist) */}
                {standaloneOpen.length > 0 && (
                  <div className="flex flex-col gap-2">
                    {checklistGroups.length > 0 && (
                      <p className="text-xs font-bold uppercase tracking-widest text-gray-400 -mb-2">To-Do</p>
                    )}
                    {standaloneOpen.map((task, i) =>
                      renderOpenCard(task, { isFirst: i === 0 || task.priority !== standaloneOpen[i - 1].priority, isLast: i === standaloneOpen.length - 1 || task.priority !== standaloneOpen[i + 1].priority })
                    )}
                  </div>
                )}
                {checklistGroups.length > 0 && standaloneOpen.length === 0 && (
                  <p className="text-gray-400 text-sm text-center">Nothing else to do today.</p>
                )}
              </div>
            )}

            <div className="mt-6">
              <button
                onClick={() => setShowDone((s) => !s)}
                aria-expanded={showDone}
                className="w-full min-h-[48px] flex items-center justify-between gap-3 px-4 py-3 bg-white rounded-xl border border-gray-100 shadow-sm"
              >
                <span className="text-xs font-bold uppercase tracking-widest text-gray-500">
                  Completed Today ({standaloneDone.length})
                </span>
                <svg
                  className={`w-4 h-4 text-gray-400 transition-transform ${showDone ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showDone && (
                <div className="mt-2 flex flex-col gap-2">
                  {standaloneDone.length === 0 && <p className="text-gray-400 text-sm text-center py-4">Nothing completed yet today.</p>}
                  {standaloneDone.map(renderDoneCard)}
                </div>
              )}
            </div>
          </>
        )}

        {view === 'history' && isOwner && <HistoryView staff={staff} />}
        {view === 'missed' && isOwner && <MissedView staff={staff} />}
        {view === 'templates' && isOwner && <TemplatesView staff={staff} onChanged={notifyTasksChanged} />}
      </main>

      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoSelected} />

      {completing && (
        <StaffPicker
          staff={staff}
          title={`Done: ${completing.title}`}
          busy={completingBusy}
          onPick={handlePickName}
          onClose={() => setCompleting(null)}
        />
      )}

      {pickingStepFor && (
        <StaffPicker
          staff={staff}
          title={`Checking off: ${pickingStepFor.task.title}`}
          onPick={handleStepNamePicked}
          onClose={() => setPickingStepFor(null)}
        />
      )}

      {showPin && (
        <PinModal
          onSuccess={() => {
            setPinUnlocked(true)
            setShowPin(false)
            setShowAdd(true)
          }}
          onClose={() => setShowPin(false)}
        />
      )}

      {deleting && (
        <ConfirmModal
          message={`Permanently delete “${deleting.title}”? This can't be undone.`}
          busy={deleteBusy}
          onConfirm={handleDeleteTask}
          onCancel={() => setDeleting(null)}
        />
      )}

      {showAdd && <TaskFormModal staff={staff} onClose={() => setShowAdd(false)} onSaved={afterTaskSaved} />}

      {editingTask && (
        <TaskFormModal
          staff={staff}
          instance={editingTask}
          onClose={() => setEditingTask(null)}
          onSaved={afterTaskSaved}
        />
      )}
    </div>
  )
}
