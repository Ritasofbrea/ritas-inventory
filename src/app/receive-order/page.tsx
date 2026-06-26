'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Navigation from '@/components/Navigation'
import { getRole } from '@/lib/auth'
import { Item, CATEGORIES } from '@/lib/types'

interface ReceivedQty {
  [itemId: string]: string
}

export default function ReceiveOrderPage() {
  const router = useRouter()
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [received, setReceived] = useState<ReceivedQty>({})
  const [type, setType] = useState<'received' | 'will_call'>('received')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const role = getRole()
    if (!role) { router.replace('/login'); return }
    if (role !== 'owner') { router.replace('/count'); return }
    fetchItems()
  }, [router])

  const fetchItems = async () => {
    try {
      const res = await fetch('/api/items')
      setItems(await res.json())
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (id: string, val: string) => {
    if (val === '' || /^\d*\.?\d*$/.test(val)) {
      setReceived((prev) => ({ ...prev, [id]: val }))
    }
  }

  const handleSubmit = async () => {
    const itemsReceived = Object.entries(received)
      .filter(([, qty]) => qty !== '' && parseFloat(qty) > 0)
      .map(([item_id, qty]) => {
        const item = items.find((i) => i.id === item_id)!
        return { item_id, item_name: item.name, quantity: parseFloat(qty), unit: item.unit }
      })

    if (itemsReceived.length === 0) {
      setError('Enter at least one quantity before saving.')
      return
    }

    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/order-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, notes, items: itemsReceived }),
      })
      if (!res.ok) throw new Error()
      setSaved(true)
      setReceived({})
      setNotes('')
      setTimeout(() => router.push('/order-list'), 1500)
    } catch {
      setError('Could not save. Try again.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen"><p className="text-gray-400 text-lg">Loading…</p></div>
  }

  const itemsByCategory = CATEGORIES.reduce<Record<string, Item[]>>((acc, cat) => {
    acc[cat] = items.filter((i) => i.category === cat)
    return acc
  }, {})

  const totalEntered = Object.values(received).filter((v) => v !== '' && parseFloat(v) > 0).length

  return (
    <div className="min-h-screen flex flex-col bg-[#d4edda]">
      <Navigation />

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6">
        <div className="mb-6">
          <button onClick={() => router.back()} className="text-sm text-gray-500 hover:text-gray-700 mb-2 flex items-center gap-1">
            ← Back
          </button>
          <h1 className="text-2xl font-bold text-gray-900">Receive Order</h1>
          <p className="text-gray-500 mt-1">Enter quantities received. They will be added to your current counts.</p>
        </div>

        {/* Type selector */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-5 flex gap-3">
          <button
            onClick={() => setType('received')}
            className={`flex-1 py-2.5 rounded-xl font-semibold text-sm transition-colors ${type === 'received' ? 'bg-[#1a7a3c] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            Weekly Delivery
          </button>
          <button
            onClick={() => setType('will_call')}
            className={`flex-1 py-2.5 rounded-xl font-semibold text-sm transition-colors ${type === 'will_call' ? 'bg-[#c8102e] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            Will Call
          </button>
        </div>

        {/* Notes */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-5 py-4 mb-5">
          <input
            type="text"
            placeholder="Notes (optional) — e.g. missing 2 cases of cups"
            className="w-full text-sm text-gray-700 focus:outline-none placeholder-gray-400"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">{error}</div>
        )}

        <p className="text-xs text-gray-400 mb-4">Enter 0 or leave blank for items not received. Only items with a quantity will be saved.</p>

        <div className="flex flex-col gap-6">
          {CATEGORIES.map((category) => {
            const catItems = itemsByCategory[category] || []
            if (catItems.length === 0) return null
            return (
              <section key={category}>
                <h2 className="text-xs font-bold uppercase tracking-widest text-blue-500 mb-3">{category}</h2>
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                  {catItems.map((item, idx) => (
                    <div
                      key={item.id}
                      className={`flex items-center gap-4 px-5 py-4 ${idx < catItems.length - 1 ? 'border-b border-gray-100' : ''}`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-900 text-base leading-tight">{item.name}</p>
                        <p className="text-sm text-gray-400">{item.unit} · on hand: {item.current_count}</p>
                      </div>
                      <input
                        type="text"
                        inputMode="decimal"
                        className={`w-20 text-center text-2xl font-bold border-2 rounded-xl py-2 px-1 focus:outline-none bg-slate-50 transition-colors ${
                          received[item.id] && parseFloat(received[item.id]) > 0
                            ? 'border-[#1a7a3c] bg-green-50'
                            : 'border-gray-200 focus:border-[#1a7a3c]'
                        }`}
                        value={received[item.id] ?? ''}
                        onChange={(e) => handleChange(item.id, e.target.value)}
                        placeholder="0"
                      />
                    </div>
                  ))}
                </div>
              </section>
            )
          })}
        </div>

        <div className="mt-8 pb-8">
          <button
            onClick={handleSubmit}
            disabled={saving || saved}
            className={`w-full py-5 rounded-2xl text-xl font-bold transition-colors shadow-md ${
              saved ? 'bg-green-500 text-white' : saving ? 'bg-gray-300 text-white cursor-wait' : 'bg-[#1a7a3c] hover:bg-[#155f2f] text-white'
            }`}
          >
            {saved ? '✓ Saved! Returning…' : saving ? 'Saving…' : `Save Receipt${totalEntered > 0 ? ` (${totalEntered} items)` : ''}`}
          </button>
        </div>
      </main>
    </div>
  )
}
