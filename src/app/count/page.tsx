'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Navigation from '@/components/Navigation'
import { getRole } from '@/lib/auth'
import { Item, CATEGORIES } from '@/lib/types'

interface CountDraft {
  [itemId: string]: string
}

export default function CountPage() {
  const router = useRouter()
  const [items, setItems] = useState<Item[]>([])
  const [counts, setCounts] = useState<CountDraft>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const firstInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const role = getRole()
    if (!role) { router.replace('/login'); return }
    fetchItems()
  }, [router])

  const fetchItems = async () => {
    try {
      const res = await fetch('/api/items')
      const data = await res.json()
      setItems(data)
      // Initialize all counts from current values
      const initial: CountDraft = {}
      data.forEach((item: Item) => {
        initial[item.id] = String(item.current_count)
      })
      setCounts(initial)
    } catch {
      setError('Failed to load items. Check your connection.')
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (itemId: string, value: string) => {
    if (value === '' || /^\d+$/.test(value)) {
      setCounts((prev) => ({ ...prev, [itemId]: value }))
    }
  }

  const handleSubmit = async () => {
    setSaving(true)
    setError('')
    try {
      const payload = Object.entries(counts)
        .filter(([, v]) => v !== '')
        .map(([item_id, count]) => ({ item_id, count: parseInt(count) }))

      const res = await fetch('/api/counts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ counts: payload, entered_by: 'shift_lead' }),
      })

      if (!res.ok) throw new Error('Save failed')
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch {
      setError('Could not save. Try again.')
    } finally {
      setSaving(false)
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
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Count Entry</h1>
          <p className="text-gray-500 mt-1">Enter today&apos;s counts for each item.</p>
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
                      className={`flex items-center gap-4 px-5 py-4 ${
                        idx < catItems.length - 1 ? 'border-b border-gray-100' : ''
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-900 text-base leading-tight">
                          {item.name}
                        </p>
                        <p className="text-sm text-gray-400">{item.unit}</p>
                      </div>
                      <div className="flex-shrink-0">
                        <input
                          ref={idx === 0 && category === CATEGORIES[0] ? firstInputRef : undefined}
                          type="number"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          className="count-input w-20 text-center text-2xl font-bold border-2 border-gray-200 rounded-xl py-2 px-1 focus:outline-none focus:border-blue-400 bg-slate-50"
                          value={counts[item.id] ?? ''}
                          onChange={(e) => handleChange(item.id, e.target.value)}
                          min="0"
                          placeholder="0"
                        />
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
    </div>
  )
}
