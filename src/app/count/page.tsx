'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Navigation from '@/components/Navigation'
import { getRole } from '@/lib/auth'
import { Item, CATEGORIES, Category } from '@/lib/types'

interface CountDraft {
  [itemId: string]: string
}

type CountDraftData = {
  counts: CountDraft
  secondaryCounts: CountDraft
  countedBy: string
  savedAt: number
}

const DRAFT_KEY = 'count_draft'
const DRAFT_EXPIRY_MS = 4 * 60 * 60 * 1000

export default function CountPage() {
  const router = useRouter()
  const [items, setItems] = useState<Item[]>([])
  const [counts, setCounts] = useState<CountDraft>({})
  const [secondaryCounts, setSecondaryCounts] = useState<CountDraft>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [countedBy, setCountedBy] = useState('')
  const [nameError, setNameError] = useState('')
  const [role, setRole] = useState<string | null>(null)
  const [lastCount, setLastCount] = useState<{ created_at: string; entered_by: string } | null>(null)
  const [search, setSearch] = useState('')
  const firstInputRef = useRef<HTMLInputElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const submitRef = useRef<HTMLDivElement>(null)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [draftToRestore, setDraftToRestore] = useState<CountDraftData | null>(null)

  useEffect(() => {
    const el = submitRef.current
    if (!el) return
    const obs = new IntersectionObserver(([e]) => setShowScrollBtn(!e.isIntersecting), { threshold: 0.1 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [loading])

  const scrollToSave = useCallback(() => {
    submitRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [])

  // Add item modal state
  const [showAddModal, setShowAddModal] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCategory, setNewCategory] = useState<Category>(CATEGORIES[0])
  const [newUnit, setNewUnit] = useState('boxes')
  const [newSecondaryUnit, setNewSecondaryUnit] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')

  useEffect(() => {
    const r = getRole()
    if (!r) { router.replace('/login'); return }
    setRole(r)
    const saved = localStorage.getItem('countedBy')
    if (saved) setCountedBy(saved)
    fetchItems()
    fetch('/api/dashboard-summary').then((res) => res.json()).then((d) => setLastCount(d.lastCount)).catch(() => {})
  }, [router])

  const handleCountedByChange = (val: string) => {
    setCountedBy(val)
    if (val.trim()) setNameError('')
    localStorage.setItem('countedBy', val)
  }

  const saveDraft = (c: CountDraft, sc: CountDraft) => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ counts: c, secondaryCounts: sc, countedBy, savedAt: Date.now() }))
  }

  const handleRestore = () => {
    if (!draftToRestore) return
    setCounts(draftToRestore.counts)
    setSecondaryCounts(draftToRestore.secondaryCounts)
    setCountedBy('')
    localStorage.removeItem('countedBy')
    setDraftToRestore(null)
  }

  const handleDiscardDraft = () => {
    localStorage.removeItem(DRAFT_KEY)
    setDraftToRestore(null)
  }

  const fetchItems = async () => {
    try {
      const res = await fetch('/api/items')
      const data = await res.json()
      setItems(data)
      setCounts({})
      setSecondaryCounts({})
      try {
        const raw = localStorage.getItem(DRAFT_KEY)
        if (raw) {
          const draft = JSON.parse(raw) as CountDraftData
          if (Date.now() - draft.savedAt > DRAFT_EXPIRY_MS) {
            localStorage.removeItem(DRAFT_KEY)
          } else {
            setDraftToRestore(draft)
          }
        }
      } catch {
        localStorage.removeItem(DRAFT_KEY)
      }
    } catch {
      setError('Failed to load items. Check your connection.')
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (itemId: string, value: string) => {
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      const next = { ...counts, [itemId]: value }
      setCounts(next)
      saveDraft(next, secondaryCounts)
    }
  }

  const handleSecondaryChange = (itemId: string, value: string) => {
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      const next = { ...secondaryCounts, [itemId]: value }
      setSecondaryCounts(next)
      saveDraft(counts, next)
    }
  }

  const handleSubmit = async () => {
    if (role !== 'owner' && !countedBy.trim()) {
      setNameError('Please enter your name before saving.')
      nameInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      nameInputRef.current?.focus()
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload = Object.entries(counts)
        .filter(([, v]) => v !== '')
        .map(([item_id, count]) => ({ item_id, count: parseFloat(count) }))

      const res = await fetch('/api/counts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ counts: payload, entered_by: countedBy.trim() || 'shift_lead' }),
      })
      if (!res.ok) throw new Error('Save failed')

      // Save secondary counts for items that have a secondary_unit
      const itemsWithSecondary = items.filter((i) => i.secondary_unit)
      await Promise.all(
        itemsWithSecondary.map((item) =>
          fetch('/api/items', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: item.id,
              secondary_count: parseFloat(secondaryCounts[item.id] || '0') || 0,
            }),
          })
        )
      )

      setCounts({})
      setSecondaryCounts({})
      localStorage.removeItem(DRAFT_KEY)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
      const name = countedBy.trim() || 'Someone'
      const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      fetch('/api/send-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Count Submitted', body: `${name} submitted a count at ${time}` }),
      }).then((r) => r.json()).then((d) => console.log('push result:', d)).catch((e) => console.error('push error:', e))
    } catch {
      setError('Could not save. Try again.')
    } finally {
      setSaving(false)
    }
  }

  const handleAddItem = async () => {
    if (!newName.trim()) return
    setAdding(true)
    setAddError('')
    try {
      const res = await fetch('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), category: newCategory, unit: newUnit.trim() || 'boxes', secondary_unit: newSecondaryUnit.trim() }),
      })
      if (!res.ok) throw new Error()
      const created: Item = await res.json()
      setItems((prev) => [...prev, created])
      setCounts((prev) => ({ ...prev, [created.id]: '0' }))
      setSecondaryCounts((prev) => ({ ...prev, [created.id]: '' }))
      setNewName('')
      setNewUnit('boxes')
      setNewSecondaryUnit('')
      setShowAddModal(false)
    } catch {
      setAddError('Could not add item. Try again.')
    } finally {
      setAdding(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-400 text-lg">Loading items…</p>
      </div>
    )
  }

  const searchTerm = search.trim().toLowerCase()
  const visibleItems = searchTerm ? items.filter((i) => i.name.toLowerCase().includes(searchTerm)) : items
  const itemsByCategory = CATEGORIES.reduce<Record<string, Item[]>>((acc, cat) => {
    acc[cat] = visibleItems.filter((i) => i.category === cat)
    return acc
  }, {})

  return (
    <div className="min-h-screen flex flex-col bg-[#d4edda]">
      <Navigation />

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Count Entry</h1>
            {lastCount ? (() => {
              const d = new Date(lastCount.created_at)
              const isToday = d.toDateString() === new Date().toDateString()
              const dateStr = isToday
                ? `Today at ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
              const by = lastCount.entered_by && lastCount.entered_by !== 'shift_lead' ? ` by ${lastCount.entered_by}` : ''
              return <p className="text-sm mt-1 text-gray-400">Last count: {dateStr}{by}</p>
            })() : <p className="text-gray-500 mt-1">Enter today&apos;s counts for each item.</p>}
          </div>
          <button
            onClick={() => { setShowAddModal(true); setAddError('') }}
            className="flex-shrink-0 bg-[#c8102e] hover:bg-[#a50d26] text-white font-semibold px-4 py-2 rounded-xl text-sm transition-colors"
          >
            + Add Item
          </button>
        </div>

        {/* Draft restore prompt */}
        {draftToRestore && (
          <div className="mb-5 bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4">
            <p className="text-sm font-semibold text-amber-800">
              {draftToRestore.countedBy?.trim()
                ? `Restore ${draftToRestore.countedBy.trim()}'s count from ${new Date(draftToRestore.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}?`
                : `Restore in-progress count from ${new Date(draftToRestore.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}?`}
            </p>
            <div className="flex gap-2 mt-3">
              <button
                onClick={handleRestore}
                className="flex-1 bg-amber-500 hover:bg-amber-600 text-white font-semibold py-2 rounded-xl text-sm transition-colors"
              >
                Restore
              </button>
              <button
                onClick={handleDiscardDraft}
                className="flex-1 bg-white hover:bg-gray-50 text-amber-700 font-semibold py-2 rounded-xl text-sm border border-amber-200 transition-colors"
              >
                Start Fresh
              </button>
            </div>
          </div>
        )}

        {/* Who's counting — shift lead only */}
        {role !== 'owner' && (
          <div className="mb-5 bg-white rounded-2xl shadow-sm border border-gray-100 px-5 py-4">
            <div className="flex items-center gap-3">
              <label className="text-sm font-semibold text-gray-600 flex-shrink-0">Who&apos;s counting?</label>
              <input
                ref={nameInputRef}
                type="text"
                className={`flex-1 border rounded-xl px-3 py-2 text-gray-900 focus:outline-none text-sm ${nameError ? 'border-red-400 focus:border-red-500' : 'border-gray-200 focus:border-blue-400'}`}
                placeholder="Enter your name"
                value={countedBy}
                onChange={(e) => handleCountedByChange(e.target.value)}
              />
            </div>
            {nameError && (
              <p className="text-red-500 text-xs mt-2 ml-0">{nameError}</p>
            )}
          </div>
        )}

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3">
            {error}
          </div>
        )}

        {/* Count progress */}
        {items.length > 0 && (() => {
          const entered = items.filter((i) => counts[i.id] !== undefined && counts[i.id] !== '').length
          const pct = entered / items.length
          const barColor = entered === items.length ? 'bg-green-500' : pct >= 0.5 ? 'bg-amber-400' : 'bg-blue-400'
          return (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-4 py-3 mb-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Items Entered</p>
                <p className="text-sm font-bold text-gray-900">
                  {entered} / {items.length}
                  {entered === items.length && <span className="text-green-500 ml-1.5">✓ All done</span>}
                </p>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div className={`h-2 rounded-full transition-all ${barColor}`} style={{ width: `${Math.round(pct * 100)}%` }} />
              </div>
            </div>
          )
        })()}

        <div className="mb-4">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search items…"
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 focus:outline-none focus:border-blue-400 bg-white text-sm"
          />
        </div>

        {searchTerm && visibleItems.length === 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-10 text-center mb-4">
            <p className="text-gray-400">No items match &ldquo;{search}&rdquo;</p>
          </div>
        )}

        <div className="flex flex-col gap-6">
          {CATEGORIES.map((category) => {
            const catItems = itemsByCategory[category] || []
            if (catItems.length === 0) return null
            return (
              <section key={category}>
                <h2 className="text-xs font-bold uppercase tracking-widest text-blue-500 mb-3">
                  {category}
                </h2>
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                  {catItems.map((item, idx) => (
                    <div
                      key={item.id}
                      className={`flex items-center gap-3 px-5 py-4 ${
                        idx < catItems.length - 1 ? 'border-b border-gray-100' : ''
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-900 text-base leading-tight">
                          {item.name}
                        </p>
                        <p className="text-sm text-gray-400">{item.unit}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <div className="flex flex-col items-center gap-0.5">
                          <input
                            ref={idx === 0 && category === CATEGORIES[0] ? firstInputRef : undefined}
                            type="text"
                            inputMode="decimal"
                            className="count-input w-20 text-center text-2xl font-bold border-2 border-gray-200 rounded-xl py-2 px-1 focus:outline-none focus:border-blue-400 bg-slate-50"
                            value={counts[item.id] ?? ''}
                            onChange={(e) => handleChange(item.id, e.target.value)}
                            onFocus={(e) => e.target.select()}
                            placeholder="0"
                          />
                          {counts[item.id] === undefined && item.current_count > 0 && (
                            <span className="text-xs text-gray-300">was {item.current_count}</span>
                          )}
                        </div>
                        {item.secondary_unit && (
                          <>
                            <span className="text-gray-300 text-lg font-light">+</span>
                            <div className="flex flex-col items-center gap-0.5">
                              <input
                                type="text"
                                inputMode="decimal"
                                className="w-16 text-center text-lg font-bold border-2 border-gray-200 rounded-xl py-2 px-1 focus:outline-none focus:border-purple-400 bg-purple-50"
                                value={secondaryCounts[item.id] ?? ''}
                                onChange={(e) => handleSecondaryChange(item.id, e.target.value)}
                                onFocus={(e) => e.target.select()}
                                placeholder="0"
                              />
                              <span className="text-xs text-purple-400 font-medium">{item.secondary_unit}</span>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )
          })}
        </div>

        {/* Submit button */}
        <div ref={submitRef} className="mt-8 pb-8">
          <button
            onClick={handleSubmit}
            disabled={saving}
            className={`w-full py-5 rounded-2xl text-xl font-bold transition-colors shadow-md ${
              saved
                ? 'bg-green-500 text-white'
                : saving
                ? 'bg-blue-300 text-white cursor-wait'
                : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white'
            }`}
          >
            {saved ? '✓ Saved!' : saving ? 'Saving…' : 'Save Counts'}
          </button>
        </div>
      </main>

      {/* Scroll to save button */}
      {showScrollBtn && (
        <button
          onClick={scrollToSave}
          className="fixed bottom-6 right-5 z-40 bg-[#c8102e] hover:bg-[#a00d24] active:bg-[#7a0a1b] text-white w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-colors"
          aria-label="Scroll to save"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      )}

      {/* Add Item Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-900">Add New Item</h2>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
              >
                ×
              </button>
            </div>

            {addError && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
                {addError}
              </div>
            )}

            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">Item Name</label>
              <input
                type="text"
                autoFocus
                className="border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 focus:outline-none focus:border-blue-400"
                placeholder="e.g. Mango Chili Powder"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddItem()}
              />
            </div>

            <div className="flex gap-3">
              <div className="flex flex-col gap-1 flex-1">
                <label className="text-xs text-gray-500 font-medium">Category</label>
                <select
                  className="border border-gray-200 rounded-xl px-3 py-2.5 text-gray-900 focus:outline-none focus:border-blue-400 bg-white"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value as Category)}
                >
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1 w-28">
                <label className="text-xs text-gray-500 font-medium">Unit</label>
                <input
                  type="text"
                  className="border border-gray-200 rounded-xl px-3 py-2.5 text-gray-900 focus:outline-none focus:border-blue-400"
                  placeholder="boxes"
                  value={newUnit}
                  onChange={(e) => setNewUnit(e.target.value)}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">Sub-unit <span className="text-gray-400 font-normal">(optional — e.g. sleeves, container)</span></label>
              <input
                type="text"
                className="border border-purple-200 rounded-xl px-3 py-2.5 text-gray-900 focus:outline-none focus:border-purple-400"
                placeholder="e.g. sleeves"
                value={newSecondaryUnit}
                onChange={(e) => setNewSecondaryUnit(e.target.value)}
              />
            </div>

            <div className="flex gap-3 mt-2">
              <button
                onClick={() => setShowAddModal(false)}
                className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-600 font-semibold py-3 rounded-xl"
              >
                Cancel
              </button>
              <button
                onClick={handleAddItem}
                disabled={adding || !newName.trim()}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold py-3 rounded-xl transition-colors"
              >
                {adding ? 'Adding…' : '+ Add Item'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
