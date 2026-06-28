'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Navigation from '@/components/Navigation'
import { getRole } from '@/lib/auth'
import { Item } from '@/lib/types'

type Mapping = {
  id: string
  quantity: number
  inventory_item_id: string
  items: { id: string; name: string; unit: string } | null
}

type CloverItem = {
  clover_id: string
  name: string
  category: string | null
  price: number | null
  clover_item_mappings: Mapping[]
}

const CATEGORY_ORDER = [
  'Italian Ice',
  'Soft Serve Custard',
  'Hand Scooped Custard',
  'Gelati',
  'Misto',
  'Blendini',
  'Concrete',
  'Milkshake',
  'Frozen Drink',
  'Frozen Coffee/Matcha',
  'Frozen Lemonade',
  'Fresh Baked Cookies',
  'Novelty',
  'Pretzels',
  'Beverages',
  'Add On',
  'Cool Stuff',
  'Fundraiser',
  'Full Service Catering',
]

export default function CloverMappingPage() {
  const router = useRouter()
  const [cloverItems, setCloverItems] = useState<CloverItem[]>([])
  const [inventoryItems, setInventoryItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')

  // Inline add form state — keyed by clover_id
  const [addingFor, setAddingFor] = useState<string | null>(null)
  const [newInventoryId, setNewInventoryId] = useState('')
  const [newQuantity, setNewQuantity] = useState('1')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const role = getRole()
    if (!role) { router.replace('/login'); return }
    if (role !== 'owner') { router.replace('/count'); return }
    Promise.all([
      fetch('/api/clover-items').then((r) => r.json()),
      fetch('/api/items').then((r) => r.json()),
    ]).then(([clover, inv]) => {
      setCloverItems(clover)
      setInventoryItems(inv)
      setLoading(false)
    })
  }, [router])

  const handleAddMapping = async (cloverItemId: string) => {
    if (!newInventoryId || !newQuantity) return
    setSaving(true)
    const res = await fetch('/api/clover-mappings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clover_item_id: cloverItemId, inventory_item_id: newInventoryId, quantity: newQuantity }),
    })
    if (res.ok) {
      const updated = await fetch('/api/clover-items').then((r) => r.json())
      setCloverItems(updated)
      setAddingFor(null)
      setNewInventoryId('')
      setNewQuantity('1')
    }
    setSaving(false)
  }

  const handleRemoveMapping = async (mappingId: string) => {
    await fetch('/api/clover-mappings', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: mappingId }),
    })
    setCloverItems((prev) =>
      prev.map((ci) => ({
        ...ci,
        clover_item_mappings: ci.clover_item_mappings.filter((m) => m.id !== mappingId),
      }))
    )
  }

  const openAddForm = (cloverItemId: string) => {
    setAddingFor(cloverItemId)
    setNewInventoryId('')
    setNewQuantity('1')
  }

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen"><p className="text-gray-400 text-lg">Loading…</p></div>
  }

  const searchTerm = search.trim().toLowerCase()
  const categories = CATEGORY_ORDER.filter((c) =>
    cloverItems.some((i) => i.category === c)
  )

  const filtered = cloverItems.filter((item) => {
    if (searchTerm && !item.name.toLowerCase().includes(searchTerm)) return false
    if (categoryFilter !== 'all' && item.category !== categoryFilter) return false
    return true
  })

  const byCategory = CATEGORY_ORDER.reduce<Record<string, CloverItem[]>>((acc, cat) => {
    const items = filtered.filter((i) => i.category === cat)
    if (items.length) acc[cat] = items
    return acc
  }, {})

  const mappedCount = cloverItems.filter((i) => i.clover_item_mappings.length > 0).length

  return (
    <div className="min-h-screen flex flex-col bg-[#d4edda]">
      <Navigation />

      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-6">
        <div className="mb-5">
          <h1 className="text-2xl font-bold text-gray-900">Clover Item Mapping</h1>
          <p className="text-gray-500 text-sm mt-1">
            Link each Clover menu item to the inventory items it consumes. {mappedCount} of {cloverItems.length} items mapped.
          </p>
        </div>

        {/* Progress bar */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-4 py-3 mb-5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Mapping Progress</p>
            <p className="text-sm font-bold text-gray-900">{mappedCount} / {cloverItems.length}</p>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all ${mappedCount === cloverItems.length ? 'bg-green-500' : mappedCount / cloverItems.length >= 0.5 ? 'bg-amber-400' : 'bg-blue-400'}`}
              style={{ width: `${Math.round((mappedCount / cloverItems.length) * 100)}%` }}
            />
          </div>
        </div>

        {/* Category filter */}
        <div className="flex gap-2 mb-4 overflow-x-auto pb-1 scrollbar-hide">
          <button
            onClick={() => setCategoryFilter('all')}
            className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${categoryFilter === 'all' ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-600 border-gray-200'}`}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${categoryFilter === cat ? 'bg-[#1a7a3c] text-white border-[#1a7a3c]' : 'bg-white text-gray-600 border-gray-200'}`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="mb-4">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search Clover items…"
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 focus:outline-none focus:border-blue-400 bg-white text-sm"
          />
        </div>

        {Object.keys(byCategory).length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-12 text-center">
            <p className="text-gray-400">No items match &ldquo;{search}&rdquo;</p>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {CATEGORY_ORDER.filter((c) => byCategory[c]).map((category) => (
              <section key={category}>
                <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">{category}</h2>
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                  {byCategory[category].map((item, idx, arr) => (
                    <div key={item.clover_id} className={`px-5 py-4 ${idx < arr.length - 1 ? 'border-b border-gray-100' : ''}`}>
                      {/* Item header */}
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-semibold text-gray-900 text-sm">{item.name}</p>
                          {item.price !== null && (
                            <p className="text-xs text-gray-400">${item.price.toFixed(2)}</p>
                          )}
                        </div>
                        <button
                          onClick={() => openAddForm(item.clover_id === addingFor ? '' : item.clover_id)}
                          className="flex-shrink-0 text-xs font-semibold text-[#1a7a3c] border border-[#1a7a3c] px-3 py-1.5 rounded-lg hover:bg-green-50 transition-colors"
                        >
                          + Add
                        </button>
                      </div>

                      {/* Existing mappings */}
                      {item.clover_item_mappings.length > 0 && (
                        <div className="mt-2 flex flex-col gap-1">
                          {item.clover_item_mappings.map((m) => (
                            <div key={m.id} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-1.5">
                              <span className="flex-1 text-sm text-gray-700">{m.items?.name ?? 'Unknown item'}</span>
                              <span className="text-xs text-gray-400">×{m.quantity} {m.items?.unit}</span>
                              <button
                                onClick={() => handleRemoveMapping(m.id)}
                                className="text-gray-300 hover:text-red-500 text-base leading-none ml-1 transition-colors"
                                aria-label="Remove"
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {item.clover_item_mappings.length === 0 && addingFor !== item.clover_id && (
                        <p className="text-xs text-gray-300 mt-1.5 italic">Not mapped yet</p>
                      )}

                      {/* Inline add form */}
                      {addingFor === item.clover_id && (
                        <div className="mt-3 pt-3 border-t border-gray-100">
                          <div className="flex gap-2 flex-wrap">
                            <select
                              value={newInventoryId}
                              onChange={(e) => setNewInventoryId(e.target.value)}
                              className="flex-1 min-w-0 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-400 bg-white"
                            >
                              <option value="">Select inventory item…</option>
                              {inventoryItems.map((inv) => (
                                <option key={inv.id} value={inv.id}>
                                  {inv.name} ({inv.unit})
                                </option>
                              ))}
                            </select>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              <span className="text-gray-400 text-sm">×</span>
                              <input
                                type="text"
                                inputMode="decimal"
                                value={newQuantity}
                                onChange={(e) => { if (e.target.value === '' || /^\d*\.?\d*$/.test(e.target.value)) setNewQuantity(e.target.value) }}
                                className="w-16 border border-gray-200 rounded-xl px-2 py-2 text-sm text-center text-gray-900 focus:outline-none focus:border-blue-400"
                              />
                            </div>
                          </div>
                          <div className="flex gap-2 mt-2">
                            <button
                              onClick={() => handleAddMapping(item.clover_id)}
                              disabled={saving || !newInventoryId || !newQuantity}
                              className="flex-1 bg-[#1a7a3c] hover:bg-[#155f2f] disabled:bg-gray-200 disabled:text-gray-400 text-white font-bold py-2 rounded-xl text-sm transition-colors"
                            >
                              {saving ? 'Saving…' : 'Save'}
                            </button>
                            <button
                              onClick={() => setAddingFor(null)}
                              className="px-4 py-2 text-gray-500 hover:text-gray-700 border border-gray-200 rounded-xl text-sm bg-white"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
