'use client'

import { useCallback, useEffect, useState } from 'react'
import { TaskInstance, todayInTZ, addDays, formatDateShort, formatDateTime } from '@/lib/tasks'

// Owner-only: 30-day (adjustable) range of every task instance.
export default function HistoryView() {
  const [startDate, setStartDate] = useState(() => addDays(todayInTZ(), -30))
  const [endDate, setEndDate] = useState(() => todayInTZ())
  const [rows, setRows] = useState<TaskInstance[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (start: string, end: string) => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/tasks?view=history&start=${start}&end=${end}`)
      if (!res.ok) throw new Error()
      setRows(await res.json())
    } catch {
      setError('Could not load history. Try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(addDays(todayInTZ(), -30), todayInTZ())
  }, [load])

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

      <div className="flex flex-col gap-2">
        {rows.map((t) => (
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
              <p className="text-sm text-gray-500 mt-0.5">Due {formatDateShort(t.due_date)} · assigned to {t.assigned_to}</p>
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
        ))}
      </div>
    </div>
  )
}
