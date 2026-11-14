'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Navigation from '@/components/Navigation'
import BackToTop from '@/components/BackToTop'
import { getRole } from '@/lib/auth'
import { InventoryCount, CATEGORIES } from '@/lib/types'
import { todayInTZ, addDays } from '@/lib/tasks'
import { unitLabel } from '@/lib/units'
import InvoiceHistoryList from '@/components/InvoiceHistoryList'

interface VelocityRow {
  item_id: string
  name: string
  category: string
  unit: string
  is_off: boolean
  start_count: number | null
  end_count: number | null
  consumed: number
  flagged: boolean
  weekly_rate: number | null
}

type RangePreset = 30 | 60 | 90 | 'custom'
type HistoryTab = 'recent' | 'byCategory' | 'invoices'

export default function HistoryPage() {
  const router = useRouter()
  const [history, setHistory] = useState<InventoryCount[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<HistoryTab>('recent')
  // Patch 70: shift leads may open History, but only see the Invoices tab
  // (counts and velocity stay owner-only, server-enforced on those routes).
  const [isOwner, setIsOwner] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  const [velocityRows, setVelocityRows] = useState<VelocityRow[]>([])
  const [velocityLoading, setVelocityLoading] = useState(false)
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')

  const [rangePreset, setRangePreset] = useState<RangePreset>(90)
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [appliedCustomStart, setAppliedCustomStart] = useState('')
  const [appliedCustomEnd, setAppliedCustomEnd] = useState('')

  const fetchHistory = async () => {
    try {
      const res = await fetch('/api/counts?limit=500')
      const data = await res.json()
      setHistory(data)
    } finally {
      setLoading(false)
    }
  }

  // Patch 42: same store-local (Pacific) "today" the server's day-boundary
  // math (pacificDayBoundsMs, patch 39) expects -- addDays is pure
  // calendar-date arithmetic on that string, so a 30/60/90-day preset lines
  // up with the server's own Pacific-time boundaries regardless of what
  // timezone this device is actually in.
  const fetchVelocity = async (preset: RangePreset, start?: string, end?: string) => {
    setVelocityLoading(true)
    try {
      const today = todayInTZ()
      const rangeStart = preset === 'custom' ? (start as string) : addDays(today, -preset)
      const rangeEnd = preset === 'custom' ? (end as string) : today
      const res = await fetch(`/api/reports/velocity?start=${rangeStart}&end=${rangeEnd}`)
      const data: VelocityRow[] = await res.json()
      setVelocityRows(data)
    } finally {
      setVelocityLoading(false)
    }
  }

  useEffect(() => {
    const role = getRole()
    if (!role) { router.replace('/login'); return }
    const wantsInvoices = new URLSearchParams(window.location.search).get('tab') === 'invoices'
    if (role === 'shift_lead') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: resolve role once on mount, this app's standard page-load pattern
      setView('invoices')
      setLoading(false)
      return
    }
    if (role !== 'owner') { router.replace('/count'); return }
    setIsOwner(true)
    if (wantsInvoices) setView('invoices')
    fetchHistory()
    fetchVelocity(90)
  }, [router])

  const handleViewChange = (v: HistoryTab) => {
    setView(v)
  }

  const handlePresetChange = (preset: 30 | 60 | 90) => {
    setRangePreset(preset)
    fetchVelocity(preset)
  }

  const handleApplyCustomRange = () => {
    if (!customStart || !customEnd) return
    setRangePreset('custom')
    setAppliedCustomStart(customStart)
    setAppliedCustomEnd(customEnd)
    fetchVelocity('custom', customStart, customEnd)
  }

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(category)) next.delete(category)
      else next.add(category)
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

  const formatDateTime = (dateStr: string) => {
    const d = new Date(dateStr)
    const dateStr2 = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
    const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    return `${dateStr2} at ${timeStr}`
  }

  const searchTerm = search.trim().toLowerCase()
  const filteredHistory = searchTerm
    ? history.filter((h) => h.items?.name?.toLowerCase().includes(searchTerm))
    : history

  // Group by submission: every row from one Save press shares the exact same
  // entered_by + created_at (Postgres NOW() is stable within the insert's transaction)
  const grouped: Record<string, InventoryCount[]> = {}
  filteredHistory.forEach((h) => {
    const key = `${h.entered_by}|${h.created_at}`
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(h)
  })

  const groupEntries = Object.entries(grouped).sort(
    (a, b) => new Date(b[1][0].created_at).getTime() - new Date(a[1][0].created_at).getTime()
  )

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

  // Patch 42: group the already-ranked velocity response by each item's
  // existing category (src/lib/types.ts's CATEGORIES -- the same fixed
  // order current-stock/manage-items/par-settings already use) instead of
  // ranking raw units against each other across unrelated categories.
  // velocityRows arrives pre-sorted by the API (clamped-to-0 consumed,
  // descending), so filtering into per-category buckets preserves that
  // order with no re-sort needed. A row with consumed === 0 and no
  // miscount flag has no activity to show -- left out entirely, same as
  // the old tab's `consumed > 0` filter, except a flagged (negative)
  // result is kept so the "Check count" badge still surfaces it.
  const byCategory: Record<string, VelocityRow[]> = {}
  for (const row of velocityRows) {
    if (row.consumed === 0 && !row.flagged) continue
    if (!byCategory[row.category]) byCategory[row.category] = []
    byCategory[row.category].push(row)
  }
  const categoriesWithData = CATEGORIES.filter((c) => byCategory[c]?.length > 0)

  const formatDisplayDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  return (
    <div className="min-h-screen flex flex-col bg-[#d4edda]">
      <Navigation />

      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">{view === 'invoices' ? 'Invoice History' : 'Usage History'}</h1>
          <p className="text-gray-500 mt-1">
            {view === 'invoices' ? 'Received invoices, newest first' : `Showing latest ${history.length} count entries`}
          </p>
        </div>

        {/* View toggle */}
        <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-xl w-fit max-w-full overflow-x-auto">
          {isOwner && (
          <>
          <button
            onClick={() => handleViewChange('recent')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              view === 'recent' ? 'bg-white shadow text-gray-900' : 'text-gray-500'
            }`}
          >
            Recent Counts
          </button>
          <button
            onClick={() => handleViewChange('byCategory')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              view === 'byCategory' ? 'bg-white shadow text-gray-900' : 'text-gray-500'
            }`}
          >
            Fastest by Category
          </button>
          </>
          )}
          <button
            onClick={() => handleViewChange('invoices')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              view === 'invoices' ? 'bg-white shadow text-gray-900' : 'text-gray-500'
            }`}
            data-testid="tab-invoices"
          >
            Invoices
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

        {view === 'invoices' ? (
          <InvoiceHistoryList />
        ) : view === 'recent' ? (
          history.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-12 text-center">
              <p className="text-gray-400 text-lg">No history yet.</p>
              <p className="text-gray-400 text-sm mt-1">
                Counts will appear here after the first entry.
              </p>
            </div>
          ) : groupEntries.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-12 text-center">
              <p className="text-gray-400">No results for &ldquo;{search}&rdquo;</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              {groupEntries.map(([key, entries], groupIdx, arr) => {
                const isExpanded = expandedGroups.has(key)
                const submitter = entries[0].entered_by && entries[0].entered_by !== 'shift_lead' ? entries[0].entered_by : 'Shift Lead'
                return (
                  <div key={key} className={groupIdx < arr.length - 1 ? 'border-b border-gray-100' : ''}>
                    <button
                      onClick={() => toggleGroup(key)}
                      className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors text-left"
                    >
                      <div>
                        <p className="font-semibold text-gray-900">{submitter}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {entries.length} item{entries.length !== 1 ? 's' : ''} · {formatDateTime(entries[0].created_at)}
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
                              <span className="text-xs font-normal text-gray-400 ml-1">{unitLabel(entry.items?.unit, entry.count)}</span>
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
            {/* Date range control: three big preset buttons plus a custom
                start/end range. No non-native custom date-range picker
                exists anywhere else in this app (Reports/HistoryView both
                use a plain native date input) -- custom range reuses that
                same pattern rather than inventing a new one. */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
              <div className="flex gap-2 flex-wrap">
                {([30, 60, 90] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => handlePresetChange(p)}
                    className={`min-h-[48px] px-5 rounded-xl font-semibold text-sm transition-colors ${
                      rangePreset === p ? 'bg-[#1a7a3c] text-white' : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {p} days
                  </button>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-500 font-medium">Custom start</label>
                  <input
                    type="date"
                    className="min-h-[48px] border border-gray-200 rounded-xl px-3 text-gray-900 focus:outline-none focus:border-blue-400"
                    value={customStart}
                    onChange={(e) => setCustomStart(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-500 font-medium">Custom end</label>
                  <input
                    type="date"
                    className="min-h-[48px] border border-gray-200 rounded-xl px-3 text-gray-900 focus:outline-none focus:border-blue-400"
                    value={customEnd}
                    onChange={(e) => setCustomEnd(e.target.value)}
                  />
                </div>
                <button
                  onClick={handleApplyCustomRange}
                  disabled={!customStart || !customEnd}
                  className="min-h-[48px] px-5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold rounded-xl transition-colors"
                >
                  Apply
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-3">
                {rangePreset === 'custom'
                  ? `${formatDisplayDate(appliedCustomStart)} – ${formatDisplayDate(appliedCustomEnd)}`
                  : `Last ${rangePreset} days`}
                {' '}· top 3 fastest per category. Updates when you change the range.
              </p>
            </div>

            {velocityLoading ? (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-12 text-center">
                <p className="text-gray-400">Calculating…</p>
              </div>
            ) : categoriesWithData.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-12 text-center">
                <p className="text-gray-400">Not enough count history yet to calculate velocity.</p>
                <p className="text-gray-400 text-sm mt-1">Enter counts on at least two different days.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {categoriesWithData.map((category) => {
                  const rows = byCategory[category]
                  const expanded = expandedCategories.has(category)
                  const shown = expanded ? rows : rows.slice(0, 3)
                  const maxInCategory = Math.max(...rows.map((r) => Math.max(0, r.consumed)), 1)
                  return (
                    <div key={category} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                      <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
                        <span className="text-xs font-bold uppercase tracking-widest text-blue-500">{category}</span>
                      </div>
                      {shown.map((row, idx, arr) => (
                        <div
                          key={row.item_id}
                          className={`px-5 py-4 ${row.is_off ? 'opacity-50 bg-gray-50' : ''} ${idx < arr.length - 1 ? 'border-b border-gray-100' : ''}`}
                        >
                          <div className="flex items-center gap-4">
                            <span className={`text-2xl font-black w-8 text-center flex-shrink-0 ${medalColor(idx)}`}>
                              {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="font-bold text-gray-900 flex items-center gap-1.5">
                                {row.name}
                                {row.is_off && (
                                  <span className="flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 border border-indigo-200">❄️ OFF</span>
                                )}
                              </p>
                              <p className="text-xs text-gray-400">{row.unit}</p>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <p className="font-bold text-gray-900 text-lg">
                                {row.consumed > 0 ? row.consumed : row.consumed < 0 ? `+${Math.abs(row.consumed)}` : '—'}
                              </p>
                              {row.weekly_rate !== null && (
                                <p className="text-xs text-gray-400">about {row.weekly_rate} per week</p>
                              )}
                            </div>
                          </div>
                          {row.flagged && (
                            <div className="mt-2 flex justify-end">
                              <span
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-600 border border-gray-300 rounded-full px-2 py-0.5"
                                title="Still negative after accounting for deliveries and storage moves -- check for a miscount."
                              >
                                Check count
                              </span>
                            </div>
                          )}
                          <div className="mt-2.5 h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${barColor(idx)}`}
                              style={{ width: `${(Math.max(0, row.consumed) / maxInCategory) * 100}%` }}
                            />
                          </div>
                        </div>
                      ))}
                      {rows.length > 3 && (
                        <button
                          onClick={() => toggleCategory(category)}
                          className="w-full min-h-[48px] px-5 py-3 text-sm font-semibold text-blue-600 hover:bg-blue-50 transition-colors text-center border-t border-gray-100"
                        >
                          {expanded ? 'Show top 3 only' : `Show all ${rows.length}`}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </main>
      <BackToTop />
    </div>
  )
}
