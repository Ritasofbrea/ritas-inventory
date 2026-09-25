'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Navigation from '@/components/Navigation'
import StaffPicker from '@/components/todo/StaffPicker'
import PinModal from '@/components/todo/PinModal'
import TaskFormModal from '@/components/todo/TaskFormModal'
import HistoryView from '@/components/todo/HistoryView'
import TemplatesView from '@/components/todo/TemplatesView'
import StaffView from '@/components/todo/StaffView'
import { getRole } from '@/lib/auth'
import { uploadTaskPhoto } from '@/lib/photo'
import { Role } from '@/lib/types'
import { Staff, TaskInstance, formatDateShort, formatTime, todayInTZ } from '@/lib/tasks'

type View = 'today' | 'history' | 'templates' | 'staff'

const VIEW_LABELS: Record<View, string> = {
  today: 'Today',
  history: 'History',
  templates: 'Repeating',
  staff: 'Staff',
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
  const [uploadingId, setUploadingId] = useState<string | null>(null)
  const [photoNudgeId, setPhotoNudgeId] = useState<string | null>(null)
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
    setRole(getRole())
    loadTasks()
    loadStaff()
  }, [loadTasks, loadStaff])

  // Shared checklist: pick up other people's changes when the tab regains focus and every minute
  useEffect(() => {
    if (view !== 'today') return
    const refresh = () => { if (document.visibilityState === 'visible') loadTasks() }
    document.addEventListener('visibilitychange', refresh)
    const interval = setInterval(refresh, 60000)
    return () => {
      document.removeEventListener('visibilitychange', refresh)
      clearInterval(interval)
    }
  }, [view, loadTasks])

  useEffect(() => {
    return () => { if (noticeTimer.current) clearTimeout(noticeTimer.current) }
  }, [])

  const isOwner = role === 'owner'

  const handleAddClick = () => {
    if (isOwner || pinUnlocked) setShowAdd(true)
    else setShowPin(true)
  }

  const handleCheckboxTap = (task: TaskInstance) => {
    if (task.photo_required && !task.photo_url) {
      setPhotoNudgeId(task.id)
      flash('📷 This task needs a photo before it can be marked done.')
      return
    }
    setCompleting(task)
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

  const afterTaskSaved = (message: string) => {
    setShowAdd(false)
    flash(`✓ ${message}`)
    loadTasks()
    notifyTasksChanged()
  }

  const views: View[] = isOwner ? ['today', 'history', 'templates', 'staff'] : ['today']

  return (
    <div className="min-h-screen flex flex-col bg-[#d4edda]">
      <Navigation />

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">To-Do</h1>
            <p className="text-sm text-gray-500 mt-1">{formatDateShort(today)}</p>
          </div>
          <button
            onClick={handleAddClick}
            className="flex-shrink-0 bg-[#c8102e] hover:bg-[#a50d26] text-white font-semibold px-4 min-h-[44px] rounded-xl text-sm transition-colors"
          >
            + Add Task
          </button>
        </div>

        {views.length > 1 && (
          <div className="flex gap-1 mb-5 bg-white rounded-xl p-1 border border-gray-100">
            {views.map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`flex-1 min-h-[40px] rounded-lg text-sm font-semibold transition-colors ${
                  view === v ? 'bg-[#1a7a3c] text-white' : 'text-gray-500'
                }`}
              >
                {VIEW_LABELS[v]}
              </button>
            ))}
          </div>
        )}

        {notice && (
          <div className="mb-4 bg-white border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-sm font-semibold">
            {notice}
          </div>
        )}

        {view === 'today' && (
          <>
            {error && <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3">{error}</div>}

            <h2 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">
              Today&apos;s Tasks{open.length > 0 ? ` (${open.length})` : ''}
            </h2>

            {loading ? (
              <p className="text-gray-400 text-center py-10">Loading…</p>
            ) : open.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-10 text-center">
                <p className="text-2xl mb-1">🎉</p>
                <p className="text-gray-500 font-medium">All done for today!</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {open.map((task) => {
                  const overdue = task.due_date < today
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
                        {overdue && (
                          <p className="text-xs font-bold text-red-600 mt-0.5">⚠️ Overdue — was due {formatDateShort(task.due_date)}</p>
                        )}
                        {task.description && <p className="text-sm text-gray-500 mt-0.5">{task.description}</p>}
                        {needsPhoto && <p className="text-xs font-semibold text-amber-700 mt-0.5">📷 Photo required</p>}
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
                })}
              </div>
            )}

            <div className="mt-6">
              <button
                onClick={() => setShowDone((s) => !s)}
                aria-expanded={showDone}
                className="w-full min-h-[48px] flex items-center justify-between gap-3 px-4 py-3 bg-white rounded-xl border border-gray-100 shadow-sm"
              >
                <span className="text-xs font-bold uppercase tracking-widest text-gray-500">
                  Completed Today ({done.length})
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
                  {done.length === 0 && <p className="text-gray-400 text-sm text-center py-4">Nothing completed yet today.</p>}
                  {done.map((task) => (
                    <div key={task.id} className="bg-gray-100 rounded-2xl border border-gray-200 px-4 py-3 flex items-center gap-3 opacity-80">
                      <span className="flex-shrink-0 w-8 h-8 rounded-full bg-green-500 text-white flex items-center justify-center font-bold">✓</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-500 line-through leading-tight">{task.title}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {task.completed_by}
                          {task.completed_at ? ` · ${formatTime(task.completed_at)}` : ''}
                        </p>
                      </div>
                      {task.photo_url && (
                        <a href={task.photo_url} target="_blank" rel="noreferrer" className="flex-shrink-0">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={task.photo_url} alt="Task photo" className="w-12 h-12 rounded-lg object-cover border border-gray-200" />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {view === 'history' && isOwner && <HistoryView />}
        {view === 'templates' && isOwner && <TemplatesView staff={staff} onChanged={notifyTasksChanged} />}
        {view === 'staff' && isOwner && (
          <StaffView
            onChanged={() => {
              loadStaff()
            }}
          />
        )}
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

      {showAdd && <TaskFormModal staff={staff} onClose={() => setShowAdd(false)} onSaved={afterTaskSaved} />}
    </div>
  )
}
