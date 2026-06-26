'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Navigation from '@/components/Navigation'
import { getRole } from '@/lib/auth'
import { Item, CATEGORIES } from '@/lib/types'

interface ParDraft {
  [itemId: string]: string
}

interface Suggestion {
  suggested_par: number
  weekly_avg: number
  unit: string
}

export default function ParSettingsPage() {
  const router = useRouter()
  const [items, setItems] = useState<Item[]>([])
  const [pars, setPars] = useState<ParDraft>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [saved, setSaved] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const [suggestions, setSuggestions] = useState<Record<string, Suggestion>>({})

  useEffect(() => {
    const role = getRole()
    if (!role) { router.replace('/login'); return }
    if (role !== 'owner') { router.replace('/count'); return }
    fetchItems()
    fetch('/api/par-suggestions').then((r) => r.json()).then((d) => { if (!d.error) setSuggestions(d) })
  }, [router])

  const fetchItems = async () => {
    try {
      const res = await fetch('/api/items')
      const data = await res.json()
      setItems(data)
      const initial: ParDraft = {}
      data.forEach((item: Item) => { initial[item.id] = String(item.par_level) })
      setPars(initial)
    } catch {
      setError('Failed to load items.')
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (itemId: string, value: string) => {
    if (value === '' || /^\d+$/.test(value)) {
      setPars((prev) => ({ ...prev, [itemId]: value }))
    }
  }

  const handleSaveItem = async (item: Item) => {
    const newPar = parseInt(pars[item.id] || '0')
    setSaving(item.id)
    setError('')
    try {
      const res = await fetch('/api/items', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, par_level: newPar }),
      })
      if (!res.ok) throw new Error()
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, par_level: newPar } : i))
      )
      setSaved((prev) => new Set(prev).add(item.id))
      setTimeout(() => {
        setSaved((prev) => { const s = new Set(prev); s.delete(item.id); return s })
      }, 2000)
    } catch {
      setError('Could not save. Try again.')
    } finally {
      setSaving(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-400 text-lg">Loading…</p>
      </div>
    )
  }

  const itemsByCategory = CATEGORIES.reduce<Record<string, Item[]>>((acc, cat) => {
    acc[cat] = items.filter((i) => i.category === cat)
    return acc
  }, {})

  return (
    <div className="min-h-screen flex flex-col bg-[#d4edda]">
      <Navigation />

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Par Levels</h1>
          <p className="text-gray-500 mt-1">
            Set the minimum quantity for each item. Items below this amount show as LOW.
          </p>
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
                  {catItems.map((item, idx) => {
                    const suggestion = suggestions[item.id]
                    const showSuggestion = suggestion && suggestion.suggested_par !== item.par_level
                    return (
                    <div
                      key={item.id}
                      className={`flex items-center gap-3 px-5 py-4 ${
                        idx < catItems.length - 1 ? 'border-b border-gray-100' : ''
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-900">{item.name}</p>
                        <p className="text-sm text-gray-400">{item.unit}</p>
                        {showSuggestion && (
                          <button
                            onClick={() => setPars((prev) => ({ ...prev, [item.id]: String(suggestion.suggested_par) }))}
                            className="mt-1 text-xs text-blue-600 hover:text-blue-800 font-medium"
                          >
                            Suggested: {suggestion.suggested_par} · ~{suggestion.weekly_avg}/wk — Use ↑
                          </button>
                        )}
                      </div>
                      <input
                        type="number"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        className="count-input w-20 text-center text-xl font-bold border-2 border-gray-200 rounded-xl py-2 px-1 focus:outline-none focus:border-blue-400 bg-slate-50"
                        value={pars[item.id] ?? ''}
                        onChange={(e) => handleChange(item.id, e.target.value)}
                        min="0"
                        placeholder="0"
                      />
                      <button
                        onClick={() => handleSaveItem(item)}
                        disabled={saving === item.id || String(item.par_level) === pars[item.id]}
                        className={`px-3 py-2 rounded-lg text-sm font-semibold transition-colors min-w-[60px] ${
                          saved.has(item.id)
                            ? 'bg-green-100 text-green-700'
                            : saving === item.id
                            ? 'bg-gray-100 text-gray-400'
                            : String(item.par_level) === pars[item.id]
                            ? 'bg-gray-100 text-gray-300 cursor-default'
                            : 'bg-blue-100 hover:bg-blue-200 text-blue-700'
                        }`}
                      >
                        {saved.has(item.id) ? '✓' : saving === item.id ? '…' : 'Save'}
                      </button>
                    </div>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
      </main>
    </div>
  )
}
