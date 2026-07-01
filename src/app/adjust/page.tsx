'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Navigation from '@/components/Navigation'
import { getRole } from '@/lib/auth'
import { Item, CATEGORIES } from '@/lib/types'

const QUICK_REASONS = ['Found extra stock', 'Count error', 'Vendor drop-off', 'Used for event', 'Waste / spoilage']

export default function AdjustPage() {
  const router = useRouter()
  const [role, setRole] = useState<string | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [enteredBy, setEnteredBy] = useState('')
  const [search, setSearch] = useState('')
  const [openItemId, setOpenItemId] = useState<string | null>(null)
  const [newCount, setNewCount] = useState('')
  const [newSecondaryCount, setNewSecondaryCount] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set())
  const [localCounts, setLocalCounts] = useState<Record<string, number>>({})
  const [localSecondaryCounts, setLocalSecondaryCounts] = useState<Record<string, number>>({})

  useEffect(() => {
    const r = getRole()
    if (!r) { router.replace('/login'); return }
    setRole(r)
    fetch('/api/items').then((res) => res.json()).then((data) => {
      setItems(data)
      setLoading(false)
    })
  }, [router])

  const openItem = (id: string) => {
    if (openItemId === id) { setOpenItemId(null); return }
    setOpenItemId(id)
    setNewCount('')
    setNewSecondaryCount('')
    setReason('')
  }

  const handleSave = async (item: Item) => {
    const hasSecondary = !!item.secondary_unit && newSecondaryCount !== ''
    if (!reason.trim() || (newCount === '' && !hasSecondary)) return
    if (role === 'shift_lead' && !enteredBy.trim()) return
    setSaving(true)
    const saves: Promise<unknown>[] = []

    if (newCount !== '') {
      const count = parseFloat(newCount)
      saves.push(
        fetch('/api/counts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entered_by: enteredBy.trim() || 'owner',
            counts: [{ item_id: item.id, count, notes: reason.trim(), type: 'adjustment' }],
          }),
        })
      )
    }

    const secondaryVal = hasSecondary ? parseFloat(newSecondaryCount) || 0 : null
    if (secondaryVal !== null) {
      saves.push(
        fetch('/api/items', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: item.id, secondary_count: secondaryVal }),
        })
      )
    }
    await Promise.all(saves)
    if (newCount !== '') setLocalCounts((prev) => ({ ...prev, [item.id]: parseFloat(newCount) }))
    if (secondaryVal !== null) setLocalSecondaryCounts((prev) => ({ ...prev, [item.id]: secondaryVal }))
    setSavedIds((prev) => new Set(prev).add(item.id))
    setOpenItemId(null)
    setNewCount('')
    setNewSecondaryCount('')
    setReason('')
    setSaving(false)
    setTimeout(() => setSavedIds((prev) => { const s = new Set(prev); s.delete(item.id); return s }), 4000)
  }

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen"><p className="text-gray-400 text-lg">Loading…</p></div>
  }

  const searchTerm = search.trim().toLowerCase()
  const filteredItems = searchTerm ? items.filter((i) => i.name.toLowerCase().includes(searchTerm)) : items

  const byCategory = CATEGORIES.reduce<Record<string, Item[]>>((acc, cat) => {
    const catItems = filteredItems.filter((i) => i.category === cat)
    if (catItems.length) acc[cat] = catItems
    return acc
  }, {})

  const nameRequired = role === 'shift_lead' && !enteredBy.trim()

  return (
    <div className="min-h-screen flex flex-col bg-[#d4edda]">
      <Navigation />

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6">
        <div className="mb-5">
          <h1 className="text-2xl font-bold text-gray-900">Adjustment</h1>
          <p className="text-gray-500 text-sm mt-1">Correct a count, log found stock, or record a vendor drop-off. Adjustments are excluded from velocity and par reports.</p>
        </div>

        {/* Who's adjusting */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4 mb-5">
          <label className="block text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">
            {role === 'shift_lead' ? 'Your name (required)' : 'Your name'}
          </label>
          <input
            type="text"
            value={enteredBy}
            onChange={(e) => setEnteredBy(e.target.value)}
            placeholder="Enter your name"
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 focus:outline-none focus:border-blue-400 text-sm bg-slate-50"
          />
        </div>

        {/* Search */}
        <div className="mb-4">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search items…"
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 focus:outline-none focus:border-blue-400 bg-white text-sm"
          />
        </div>

        {Object.keys(byCategory).length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-10 text-center">
            <p className="text-gray-400">No items match &ldquo;{search}&rdquo;</p>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {CATEGORIES.filter((c) => byCategory[c]).map((category) => (
              <section key={category}>
                <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">{category}</h2>
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                  {byCategory[category].map((item, idx, arr) => {
                    const displayCount = localCounts[item.id] ?? item.current_count
                    const displaySecondary = localSecondaryCounts[item.id] ?? item.secondary_count
                    const isOpen = openItemId === item.id
                    const wasSaved = savedIds.has(item.id)
                    return (
                      <div key={item.id} className={idx < arr.length - 1 ? 'border-b border-gray-100' : ''}>
                        <button
                          onClick={() => openItem(item.id)}
                          className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-gray-50 transition-colors"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-gray-900">{item.name}</p>
                            <p className="text-sm text-gray-400">
                              {displayCount} {item.unit}
                              {item.secondary_unit ? ` + ${displaySecondary} ${item.secondary_unit}` : ''} on hand
                            </p>
                          </div>
                          {wasSaved && !isOpen && (
                            <span className="text-xs font-bold text-green-600 bg-green-50 px-2.5 py-1 rounded-lg">Adjusted ✓</span>
                          )}
                          <svg className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>

                        {isOpen && (
                          <div className="border-t border-gray-100 bg-blue-50 px-5 py-4">
                            <div className="mb-3">
                              <label className="block text-xs font-bold uppercase tracking-widest text-gray-500 mb-1.5">New count</label>
                              <div className="flex items-center gap-3 flex-wrap">
                                <div className="flex items-center gap-2">
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={newCount}
                                    onChange={(e) => { if (e.target.value === '' || /^\d*\.?\d*$/.test(e.target.value)) setNewCount(e.target.value) }}
                                    onFocus={(e) => e.target.select()}
                                    placeholder={String(displayCount)}
                                    className="w-24 text-center text-xl font-bold border-2 border-gray-200 rounded-xl py-2 px-1 focus:outline-none focus:border-blue-400 bg-white"
                                    autoFocus
                                  />
                                  <span className="text-gray-500 text-sm">{item.unit}</span>
                                </div>
                                {item.secondary_unit && (
                                  <>
                                    <span className="text-gray-300 text-lg font-light">+</span>
                                    <div className="flex items-center gap-2">
                                      <input
                                        type="text"
                                        inputMode="decimal"
                                        value={newSecondaryCount}
                                        onChange={(e) => { if (e.target.value === '' || /^\d*\.?\d*$/.test(e.target.value)) setNewSecondaryCount(e.target.value) }}
                                        onFocus={(e) => e.target.select()}
                                        placeholder={String(displaySecondary)}
                                        className="w-20 text-center text-xl font-bold border-2 border-gray-200 rounded-xl py-2 px-1 focus:outline-none focus:border-purple-400 bg-purple-50"
                                      />
                                      <span className="text-purple-500 text-sm font-medium">{item.secondary_unit}</span>
                                    </div>
                                  </>
                                )}
                              </div>
                            </div>

                            <div className="mb-4">
                              <label className="block text-xs font-bold uppercase tracking-widest text-gray-500 mb-1.5">Reason <span className="text-red-400 normal-case font-normal">(required)</span></label>
                              <div className="flex flex-wrap gap-2 mb-2">
                                {QUICK_REASONS.map((r) => (
                                  <button
                                    key={r}
                                    onClick={() => setReason(r)}
                                    className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${reason === r ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'}`}
                                  >
                                    {r}
                                  </button>
                                ))}
                              </div>
                              <input
                                type="text"
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                placeholder="Or type a reason…"
                                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-blue-400 bg-white"
                              />
                            </div>

                            <div className="flex gap-2">
                              <button
                                onClick={() => handleSave(item)}
                                disabled={saving || !reason.trim() || (newCount === '' && !(item.secondary_unit && newSecondaryCount !== '')) || nameRequired}
                                className="flex-1 bg-[#1a7a3c] hover:bg-[#155f2f] disabled:bg-gray-200 disabled:text-gray-400 text-white font-bold py-3 rounded-xl transition-colors"
                              >
                                {saving ? 'Saving…' : nameRequired ? 'Enter your name above first' : 'Save Adjustment'}
                              </button>
                              <button
                                onClick={() => setOpenItemId(null)}
                                className="px-4 py-3 text-gray-500 hover:text-gray-700 border border-gray-200 rounded-xl bg-white"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
