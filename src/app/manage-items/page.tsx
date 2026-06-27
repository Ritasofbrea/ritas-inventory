'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Navigation from '@/components/Navigation'
import { getRole } from '@/lib/auth'
import { Item, CATEGORIES } from '@/lib/types'

export default function ManageItemsPage() {
  const router = useRouter()
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Add form state
  const [newName, setNewName] = useState('')
  const [newCategory, setNewCategory] = useState(CATEGORIES[0])
  const [newUnit, setNewUnit] = useState('boxes')
  const [adding, setAdding] = useState(false)

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editUnit, setEditUnit] = useState('')
  const [editSecondaryUnit, setEditSecondaryUnit] = useState('')
  const [saving, setSaving] = useState(false)

  // Delete confirm state
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Reorder state
  const [moving, setMoving] = useState(false)

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
    } catch {
      setError('Failed to load items.')
    } finally {
      setLoading(false)
    }
  }

  const handleAdd = async () => {
    if (!newName.trim()) return
    setAdding(true)
    setError('')
    try {
      const res = await fetch('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), category: newCategory, unit: newUnit.trim() || 'boxes' }),
      })
      if (!res.ok) throw new Error()
      const created = await res.json()
      setItems((prev) => [...prev, created])
      setNewName('')
      setNewUnit('boxes')
    } catch {
      setError('Could not add item. Try again.')
    } finally {
      setAdding(false)
    }
  }

  const startEdit = (item: Item) => {
    setEditingId(item.id)
    setEditName(item.name)
    setEditUnit(item.unit)
    setEditSecondaryUnit(item.secondary_unit || '')
    setConfirmDeleteId(null)
  }

  const handleSaveEdit = async (item: Item) => {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/items', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, name: editName.trim(), unit: editUnit.trim(), secondary_unit: editSecondaryUnit.trim() }),
      })
      if (!res.ok) throw new Error()
      const updated = await res.json()
      setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)))
      setEditingId(null)
    } catch {
      setError('Could not save. Try again.')
    } finally {
      setSaving(false)
    }
  }

  const moveItem = async (item: Item, direction: 'up' | 'down', catItems: Item[]) => {
    if (moving) return
    const sorted = [...catItems].sort((a, b) => {
      if (a.supplier_order == null && b.supplier_order == null) return 0
      if (a.supplier_order == null) return 1
      if (b.supplier_order == null) return -1
      return a.supplier_order - b.supplier_order
    })
    const idx = sorted.findIndex((i) => i.id === item.id)
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= sorted.length) return
    const itemA = sorted[idx]
    const itemB = sorted[swapIdx]
    const aOrder = itemA.supplier_order ?? idx * 10
    const bOrder = itemB.supplier_order ?? swapIdx * 10
    setMoving(true)
    try {
      await Promise.all([
        fetch('/api/items', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: itemA.id, supplier_order: bOrder }) }),
        fetch('/api/items', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: itemB.id, supplier_order: aOrder }) }),
      ])
      setItems((prev) => prev.map((i) => {
        if (i.id === itemA.id) return { ...i, supplier_order: bOrder }
        if (i.id === itemB.id) return { ...i, supplier_order: aOrder }
        return i
      }))
    } finally {
      setMoving(false)
    }
  }

  const handleDelete = async (id: string) => {
    setDeleting(true)
    setError('')
    try {
      const res = await fetch('/api/items', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) throw new Error()
      setItems((prev) => prev.filter((i) => i.id !== id))
      setConfirmDeleteId(null)
    } catch {
      setError('Could not delete. Try again.')
    } finally {
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-400 text-lg">Loading…</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#d4edda]">
      <Navigation />

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Manage Items</h1>
          <p className="text-gray-500 mt-1">Add, rename, or remove items from the inventory.</p>
        </div>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3">
            {error}
          </div>
        )}

        {/* Add new item */}
        <section className="mb-8">
          <h2 className="text-xs font-bold uppercase tracking-widest text-blue-500 mb-3">Add New Item</h2>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">Item Name</label>
              <input
                type="text"
                className="border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 focus:outline-none focus:border-blue-400"
                placeholder="e.g. Mango Chili Powder"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              />
            </div>
            <div className="flex gap-3">
              <div className="flex flex-col gap-1 flex-1">
                <label className="text-xs text-gray-500 font-medium">Category</label>
                <select
                  className="border border-gray-200 rounded-xl px-3 py-2.5 text-gray-900 focus:outline-none focus:border-blue-400 bg-white"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value as typeof newCategory)}
                >
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1 w-32">
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
            <button
              onClick={handleAdd}
              disabled={adding || !newName.trim()}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold px-4 py-2.5 rounded-xl transition-colors"
            >
              {adding ? 'Adding…' : '+ Add Item'}
            </button>
          </div>
        </section>

        {/* Existing items by category */}
        <section>
          <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">All Items</h2>
          <div className="flex flex-col gap-6">
            {CATEGORIES.map((cat) => {
              const catItems = [...items.filter((i) => i.category === cat)].sort((a, b) => {
                if (a.supplier_order == null && b.supplier_order == null) return 0
                if (a.supplier_order == null) return 1
                if (b.supplier_order == null) return -1
                return a.supplier_order - b.supplier_order
              })
              if (catItems.length === 0) return null
              return (
                <div key={cat}>
                  <h3 className="text-xs font-bold uppercase tracking-widest text-blue-500 mb-2">{cat}</h3>
                  <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                    {catItems.map((item, idx) => (
                      <div
                        key={item.id}
                        className={`px-5 py-4 ${idx < catItems.length - 1 ? 'border-b border-gray-100' : ''}`}
                      >
                        {editingId === item.id ? (
                          <div className="flex flex-col gap-2">
                            <div className="flex gap-2">
                              <input
                                type="text"
                                className="flex-1 border border-blue-300 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:border-blue-500"
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                autoFocus
                              />
                              <input
                                type="text"
                                className="w-24 border border-blue-300 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:border-blue-500"
                                value={editUnit}
                                onChange={(e) => setEditUnit(e.target.value)}
                                placeholder="unit"
                              />
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-400 flex-shrink-0">Sub-unit (optional):</span>
                              <input
                                type="text"
                                className="flex-1 border border-purple-200 rounded-xl px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-purple-400"
                                value={editSecondaryUnit}
                                onChange={(e) => setEditSecondaryUnit(e.target.value)}
                                placeholder="e.g. sleeves, container"
                              />
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleSaveEdit(item)}
                                disabled={saving || !editName.trim()}
                                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 text-white font-semibold py-2 rounded-xl text-sm"
                              >
                                {saving ? 'Saving…' : 'Save'}
                              </button>
                              <button
                                onClick={() => setEditingId(null)}
                                className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-600 font-semibold py-2 rounded-xl text-sm"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : confirmDeleteId === item.id ? (
                          <div className="flex flex-col gap-2">
                            <p className="text-sm text-red-700 font-medium">Delete <span className="font-bold">{item.name}</span>? This cannot be undone.</p>
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleDelete(item.id)}
                                disabled={deleting}
                                className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-gray-200 text-white font-semibold py-2 rounded-xl text-sm"
                              >
                                {deleting ? 'Deleting…' : 'Yes, Delete'}
                              </button>
                              <button
                                onClick={() => setConfirmDeleteId(null)}
                                className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-600 font-semibold py-2 rounded-xl text-sm"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3">
                            <div className="flex flex-col gap-0.5 flex-shrink-0">
                              <button
                                onClick={() => moveItem(item, 'up', catItems)}
                                disabled={moving || idx === 0}
                                className="text-gray-300 hover:text-gray-500 disabled:opacity-20 disabled:cursor-not-allowed leading-none"
                                aria-label="Move up"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" /></svg>
                              </button>
                              <button
                                onClick={() => moveItem(item, 'down', catItems)}
                                disabled={moving || idx === catItems.length - 1}
                                className="text-gray-300 hover:text-gray-500 disabled:opacity-20 disabled:cursor-not-allowed leading-none"
                                aria-label="Move down"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
                              </button>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-gray-900">{item.name}</p>
                              <p className="text-sm text-gray-400">
                                {item.unit}
                                {item.secondary_unit && (
                                  <span className="text-purple-400"> + {item.secondary_unit}</span>
                                )}
                              </p>
                            </div>
                            <button
                              onClick={() => startEdit(item)}
                              className="text-sm text-blue-600 hover:text-blue-800 px-3 py-1.5 rounded-lg border border-blue-100 hover:border-blue-300"
                            >
                              Rename
                            </button>
                            <button
                              onClick={() => { setConfirmDeleteId(item.id); setEditingId(null) }}
                              className="text-sm text-red-500 hover:text-red-700 px-3 py-1.5 rounded-lg border border-red-100 hover:border-red-300"
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </main>
    </div>
  )
}
