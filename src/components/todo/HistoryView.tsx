'use client'

import { useCallback, useEffect, useState } from 'react'
import { TaskInstance, todayInTZ, addDays, formatDateShort, formatDateTime, formatDueTime, groupHistoryByDay } from '@/lib/tasks'

// Fixed default range — browsing the default shows day-grouped sections;
// any other range (the owner changed a date and clicked Update) flattens
// to a single list instead, since day grouping is for browsing and a
// flattened list is easier to scan when searching for something specific.
const DEFAULT_START = addDays(todayInTZ(), -30)
const DEFAULT_END = todayInTZ()

// Owner-only: 30-day (adjustable) range of every task instance.
export default function HistoryView() {
  const [startDate, setStartDate] = useState(DEFAULT_START)
  const [endDate, setEndDate] = useState(DEFAULT_END)
  const [rows, setRows] = useState<TaskInstance[]>([])
  const [grouped, setGrouped] = useState(true)
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (start: string, end: string) => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/tasks?view=history&start=${start}&end=${end}`)
      if (!res.ok) throw new Error()
      setRows(await res.json())
      setGrouped(start === DEFAULT_START && end === DEFAULT_END)
    } catch {
      setError('Could not load history. Try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(DEFAULT_START, DEFAULT_END)
  }, [load])

  const toggleDay = (date: string) => {
    setExpandedDays((prev) => {
      const next = new Set(prev)
      if (next.has(date)) next.delete(date)
      else next.add(date)
      return next
    })
  }

  const renderRow = (t: TaskInstance) => (
    <div key={t.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 px-4 py-3 flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-semibold text-gray-900">{t.title}</p>
          <span
            className={`text-xs font-bold px-2 py-0.5 rounded-md ${
              t.status === 'done' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
            }`}
          >
            {t.status === 'done' ? 'DONE' : 'OPEN'}
          </span>
        </div>
        <p className="text-sm text-gray-500 mt-0.5">
          Due {formatDateShort(t.due_date)}{t.due_time ? ` at ${formatDueTime(t.due_time)}` : ''} · assigned to {t.assigned_to} · added by {t.created_by}
        </p>
        {t.status === 'done' && t.completed_by && t.completed_at && (
          <p className="text-sm text-gray-500">Done by {t.completed_by} · {formatDateTime(t.completed_at)}</p>
        )}
      </div>
      {t.photo_url && (
        <a href={t.photo_url} target="_blank" rel="noreferrer" className="flex-shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={t.photo_url} alt="Task photo" className="w-14 h-14 rounded-lg object-cover border border-gray-200" />
        </a>
      )}
    </div>
  )

  const dayGroups = grouped ? groupHistoryByDay(rows) : []

  return (
    <div>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-4">
        <div className="flex flex-wrap gap-4 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="border border-gray-200 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:border-green-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="border border-gray-200 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:border-green-500"
            />
          </div>
          <button
            onClick={() => load(startDate, endDate)}
            disabled={loading || !startDate || !endDate}
            className="bg-[#1a7a3c] hover:bg-[#155f2f] disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold px-6 py-2 rounded-xl transition-colors"
          >
            {loading ? 'Loading…' : 'Update'}
          </button>
        </div>
      </div>

      {error && <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3">{error}</div>}

      {!loading && rows.length === 0 && !error && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-10 text-center">
          <p className="text-gray-400">No tasks in this range.</p>
        </div>
      )}

      {grouped ? (
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
                    <span className="text-xs font-semibold text-gray-400">{group.items.length} task{group.items.length === 1 ? '' : 's'}</span>
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
                {expanded && <div className="mt-2 flex flex-col gap-2">{group.items.map(renderRow)}</div>}
              </section>
            )
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-2">{rows.map(renderRow)}</div>
      )}
    </div>
  )
}
