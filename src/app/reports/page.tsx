'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Navigation from '@/components/Navigation'
import { getRole } from '@/lib/auth'
import { CATEGORIES, Category } from '@/lib/types'

interface VelocityRow {
  item_id: string
  name: string
  category: string
  unit: string
  start_count: number | null
  end_count: number | null
  consumed: number
}

function today() {
  return new Date().toISOString().split('T')[0]
}

function sevenDaysAgo() {
  const d = new Date()
  d.setDate(d.getDate() - 7)
  return d.toISOString().split('T')[0]
}

export default function ReportsPage() {
  const router = useRouter()
  const [startDate, setStartDate] = useState(sevenDaysAgo())
  const [endDate, setEndDate] = useState(today())
  const [rows, setRows] = useState<VelocityRow[]>([])
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)
  const [error, setError] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<Category | 'All'>('All')
  const [hideZero, setHideZero] = useState(true)
  const [shareLabel, setShareLabel] = useState('Share')
  const [search, setSearch] = useState('')

  useEffect(() => {
    const role = getRole()
    if (!role) { router.replace('/login'); return }
    if (role !== 'owner') { router.replace('/count'); return }
  }, [router])

  const fetchVelocity = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/reports/velocity?start=${startDate}&end=${endDate}`)
      if (!res.ok) throw new Error()
      setRows(await res.json())
      setFetched(true)
    } catch {
      setError('Could not load report. Try again.')
    } finally {
      setLoading(false)
    }
  }

  const searchTerm = search.trim().toLowerCase()
  const filtered = rows.filter((r) => {
    if (hideZero && r.consumed <= 0) return false
    if (categoryFilter !== 'All' && r.category !== categoryFilter) return false
    if (searchTerm && !r.name.toLowerCase().includes(searchTerm)) return false
    return true
  })

  const maxConsumed = filtered.length > 0 ? Math.max(...filtered.map((r) => r.consumed)) : 1

  const handleShare = async () => {
    const fmt = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    const header = `Item Velocity — ${fmt(startDate)} to ${fmt(endDate)}`
    const lines = filtered.map((r) => `${r.name}: ${r.consumed > 0 ? `${r.consumed} used` : 'no change'} (${r.category})`)
    const text = [header, '', ...lines].join('\n')
    if (navigator.share) {
      await navigator.share({ title: header, text }).catch(() => {})
    } else {
      await navigator.clipboard.writeText(text)
      setShareLabel('Copied!')
      setTimeout(() => setShareLabel('Share'), 2000)
    }
  }

  const barColor = (consumed: number) => {
    const pct = consumed / maxConsumed
    if (pct >= 0.66) return 'bg-red-400'
    if (pct >= 0.33) return 'bg-orange-400'
    return 'bg-blue-400'
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#d4edda]">
      <Navigation />

      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Item Velocity</h1>
          <p className="text-gray-500 mt-1">See which items were used the most between two count dates.</p>
        </div>

        {/* Date picker */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-6">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">Start Date</label>
              <input
                type="date"
                className="border border-gray-200 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:border-blue-400"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">End Date</label>
              <input
                type="date"
                className="border border-gray-200 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:border-blue-400"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <button
              onClick={fetchVelocity}
              disabled={loading || !startDate || !endDate}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold px-6 py-2 rounded-xl transition-colors"
            >
              {loading ? 'Loading…' : 'Run Report'}
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3">
            {error}
          </div>
        )}

        {fetched && (
          <>
            {/* Filters */}
            <div className="flex flex-wrap gap-3 items-center mb-4">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search items…"
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-blue-400 bg-white"
              />
              <select
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-blue-400 bg-white"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value as Category | 'All')}
              >
                <option value="All">All Categories</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hideZero}
                  onChange={(e) => setHideZero(e.target.checked)}
                  className="rounded"
                />
                Hide items with no change
              </label>
              <div className="ml-auto flex items-center gap-3">
                <span className="text-sm text-gray-400">{filtered.length} items</span>
                {filtered.length > 0 && (
                  <button
                    onClick={handleShare}
                    className="text-sm text-blue-600 font-semibold border border-blue-200 px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors"
                  >
                    {shareLabel}
                  </button>
                )}
              </div>
            </div>

            {/* Results */}
            {filtered.length === 0 ? (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center text-gray-400">
                No data found for this date range. Make sure counts were entered on or around both dates.
              </div>
            ) : (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                {/* Header */}
                <div className="grid grid-cols-[1fr_80px_80px_80px] gap-2 px-5 py-3 bg-gray-50 border-b border-gray-100 text-xs font-bold uppercase tracking-widest text-gray-400">
                  <span>Item</span>
                  <span className="text-right">Start</span>
                  <span className="text-right">End</span>
                  <span className="text-right">Used</span>
                </div>
                {filtered.map((row, idx) => (
                  <div
                    key={row.item_id}
                    className={`px-5 py-3.5 ${idx < filtered.length - 1 ? 'border-b border-gray-100' : ''}`}
                  >
                    <div className="grid grid-cols-[1fr_80px_80px_80px] gap-2 items-center">
                      <div className="min-w-0">
                        <p className="font-semibold text-gray-900 text-sm truncate">{row.name}</p>
                        <p className="text-xs text-gray-400">{row.category} · {row.unit}</p>
                      </div>
                      <span className="text-right text-sm text-gray-500">
                        {row.start_count !== null ? row.start_count : '—'}
                      </span>
                      <span className="text-right text-sm text-gray-500">
                        {row.end_count !== null ? row.end_count : '—'}
                      </span>
                      <span className={`text-right text-sm font-bold ${row.consumed > 0 ? 'text-gray-900' : 'text-gray-300'}`}>
                        {row.consumed > 0 ? row.consumed : row.consumed < 0 ? `+${Math.abs(row.consumed)}` : '—'}
                      </span>
                    </div>
                    {row.consumed > 0 && (
                      <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${barColor(row.consumed)}`}
                          style={{ width: `${(row.consumed / maxConsumed) * 100}%` }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {!fetched && !loading && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-10 text-center text-gray-400">
            Select a date range and tap Run Report.
          </div>
        )}
      </main>
    </div>
  )
}
