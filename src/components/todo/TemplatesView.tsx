'use client'

import { useCallback, useEffect, useState } from 'react'
import StaffName from '@/components/StaffName'
import { Staff, TaskTemplate, Recurrence, buildTemplateChecklistGroups, describeRecurrence, photoSettingOf, formatDueTime } from '@/lib/tasks'
import TaskFormModal from './TaskFormModal'
import AddChecklistItemModal from './AddChecklistItemModal'
import RenameSectionModal from './RenameSectionModal'
import TimeField from './TimeField'

// Owner-only: edit or deactivate recurring task templates (never hard-deleted),
// plus — for the three named checklists — add a new line item to an existing
// section, reorder items within a section, rename a section's label, and set
// the checklist's default due time.
export default function TemplatesView({ staff, onChanged }: { staff: Staff[]; onChanged: () => void }) {
  const [templates, setTemplates] = useState<TaskTemplate[]>([])
  const [checklistDefaults, setChecklistDefaults] = useState<Record<string, string | null>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<TaskTemplate | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [moveBusyId, setMoveBusyId] = useState<string | null>(null)
  const [savingDefault, setSavingDefault] = useState<string | null>(null)
  const [expandedChecklists, setExpandedChecklists] = useState<Set<string>>(new Set())
  const [addingTo, setAddingTo] = useState<{
    checklistName: string
    sections: string[]
    sectionRecurrence: Record<string, { recurrence: Recurrence; weekday: number | null; custom_days: number[] | null }>
  } | null>(null)
  const [renaming, setRenaming] = useState<{ checklistName: string; section: string; otherSections: string[] } | null>(null)

  const load = useCallback(async () => {
    try {
      const [templatesRes, checklistsRes] = await Promise.all([fetch('/api/task-templates'), fetch('/api/checklists')])
      if (!templatesRes.ok) throw new Error()
      setTemplates(await templatesRes.json())
      if (checklistsRes.ok) {
        const rows: { name: string; due_time: string | null }[] = await checklistsRes.json()
        setChecklistDefaults(Object.fromEntries(rows.map((r) => [r.name, r.due_time])))
      }
      setError('')
    } catch {
      setError('Could not load recurring tasks. Try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: fetches on mount, this app's standard load-on-mount pattern
    load()
  }, [load])

  const saveDefaultDueTime = async (name: string, due_time: string | null) => {
    setSavingDefault(name)
    try {
      const res = await fetch('/api/checklists', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, due_time }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Could not save. Try again.')
      setChecklistDefaults((prev) => ({ ...prev, [name]: due_time }))
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. Try again.')
    } finally {
      setSavingDefault(null)
    }
  }

  // Patch 34: flips `active` in local state immediately, before the request
  // resolves, so the card jumps to the active block or the turned-off block
  // right away on tap -- no page reload, and no waiting on the round-trip.
  // Reconciles with the server's response on success (in case anything else
  // about the row changed); reverts the optimistic flip on failure.
  const toggleActive = async (t: TaskTemplate) => {
    setBusyId(t.id)
    setError('')
    const nextActive = !t.active
    setTemplates((prev) => prev.map((x) => (x.id === t.id ? { ...x, active: nextActive } : x)))
    try {
      const res = await fetch('/api/task-templates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: t.id, active: nextActive }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error || 'Could not update. Try again.')
      const saved: TaskTemplate = body.template
      setTemplates((prev) => prev.map((x) => (x.id === t.id ? { ...x, ...saved } : x)))
      onChanged()
    } catch (e) {
      setTemplates((prev) => prev.map((x) => (x.id === t.id ? { ...x, active: t.active } : x)))
      setError(e instanceof Error ? e.message : 'Could not update. Try again.')
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
  const activeStandalone = standalone.filter((t) => t.active)

  // Patch 34: turned-off tasks move to one block at the bottom of the whole
  // page (not one per section — the point is not scrolling past them), in
  // their same relative order (walking checklists, then sections, then
  // standalone, top to bottom — the same order they'd appear in above if
  // nothing were turned off). Each carries where it came from, since it's no
  // longer sitting inside that section to show it implicitly.
  const turnedOff: { template: TaskTemplate; contextLabel: string }[] = []
  for (const group of checklistGroups) {
    for (const section of group.sections) {
      for (const t of section.items) {
        if (!t.active) turnedOff.push({ template: t, contextLabel: `${group.name} — ${section.name}` })
      }
    }
  }
  for (const t of standalone) {
    if (!t.active) turnedOff.push({ template: t, contextLabel: 'Other Repeating Tasks' })
  }

  // Same card for a checklist item or a plain standalone recurring task — `pos`
  // (only passed for an active item within its own section) adds the
  // within-section reorder arrows; those don't apply once a card has moved to
  // the turned-off block below, since it's no longer sitting in that section.
  // `contextLabel` (patch 34, turned-off block only) names the checklist/
  // section a turned-off card came from, since it's no longer visibly inside it.
  const renderCard = (t: TaskTemplate, pos?: { isFirst: boolean; isLast: boolean }, contextLabel?: string) => (
    <div key={t.id} className={`bg-white rounded-2xl shadow-sm border border-gray-100 px-4 py-3 ${t.active ? '' : 'opacity-60'}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <p className="font-semibold text-gray-900">{t.title}</p>
        {!t.active && <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-gray-100 text-gray-500">OFF</span>}
      </div>
      {contextLabel && <p className="text-xs font-semibold text-gray-400 mt-0.5">{contextLabel}</p>}
      <p className="text-sm text-gray-500 mt-0.5">
        {describeRecurrence(t)} · photo {photoSettingOf(t)} · assigned to <StaffName name={t.assigned_to} staff={staff} />
      </p>
      {t.due_time && <p className="text-sm text-gray-400 mt-0.5">Due by {formatDueTime(t.due_time)}</p>}
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
                  <div className="flex items-center gap-3 bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3">
                    <label className="text-xs font-semibold text-gray-500 flex-1">Default due time</label>
                    <TimeField
                      value={checklistDefaults[group.name] ?? null}
                      onChange={(value) => saveDefaultDueTime(group.name, value || null)}
                      disabled={savingDefault === group.name}
                    />
                  </div>
                  {group.sections.map((section) => {
                    // Patch 34: only active items render here, in their
                    // existing order; a turned-off item moves to the block at
                    // the bottom of the page instead. isFirst/isLast (for the
                    // reorder arrows) are computed against this same active-
                    // only list, since that's what's actually showing.
                    const activeItems = section.items.filter((t) => t.active)
                    return (
                      <div key={section.name}>
                        <div className="flex items-center justify-between gap-3 mb-2">
                          <p className="text-xs font-bold uppercase tracking-widest text-gray-400">{section.name}</p>
                          <button
                            onClick={() =>
                              setRenaming({
                                checklistName: group.name,
                                section: section.name,
                                otherSections: sectionNames.filter((n) => n !== section.name),
                              })
                            }
                            className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex-shrink-0"
                          >
                            Rename
                          </button>
                        </div>
                        <div className="flex flex-col gap-2">
                          {activeItems.length > 0
                            ? activeItems.map((t, i) => renderCard(t, { isFirst: i === 0, isLast: i === activeItems.length - 1 }))
                            : <p className="text-sm text-gray-400">No active items — see Turned off below.</p>}
                        </div>
                      </div>
                    )
                  })}
                  <button
                    onClick={() =>
                      setAddingTo({
                        checklistName: group.name,
                        sections: sectionNames,
                        // Pre-fill default for each section from an existing sibling item in
                        // it — every section passed in here always has at least one, since
                        // these names come from already-grouped existing templates.
                        sectionRecurrence: Object.fromEntries(
                          group.sections.map((s) => [
                            s.name,
                            { recurrence: s.items[0].recurrence, weekday: s.items[0].weekday, custom_days: s.items[0].custom_days },
                          ])
                        ),
                      })
                    }
                    className="w-full min-h-[48px] bg-white border-2 border-dashed border-gray-200 hover:border-green-400 text-gray-500 hover:text-green-700 font-semibold rounded-xl text-sm transition-colors"
                  >
                    + Add Item
                  </button>
                </div>
              )}
            </section>
          )
        })}

        {activeStandalone.length > 0 && (
          <div className="flex flex-col gap-2">
            {checklistGroups.length > 0 && (
              <p className="text-xs font-bold uppercase tracking-widest text-gray-400 -mb-2">Other Repeating Tasks</p>
            )}
            {activeStandalone.map((t) => renderCard(t))}
          </div>
        )}

        {turnedOff.length > 0 && (
          <div>
            {/* Quiet divider -- gray/muted, not red/green/amber/blue/purple/pink/
                teal, so it doesn't borrow a color meaning already used elsewhere
                on this page (off-badge gray stays consistent, not a new meaning). */}
            <div className="flex items-center gap-3 mb-3">
              <div className="flex-1 h-px bg-gray-200" />
              <span className="text-xs font-bold uppercase tracking-widest text-gray-400 flex-shrink-0">
                Turned off ({turnedOff.length})
              </span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>
            <div className="flex flex-col gap-2">
              {turnedOff.map(({ template, contextLabel }) => renderCard(template, undefined, contextLabel))}
            </div>
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
          sectionRecurrence={addingTo.sectionRecurrence}
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
          otherSections={renaming.otherSections}
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
