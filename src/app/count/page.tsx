'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Navigation from '@/components/Navigation'
import { getRole } from '@/lib/auth'
import { Item, CATEGORIES, Category } from '@/lib/types'

interface CountDraft {
  [itemId: string]: string
}

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
  const firstInputRef = useRef<HTMLInputElement>(null)

  // Add item modal state
  const [showAddModal, setShowAddModal] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCategory, setNewCategory] = useState<Category>(CATEGORIES[0])
  const [newUnit, setNewUnit] = useState('boxes')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')

  useEffect(() => {
    const role = getRole()
    if (!role) { router.replace('/login'); return }
    const saved = localStorage.getItem('countedBy')
    if (saved) setCountedBy(saved)
    fetchItems()
  }, [router])

  const handleCountedByChange = (val: string) => {
    setCountedBy(val)
    localStorage.setItem('countedBy', val)
  }

  const fetchItems = async () => {
    try {
      const res = await fetch('/api/items')
      const data = await res.json()
      setItems(data)
      const initial: CountDraft = {}
      const initialSecondary: CountDraft = {}
      data.forEach((item: Item) => {
        initial[item.id] = String(item.current_count)
        initialSecondary[item.id] = item.secondary_count > 0 ? String(item.secondary_count) : ''
      })
      setCounts(initial)
      setSecondaryCounts(initialSecondary)
    } catch {
      setError('Failed to load items. Check your connection.')
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (itemId: string, value: string) => {
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      setCounts((prev) => ({ ...prev, [itemId]: value }))
    }
  }

  const handleSecondaryChange = (itemId: string, value: string) => {
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      setSecondaryCounts((prev) => ({ ...prev, [itemId]: value }))
    }
  }

  const handleSubmit = async () => {
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

      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
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
        body: JSON.stringify({ name: newName.trim(), category: newCategory, unit: newUnit.trim() || 'boxes' }),
      })
      if (!res.ok) throw new Error()
      const created: Item = await res.json()
      setItems((prev) => [...prev, created])
      setCounts((prev) => ({ ...prev, [created.id]: '0' }))
      setSecondaryCounts((prev) => ({ ...prev, [created.id]: '' }))
      setNewName('')
      setNewUnit('boxes')
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

  const itemsByCategory = CATEGORIES.reduce<Record<string, Item[]>>((acc, cat) => {
    acc[cat] = items.filter((i) => i.category === cat)
    return acc
  }, {})

  return (
    <div className="min-h-screen flex flex-col">
      <Navigation />

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Count Entry</h1>
            <p className="text-gray-500 mt-1">Enter today&apos;s counts for each item.</p>
          </div>
          <button
            onClick={() => { setShowAddModal(true); setAddError('') }}
            className="flex-shrink-0 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2 rounded-xl text-sm transition-colors"
          >
            + Add Item
          </button>
        </div>

        {/* Who's counting */}
        <div className="mb-5 bg-white rounded-2xl shadow-sm border border-gray-100 px-5 py-4 flex items-center gap-3">
          <label className="text-sm font-semibold text-gray-600 flex-shrink-0">Who&apos;s counting?</label>
          <input
            type="text"
            className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:border-blue-400 text-sm"
            placeholder="Enter your name"
            value={countedBy}
            onChange={(e) => handleCountedByChange(e.target.value)}
          />
        </div>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3">
            {error}
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
                        <input
                          ref={idx === 0 && category === CATEGORIES[0] ? firstInputRef : undefined}
                          type="text"
                          inputMode="decimal"
                          className="count-input w-20 text-center text-2xl font-bold border-2 border-gray-200 rounded-xl py-2 px-1 focus:outline-none focus:border-blue-400 bg-slate-50"
                          value={counts[item.id] ?? ''}
                          onChange={(e) => handleChange(item.id, e.target.value)}
                          placeholder="0"
                        />
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
        <div className="mt-8 pb-8">
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
