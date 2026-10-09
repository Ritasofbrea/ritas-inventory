'use client'

import { useCallback, useEffect, useState } from 'react'
import { TaskInstance, formatDateShort, formatDueTime, groupHistoryByDay } from '@/lib/tasks'

// Owner-only, read-only record of tasks that aged out of Today's Tasks without
// being completed (see sweepMissedInstances in task-server.ts). No checkbox,
// no undo, no way to act on these from here — purely an accountability log.
export default function MissedView() {
  const [rows, setRows] = useState<TaskInstance[]>([])
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/tasks?view=missed')
      if (!res.ok) throw new Error()
      setRows(await res.json())
      setError('')
    } catch {
      setError('Could not load missed tasks. Try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const toggleDay = (date: string) => {
    setExpandedDays((prev) => {
      const next = new Set(prev)
      if (next.has(date)) next.delete(date)
      else next.add(date)
      return next
    })
  }

  const dayGroups = groupHistoryByDay(rows)

  return (
    <div>
      {error && <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3">{error}</div>}

      {loading ? (
        <p className="text-gray-400 text-center py-10">Loading…</p>
      ) : rows.length === 0 && !error ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-10 text-center">
          <p className="text-2xl mb-1">🎉</p>
          <p className="text-gray-500 font-medium">Nothing missed.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {dayGroups.map((group) => {
            const expanded = expandedDays.has(group.date)
            return (
              <section key={group.date}>
                <button
                  type="button"
                  onClick={() => toggleDay(group.date)}
                  aria-expanded={expanded}
                  className="w-full min-h-[48px] flex items-center justify-between gap-3 px-4 py-3 bg-white rounded-xl border border-gray-100 shadow-sm active:bg-gray-50 transition-colors"
                >
                  <span className="text-sm font-bold text-gray-900">{formatDateShort(group.date)}</span>
                  <span className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs font-semibold text-amber-600">
                      {group.items.length} missed
                    </span>
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
                  <div className="mt-2 flex flex-col gap-2">
                    {group.items.map((t) => (
                      <div key={t.id} className="bg-amber-50 rounded-2xl border border-amber-200 px-4 py-3">
                        <p className="font-semibold text-gray-900">{t.title}</p>
                        <p className="text-sm text-gray-500 mt-0.5">
                          {t.checklist_name ? `${t.checklist_name} · ${t.section} · ` : ''}
                          Assigned to {t.assigned_to}
                        </p>
                        <p className="text-sm text-gray-500">
                          Due {formatDateShort(t.due_date)}{t.due_time ? ` at ${formatDueTime(t.due_time)}` : ''}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
