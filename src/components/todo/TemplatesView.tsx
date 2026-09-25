'use client'

import { useCallback, useEffect, useState } from 'react'
import { Staff, TaskTemplate, describeRecurrence, photoSettingOf } from '@/lib/tasks'
import TaskFormModal from './TaskFormModal'

// Owner-only: edit or deactivate recurring task templates (never hard-deleted).
export default function TemplatesView({ staff, onChanged }: { staff: Staff[]; onChanged: () => void }) {
  const [templates, setTemplates] = useState<TaskTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<TaskTemplate | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/task-templates')
      if (!res.ok) throw new Error()
      setTemplates(await res.json())
      setError('')
    } catch {
      setError('Could not load recurring tasks. Try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const toggleActive = async (t: TaskTemplate) => {
    setBusyId(t.id)
    try {
      const res = await fetch('/api/task-templates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: t.id, active: !t.active }),
      })
      if (!res.ok) throw new Error()
      await load()
      onChanged()
    } catch {
      setError('Could not update. Try again.')
    } finally {
      setBusyId(null)
    }
  }

  if (loading) return <p className="text-gray-400 text-center py-10">Loading…</p>

  return (
    <div>
      {error && <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3">{error}</div>}
      {templates.length === 0 && !error && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-10 text-center">
          <p className="text-gray-400">No recurring tasks yet. Use “+ Add Task” and choose “Repeats”.</p>
        </div>
      )}
      <div className="flex flex-col gap-2">
        {templates.map((t) => (
          <div
            key={t.id}
            className={`bg-white rounded-2xl shadow-sm border border-gray-100 px-4 py-3 ${t.active ? '' : 'opacity-60'}`}
          >
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-gray-900">{t.title}</p>
              {!t.active && <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-gray-100 text-gray-500">OFF</span>}
            </div>
            <p className="text-sm text-gray-500 mt-0.5">
              {describeRecurrence(t)} · photo {photoSettingOf(t)} · assigned to {t.created_by}
            </p>
            {t.description && <p className="text-sm text-gray-400 mt-0.5">{t.description}</p>}
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => setEditing(t)}
                className="flex-1 min-h-[44px] bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-xl text-sm"
              >
                Edit
              </button>
              <button
                onClick={() => toggleActive(t)}
                disabled={busyId === t.id}
                className={`flex-1 min-h-[44px] font-semibold rounded-xl text-sm disabled:opacity-50 ${
                  t.active ? 'bg-red-50 hover:bg-red-100 text-red-600' : 'bg-green-50 hover:bg-green-100 text-green-700'
                }`}
              >
                {t.active ? 'Turn off' : 'Turn on'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <TaskFormModal
          staff={staff}
          template={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            load()
            onChanged()
          }}
        />
      )}
    </div>
  )
}
