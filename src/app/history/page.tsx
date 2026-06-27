'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Navigation from '@/components/Navigation'
import { getRole } from '@/lib/auth'
import { InventoryCount } from '@/lib/types'

interface VelocityRow {
  item_id: string
  name: string
  category: string
  unit: string
  consumed: number
}

export default function HistoryPage() {
  const router = useRouter()
  const [history, setHistory] = useState<InventoryCount[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'recent' | 'top10'>('top10')
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set())

  const [top10, setTop10] = useState<VelocityRow[]>([])
  const [top10Loading, setTop10Loading] = useState(false)
  const [top10Fetched, setTop10Fetched] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    const role = getRole()
    if (!role) { router.replace('/login'); return }
    if (role !== 'owner') { router.replace('/count'); return }
    fetchHistory()
    fetchTop10()
  }, [router])

  const fetchHistory = async () => {
    try {
      const res = await fetch('/api/counts?limit=500')
      const data = await res.json()
      setHistory(data)
    } finally {
      setLoading(false)
    }
  }

  const fetchTop10 = async () => {
    if (top10Fetched) return
    setTop10Loading(true)
    try {
      const end = new Date().toISOString().split('T')[0]
      const startDate = new Date()
      startDate.setDate(startDate.getDate() - 90)
      const start = startDate.toISOString().split('T')[0]
      const res = await fetch(`/api/reports/velocity?start=${start}&end=${end}`)
      const data: VelocityRow[] = await res.json()
      setTop10(data.filter((r) => r.consumed > 0).slice(0, 10))
      setTop10Fetched(true)
    } finally {
      setTop10Loading(false)
    }
  }

  const handleViewChange = (v: 'recent' | 'top10') => {
    setView(v)
    if (v === 'top10') fetchTop10()
  }

  const toggleDay = (day: string) => {
    setExpandedDays((prev) => {
      const next = new Set(prev)
      next.has(day) ? next.delete(day) : next.add(day)
      return next
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-400 text-lg">Loading…</p>
      </div>
    )
  }

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  }

  const searchTerm = search.trim().toLowerCase()
  const filteredHistory = searchTerm
    ? history.filter((h) => h.items?.name?.toLowerCase().includes(searchTerm))
    : history

  const grouped: Record<string, InventoryCount[]> = {}
  filteredHistory.forEach((h) => {
    const day = new Date(h.created_at).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    })
    if (!grouped[day]) grouped[day] = []
    grouped[day].push(h)
  })

  const maxConsumed = top10.length > 0 ? top10[0].consumed : 1

  const medalColor = (rank: number) => {
    if (rank === 0) return 'text-yellow-500'
    if (rank === 1) return 'text-gray-400'
    if (rank === 2) return 'text-amber-600'
    return 'text-gray-300'
  }

  const barColor = (rank: number) => {
    if (rank === 0) return 'bg-yellow-400'
    if (rank < 3) return 'bg-orange-400'
    return 'bg-blue-400'
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#d4edda]">
      <Navigation />

      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Usage History</h1>
          <p className="text-gray-500 mt-1">
            {history.length} count entries recorded
          </p>
        </div>

        {/* View toggle */}
        <div className="flex gap-2 mb-6 bg-gray-100 p-1 rounded-xl w-fit">
          <button
            onClick={() => handleViewChange('recent')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              view === 'recent' ? 'bg-white shadow text-gray-900' : 'text-gray-500'
            }`}
          >
            Recent Counts
          </button>
          <button
            onClick={() => handleViewChange('top10')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              view === 'top10' ? 'bg-white shadow text-gray-900' : 'text-gray-500'
            }`}
          >
            Top 10 Fastest
          </button>
        </div>

        {view === 'recent' && history.length > 0 && (
          <div className="mb-4">
            <input
              type="text"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 focus:outline-none focus:border-blue-400 bg-white text-sm"
              placeholder="Search items…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        )}

        {history.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-12 text-center">
            <p className="text-gray-400 text-lg">No history yet.</p>
            <p className="text-gray-400 text-sm mt-1">
              Counts will appear here after the first entry.
            </p>
          </div>
        ) : view === 'recent' ? (
          Object.keys(grouped).length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-12 text-center">
              <p className="text-gray-400">No results for &ldquo;{search}&rdquo;</p>
            </div>
          ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            {Object.entries(grouped).map(([day, entries], dayIdx, arr) => {
              const isExpanded = expandedDays.has(day)
              // Get unique people who counted that day
              const counters = [...new Set(entries.map((e) => e.entered_by).filter((n) => n && n !== 'shift_lead'))]
              return (
                <div key={day} className={dayIdx < arr.length - 1 ? 'border-b border-gray-100' : ''}>
                  <button
                    onClick={() => toggleDay(day)}
                    className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors text-left"
                  >
                    <div>
                      <p className="font-semibold text-gray-900">{day}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {entries.length} items counted
                        {counters.length > 0 && ` · ${counters.join(', ')}`}
                      </p>
                    </div>
                    <svg className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {isExpanded && (
                    <div className="border-t border-gray-100">
                      {entries.map((entry, idx) => (
                        <div
                          key={entry.id}
                          className={`flex items-center gap-4 px-5 py-3 bg-gray-50 ${
                            idx < entries.length - 1 ? 'border-b border-gray-100' : ''
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-gray-900 text-sm flex items-center gap-2">
                              {entry.items?.name ?? '—'}
                              {entry.type === 'adjustment' && (
                                <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">Adj</span>
                              )}
                            </p>
                            <p className="text-xs text-gray-400">
                              {entry.items?.category}
                              {entry.notes && <span className="text-amber-600 italic"> · {entry.notes}</span>}
                            </p>
                          </div>
                          <span className="font-bold text-gray-900">
                            {entry.count}
                            <span className="text-xs font-normal text-gray-400 ml-1">{entry.items?.unit}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          )
        ) : (
          <div>
            <p className="text-xs text-gray-400 mb-4">
              Based on the last 90 days of count data. Updates each time you open this tab.
            </p>
            {top10Loading ? (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-12 text-center">
                <p className="text-gray-400">Calculating…</p>
              </div>
            ) : top10.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-12 text-center">
                <p className="text-gray-400">Not enough count history yet to calculate velocity.</p>
                <p className="text-gray-400 text-sm mt-1">Enter counts on at least two different days.</p>
              </div>
            ) : (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                {top10.map((row, idx) => (
                  <div
                    key={row.item_id}
                    className={`px-5 py-4 ${idx < top10.length - 1 ? 'border-b border-gray-100' : ''}`}
                  >
                    <div className="flex items-center gap-4">
                      <span className={`text-2xl font-black w-8 text-center flex-shrink-0 ${medalColor(idx)}`}>
                        {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-gray-900">{row.name}</p>
                        <p className="text-xs text-gray-400">{row.category} · {row.unit}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="font-bold text-gray-900 text-lg">{row.consumed}</p>
                        <p className="text-xs text-gray-400">used</p>
                      </div>
                    </div>
                    <div className="mt-2.5 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${barColor(idx)}`}
                        style={{ width: `${(row.consumed / maxConsumed) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
