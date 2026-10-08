'use client'

import { useCallback, useEffect, useState } from 'react'
import { Staff, TaskTemplate, buildTemplateChecklistGroups, describeRecurrence, photoSettingOf } from '@/lib/tasks'
import TaskFormModal from './TaskFormModal'
import AddChecklistItemModal from './AddChecklistItemModal'
import RenameSectionModal from './RenameSectionModal'

// Owner-only: edit or deactivate recurring task templates (never hard-deleted),
// plus — for the three named checklists — add a new line item to an existing
// section, reorder items within a section, and rename a section's label.
export default function TemplatesView({ staff, onChanged }: { staff: Staff[]; onChanged: () => void }) {
  const [templates, setTemplates] = useState<TaskTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<TaskTemplate | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [moveBusyId, setMoveBusyId] = useState<string | null>(null)
  const [expandedChecklists, setExpandedChecklists] = useState<Set<string>>(new Set())
  const [addingTo, setAddingTo] = useState<{ checklistName: string; sections: string[] } | null>(null)
  const [renaming, setRenaming] = useState<{ checklistName: string; section: string } | null>(null)

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

  const toggleChecklist = (name: string) => {
    setExpandedChecklists((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const move = async (id: string, direction: 'up' | 'down') => {
    setMoveBusyId(id)
    try {
      const res = await fetch('/api/task-templates/checklist-item', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, direction }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Could not reorder. Try again.')
      await load()
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reorder. Try again.')
    } finally {
      setMoveBusyId(null)
    }
  }

  if (loading) return <p className="text-gray-400 text-center py-10">Loading…</p>

  const checklistGroups = buildTemplateChecklistGroups(templates)
  const standalone = templates.filter((t) => t.checklist_name === null)

  // Same card for a checklist item or a plain standalone recurring task — `pos`
  // (only passed for checklist items) adds the within-section reorder arrows.
  const renderCard = (t: TaskTemplate, pos?: { isFirst: boolean; isLast: boolean }) => (
    <div key={t.id} className={`bg-white rounded-2xl shadow-sm border border-gray-100 px-4 py-3 ${t.active ? '' : 'opacity-60'}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <p className="font-semibold text-gray-900">{t.title}</p>
        {!t.active && <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-gray-100 text-gray-500">OFF</span>}
      </div>
      <p className="text-sm text-gray-500 mt-0.5">
        {describeRecurrence(t)} · photo {photoSettingOf(t)} · assigned to {t.assigned_to}
      </p>
      {t.description && <p className="text-sm text-gray-400 mt-0.5">{t.description}</p>}
      <div className="flex gap-2 mt-3">
        {pos && (
          <div className="flex gap-1 flex-shrink-0">
            <button
              onClick={() => move(t.id, 'up')}
              disabled={pos.isFirst || moveBusyId === t.id}
              aria-label={`Move "${t.title}" up`}
              className="w-11 min-h-[44px] bg-gray-100 hover:bg-gray-200 disabled:opacity-30 text-gray-600 font-bold rounded-xl text-sm"
            >
              ↑
            </button>
            <button
              onClick={() => move(t.id, 'down')}
              disabled={pos.isLast || moveBusyId === t.id}
              aria-label={`Move "${t.title}" down`}
              className="w-11 min-h-[44px] bg-gray-100 hover:bg-gray-200 disabled:opacity-30 text-gray-600 font-bold rounded-xl text-sm"
            >
              ↓
            </button>
          </div>
        )}
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
  )

  return (
    <div>
      {error && <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3">{error}</div>}
      {templates.length === 0 && !error && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-10 text-center">
          <p className="text-gray-400">No recurring tasks yet. Use “+ Add Task” and choose “Repeats”.</p>
        </div>
      )}

      <div className="flex flex-col gap-4">
        {checklistGroups.map((group) => {
          const expanded = expandedChecklists.has(group.name)
          const sectionNames = group.sections.map((s) => s.name)
          return (
            <section key={group.name}>
              <button
                type="button"
                onClick={() => toggleChecklist(group.name)}
                aria-expanded={expanded}
                className="w-full min-h-[48px] flex items-center justify-between gap-3 px-4 py-3 mb-3 bg-white rounded-xl border border-gray-100 shadow-sm active:bg-gray-50 transition-colors"
              >
                <span className="text-sm font-bold text-gray-900">{group.name}</span>
                <svg
                  className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${expanded ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {expanded && (
                <div className="flex flex-col gap-4">
                  {group.sections.map((section) => (
                    <div key={section.name}>
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <p className="text-xs font-bold uppercase tracking-widest text-gray-400">{section.name}</p>
                        <button
                          onClick={() => setRenaming({ checklistName: group.name, section: section.name })}
                          className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex-shrink-0"
                        >
                          Rename
                        </button>
                      </div>
                      <div className="flex flex-col gap-2">
                        {section.items.map((t, i) =>
                          renderCard(t, { isFirst: i === 0, isLast: i === section.items.length - 1 })
                        )}
                      </div>
                    </div>
                  ))}
                  <button
                    onClick={() => setAddingTo({ checklistName: group.name, sections: sectionNames })}
                    className="w-full min-h-[48px] bg-white border-2 border-dashed border-gray-200 hover:border-green-400 text-gray-500 hover:text-green-700 font-semibold rounded-xl text-sm transition-colors"
                  >
                    + Add Item
                  </button>
                </div>
              )}
            </section>
          )
        })}

        {standalone.length > 0 && (
          <div className="flex flex-col gap-2">
            {checklistGroups.length > 0 && (
              <p className="text-xs font-bold uppercase tracking-widest text-gray-400 -mb-2">Other Repeating Tasks</p>
            )}
            {standalone.map((t) => renderCard(t))}
          </div>
        )}
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
          // this view is only rendered for owners, so Delete is owner-only
          onDelete={async () => {
            const res = await fetch('/api/task-templates', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: editing.id }),
            })
            if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Could not delete. Try again.')
            setEditing(null)
            await load()
            onChanged()
          }}
        />
      )}

      {addingTo && (
        <AddChecklistItemModal
          staff={staff}
          checklistName={addingTo.checklistName}
          sections={addingTo.sections}
          onClose={() => setAddingTo(null)}
          onSaved={() => {
            setAddingTo(null)
            load()
            onChanged()
          }}
        />
      )}

      {renaming && (
        <RenameSectionModal
          checklistName={renaming.checklistName}
          currentSection={renaming.section}
          onClose={() => setRenaming(null)}
          onSaved={() => {
            setRenaming(null)
            load()
            onChanged()
          }}
        />
      )}
    </div>
  )
}
