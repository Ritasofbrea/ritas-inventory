'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Navigation from '@/components/Navigation'
import BackToTop from '@/components/BackToTop'
import { getRole } from '@/lib/auth'
import { Item, CATEGORIES } from '@/lib/types'
import { unitLabel, subUnitSetupLabel, subUnitPreview } from '@/lib/units'
import { packSizePreview } from '@/lib/order-units'
import { Flavor, FLAVOR_TYPE_LABELS, PROGRAM_LABELS, PROGRAM_BADGE_ICON, PROGRAM_BADGE_CLASS, groupFlavorsByType } from '@/lib/flavors'

export default function ManageItemsPage() {
  const router = useRouter()
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const errorRef = useRef<HTMLDivElement>(null)
  // Patch 53: a failed save anywhere on this (often long, scrolled-down)
  // page used to leave the error banner off-screen at the top -- the Save
  // button correctly stopped saying "Saving…", but with nothing visible
  // changing where the user was actually looking, it read as "nothing
  // happened." Scrolls the banner into view the moment any setError call
  // on this page sets a real message.
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [error])

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
  const [editUnitsPerSubUnit, setEditUnitsPerSubUnit] = useState('')
  const [editCategory, setEditCategory] = useState<typeof CATEGORIES[number]>(CATEGORIES[0])
  const [editDistributor, setEditDistributor] = useState('')
  const [editItemNumber, setEditItemNumber] = useState('')
  const [editDistributorItemName, setEditDistributorItemName] = useState('')
  const [saving, setSaving] = useState(false)

  // Delete confirm state
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Reorder state
  const [moving, setMoving] = useState(false)
  const [search, setSearch] = useState('')
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())

  // Patch 37: on/off switch state
  const [offFilter, setOffFilter] = useState<'all' | 'on' | 'off'>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [bulkWorking, setBulkWorking] = useState(false)

  // Patch 44: pack size (order-unit case size) inline editor state
  const [packSizeEditId, setPackSizeEditId] = useState<string | null>(null)
  const [packSizeValue, setPackSizeValue] = useState('')
  const [packSizeSaving, setPackSizeSaving] = useState(false)

  // Patch 45: flavor link inline editor state (Ice Mix items only)
  const [flavors, setFlavors] = useState<Flavor[]>([])
  const [flavorEditId, setFlavorEditId] = useState<string | null>(null)
  const [flavorValue, setFlavorValue] = useState('')
  const [flavorSaving, setFlavorSaving] = useState(false)

  // Patch 38: storage switch + add/move/correction panel state
  const [storageTogglingId, setStorageTogglingId] = useState<string | null>(null)
  const [storagePanelId, setStoragePanelId] = useState<string | null>(null)
  const [storageAction, setStorageAction] = useState<'add' | 'move' | 'move_to_storage' | 'correction'>('add')
  const [storageAmount, setStorageAmount] = useState('')
  const [storageNote, setStorageNote] = useState('')
  const [storageWorking, setStorageWorking] = useState(false)

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
  }

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

  // ?all=true so an item currently linked to an inactive flavor (Cola,
  // Blue Hawaii) can still show its current link in the picker, marked
  // inactive — the picker's own option list below filters to active-only
  // otherwise.
  const fetchFlavors = async () => {
    try {
      const res = await fetch('/api/flavors?all=true')
      if (res.ok) setFlavors(await res.json())
    } catch {
      // non-critical — the Flavor field just won't offer choices if this fails
    }
  }

  useEffect(() => {
    const role = getRole()
    if (!role) { router.replace('/login'); return }
    if (role !== 'owner') { router.replace('/count'); return }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: fetches on mount, this app's standard load-on-mount pattern
    fetchItems()
    fetchFlavors()
  }, [router])

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
    setEditUnitsPerSubUnit(item.units_per_sub_unit != null ? String(item.units_per_sub_unit) : '')
    setEditCategory(item.category)
    setEditDistributor(item.distributor || '')
    setEditItemNumber(item.item_number || '')
    setEditDistributorItemName(item.distributor_item_name || '')
    setConfirmDeleteId(null)
  }

  const handleSaveEdit = async (item: Item) => {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/items', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: item.id,
          name: editName.trim(),
          unit: editUnit.trim(),
          // Bug fix (patch 53): items.secondary_unit is NOT NULL DEFAULT ''
          // -- sending null here (instead of '') violated that constraint
          // and made the server 500 on every save for any item with no
          // secondary unit, name changes included. '' is the column's own
          // "none" value everywhere else it's read (`item.secondary_unit &&`
          // is already falsy for either '' or null).
          secondary_unit: editSecondaryUnit.trim(),
          units_per_sub_unit: editSecondaryUnit.trim() && editUnitsPerSubUnit ? parseInt(editUnitsPerSubUnit, 10) : null,
          category: editCategory,
          distributor: editDistributor || null,
          item_number: editItemNumber.trim() || null,
          distributor_item_name: editDistributorItemName.trim() || null,
        }),
      })
      const body = await res.json().catch(() => null)
      // Bug fix: a failed save used to throw a bare Error() here, which the
      // catch below turned into a generic "Could not save" with no detail
      // — the real reason (whatever the server actually said) never
      // reached the screen. Now surfaces the server's own message when
      // there is one.
      if (!res.ok) throw new Error(body?.error || 'Could not save. Try again.')
      setItems((prev) => prev.map((i) => (i.id === item.id ? body : i)))
      setEditingId(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. Try again.')
    } finally {
      setSaving(false)
    }
  }

  // Patch 44: owner-only, separate route from the shared SL+ items PATCH
  // (same reasoning as is_off/storage — see src/app/api/items/pack-size).
  const openPackSizeEdit = (item: Item) => {
    setPackSizeEditId(item.id)
    setPackSizeValue(item.pack_size != null ? String(item.pack_size) : '')
  }

  const savePackSize = async (item: Item) => {
    setPackSizeSaving(true)
    setError('')
    try {
      const trimmed = packSizeValue.trim()
      const pack_size = trimmed === '' ? null : parseInt(trimmed, 10)
      const res = await fetch('/api/items/pack-size', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, pack_size }),
      })
      if (!res.ok) throw new Error()
      const updated = await res.json()
      setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)))
      setPackSizeEditId(null)
    } catch {
      setError('Could not save pack size. Try again.')
    } finally {
      setPackSizeSaving(false)
    }
  }

  // Patch 45: owner-only, separate route from the shared SL+ items PATCH
  // (same reasoning as pack_size/is_off/storage — see
  // src/app/api/items/flavor). Ice Mix items only.
  const openFlavorEdit = (item: Item) => {
    setFlavorEditId(item.id)
    setFlavorValue(item.flavor_id ?? '')
  }

  const saveFlavor = async (item: Item) => {
    setFlavorSaving(true)
    setError('')
    try {
      const res = await fetch('/api/items/flavor', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, flavor_id: flavorValue || null }),
      })
      if (!res.ok) throw new Error()
      const updated = await res.json()
      setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)))
      setFlavorEditId(null)
    } catch {
      setError('Could not save flavor. Try again.')
    } finally {
      setFlavorSaving(false)
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
    setError('')
    try {
      // Bug fix (patch 53): neither call's response was ever checked, so a
      // failure (e.g. supplier_order not yet whitelisted server-side) was
      // invisible -- local state still optimistically "moved" the item,
      // making the reorder look like it worked until the next refresh.
      const [resA, resB] = await Promise.all([
        fetch('/api/items', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: itemA.id, supplier_order: bOrder }) }),
        fetch('/api/items', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: itemB.id, supplier_order: aOrder }) }),
      ])
      if (!resA.ok || !resB.ok) throw new Error('Could not reorder. Try again.')
      setItems((prev) => prev.map((i) => {
        if (i.id === itemA.id) return { ...i, supplier_order: bOrder }
        if (i.id === itemB.id) return { ...i, supplier_order: aOrder }
        return i
      }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reorder. Try again.')
    } finally {
      setMoving(false)
    }
  }

  // Patch 37: single-item and bulk on/off both go through the owner-only
  // PATCH /api/items/off -- never the shared PATCH above, which ignores
  // is_off entirely.
  const toggleOff = async (item: Item) => {
    setTogglingId(item.id)
    setError('')
    try {
      const res = await fetch('/api/items/off', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [item.id], is_off: !item.is_off }),
      })
      if (!res.ok) throw new Error()
      const updated: Item[] = await res.json()
      setItems((prev) => prev.map((i) => updated.find((u) => u.id === i.id) ?? i))
    } catch {
      setError('Could not update. Try again.')
    } finally {
      setTogglingId(null)
    }
  }

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleBulkToggle = async (is_off: boolean) => {
    if (selectedIds.size === 0) return
    setBulkWorking(true)
    setError('')
    try {
      const res = await fetch('/api/items/off', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds), is_off }),
      })
      if (!res.ok) throw new Error()
      const updated: Item[] = await res.json()
      const updatedMap = new Map(updated.map((u) => [u.id, u]))
      setItems((prev) => prev.map((i) => updatedMap.get(i.id) ?? i))
      setSelectedIds(new Set())
    } catch {
      setError('Could not update selected items. Try again.')
    } finally {
      setBulkWorking(false)
    }
  }

  // Patch 38: storage switch + add/move/correction, all through the
  // owner-only /api/items/storage* routes -- never the shared PATCH, which
  // ignores these fields entirely.
  const toggleHasStorage = async (item: Item) => {
    setStorageTogglingId(item.id)
    setError('')
    try {
      const res = await fetch('/api/items/storage', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, has_storage: !item.has_storage }),
      })
      if (!res.ok) throw new Error()
      const updated: Item = await res.json()
      setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)))
      if (!updated.has_storage) setStoragePanelId((p) => (p === item.id ? null : p))
    } catch {
      setError('Could not update. Try again.')
    } finally {
      setStorageTogglingId(null)
    }
  }

  const openStoragePanel = (item: Item) => {
    setStoragePanelId((p) => (p === item.id ? null : item.id))
    setStorageAction('add')
    setStorageAmount('')
    setStorageNote('')
  }

  const submitStorageAction = async (item: Item) => {
    const value = parseFloat(storageAmount)
    if (storageAmount.trim() === '' || Number.isNaN(value)) {
      setError('Enter a valid number.')
      return
    }
    const endpoint =
      storageAction === 'add' ? '/api/items/storage/add'
      : storageAction === 'move' ? '/api/items/storage/move'
      : storageAction === 'move_to_storage' ? '/api/items/storage/move-to-storage'
      : '/api/items/storage/correction'
    const body = storageAction === 'correction'
      ? { id: item.id, new_value: value, note: storageNote.trim() || undefined }
      : { id: item.id, amount: value, note: storageNote.trim() || undefined }

    setStorageWorking(true)
    setError('')
    try {
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not update storage.')
      setItems((prev) => prev.map((i) => (i.id === item.id ? (data as Item) : i)))
      setStoragePanelId(null)
      setStorageAmount('')
      setStorageNote('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update storage. Try again.')
    } finally {
      setStorageWorking(false)
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
          <div ref={errorRef} className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3">
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

          {/* Patch 37: on/off filter pills */}
          <div className="flex gap-2 mb-4 flex-wrap">
            {(['all', 'on', 'off'] as const).map((f) => {
              const count = f === 'all' ? items.length : f === 'on' ? items.filter((i) => !i.is_off).length : items.filter((i) => i.is_off).length
              const label = f === 'all' ? `All (${count})` : f === 'on' ? `On (${count})` : `❄️ Off (${count})`
              const activeClass = f === 'off' ? 'bg-indigo-500 text-white border-indigo-500' : 'bg-gray-800 text-white border-gray-800'
              const inactiveClass = f === 'off' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-white text-gray-600 border-gray-200'
              return (
                <button
                  key={f}
                  onClick={() => setOffFilter(f)}
                  className={`min-h-[40px] px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${offFilter === f ? activeClass : inactiveClass}`}
                >
                  {label}
                </button>
              )
            })}
          </div>

          <div className="mb-4">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search items…"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 focus:outline-none focus:border-blue-400 bg-white text-sm"
            />
          </div>

          {/* Patch 37: bulk on/off action bar */}
          {selectedIds.size > 0 && (
            <div className="mb-4 bg-indigo-50 border border-indigo-200 rounded-2xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
              <p className="text-sm font-semibold text-indigo-800">{selectedIds.size} selected</p>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => handleBulkToggle(true)}
                  disabled={bulkWorking}
                  className="min-h-[48px] bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white font-semibold px-4 py-2 rounded-xl text-sm transition-colors"
                >
                  {bulkWorking ? 'Working…' : '❄️ Turn Off'}
                </button>
                <button
                  onClick={() => handleBulkToggle(false)}
                  disabled={bulkWorking}
                  className="min-h-[48px] bg-white hover:bg-gray-50 disabled:bg-gray-100 text-gray-700 font-semibold px-4 py-2 rounded-xl text-sm border border-gray-200 transition-colors"
                >
                  {bulkWorking ? 'Working…' : 'Turn On'}
                </button>
                <button
                  onClick={() => setSelectedIds(new Set())}
                  disabled={bulkWorking}
                  className="min-h-[48px] text-gray-500 hover:text-gray-700 font-semibold px-3 py-2 rounded-xl text-sm"
                >
                  Clear
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-6">
            {CATEGORIES.map((cat) => {
              const searchTerm = search.trim().toLowerCase()
              const catItems = [...items.filter((i) =>
                i.category === cat &&
                (!searchTerm || i.name.toLowerCase().includes(searchTerm)) &&
                (offFilter === 'all' || (offFilter === 'off' ? i.is_off : !i.is_off))
              )].sort((a, b) => {
                if (a.supplier_order == null && b.supplier_order == null) return 0
                if (a.supplier_order == null) return 1
                if (b.supplier_order == null) return -1
                return a.supplier_order - b.supplier_order
              })
              if (catItems.length === 0) return null
              const expanded = expandedCategories.has(cat)
              return (
                <div key={cat}>
                  <button
                    type="button"
                    onClick={() => toggleCategory(cat)}
                    aria-expanded={expanded}
                    className="w-full min-h-[48px] flex items-center justify-between gap-3 px-4 py-3 mb-2 bg-white rounded-xl border border-gray-100 shadow-sm active:bg-gray-50 transition-colors"
                  >
                    <span className="text-xs font-bold uppercase tracking-widest text-blue-500">{cat}</span>
                    <svg className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {expanded && (
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
                            <div className="flex gap-2">
                              <div className="flex flex-col gap-1 flex-1">
                                <span className="text-xs text-gray-400">Category</span>
                                <select
                                  className="border border-blue-300 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500 bg-white"
                                  value={editCategory}
                                  onChange={(e) => setEditCategory(e.target.value as typeof CATEGORIES[number])}
                                >
                                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                                </select>
                              </div>
                              <div className="flex flex-col gap-1 w-32">
                                <span className="text-xs text-gray-400">Distributor</span>
                                <select
                                  className="border border-blue-300 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500 bg-white"
                                  value={editDistributor}
                                  onChange={(e) => setEditDistributor(e.target.value)}
                                >
                                  <option value="">—</option>
                                  <option value="bunzl">Bunzl</option>
                                  <option value="balford">Balford</option>
                                  <option value="other">Other</option>
                                  <option value="seasonal">Seasonal</option>
                                  <option value="discontinued">Discontinued</option>
                                </select>
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <div className="flex flex-col gap-1 flex-1">
                                <span className="text-xs text-gray-400">Item # (distributor)</span>
                                <input
                                  type="text"
                                  className="border border-blue-300 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500"
                                  value={editItemNumber}
                                  onChange={(e) => setEditItemNumber(e.target.value)}
                                  placeholder="e.g. 0101"
                                />
                              </div>
                              <div className="flex flex-col gap-1 flex-1">
                                <span className="text-xs text-gray-400">Catalog name</span>
                                <input
                                  type="text"
                                  className="border border-blue-300 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500"
                                  value={editDistributorItemName}
                                  onChange={(e) => setEditDistributorItemName(e.target.value)}
                                  placeholder="Name in catalog"
                                />
                              </div>
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
                            {editSecondaryUnit.trim() && (
                              <div className="flex flex-col gap-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-gray-400 flex-shrink-0">{subUnitSetupLabel(editUnit, editSecondaryUnit)}</span>
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    className="flex-1 border border-purple-200 rounded-xl px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-purple-400"
                                    value={editUnitsPerSubUnit}
                                    onChange={(e) => {
                                      const v = e.target.value
                                      if (v === '' || /^\d*$/.test(v)) setEditUnitsPerSubUnit(v)
                                    }}
                                    placeholder="e.g. 2"
                                  />
                                </div>
                                {subUnitPreview(editUnit, editSecondaryUnit, parseInt(editUnitsPerSubUnit, 10) || null) && (
                                  <p className="text-xs text-purple-500">{subUnitPreview(editUnit, editSecondaryUnit, parseInt(editUnitsPerSubUnit, 10) || null)}</p>
                                )}
                              </div>
                            )}
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
                          <div className={`flex flex-col gap-2 ${item.is_off ? 'opacity-60' : ''}`}>
                            <div className="flex items-center gap-3">
                              <input
                                type="checkbox"
                                checked={selectedIds.has(item.id)}
                                onChange={() => toggleSelected(item.id)}
                                className="w-5 h-5 flex-shrink-0 accent-indigo-600 cursor-pointer"
                                aria-label={`Select ${item.name}`}
                              />
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
                                <p className="font-semibold text-gray-900 flex items-center gap-1.5 flex-wrap">
                                  {item.name}
                                  {item.is_off && (
                                    <span className="flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 border border-indigo-200">❄️ OFF</span>
                                  )}
                                  {item.has_storage && (
                                    <span className="flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded bg-teal-100 text-teal-700 border border-teal-200">📦 STORAGE</span>
                                  )}
                                  {/* Patch 45: flavor program badge -- label only, reuses the
                                      exact shared badge from the Flavor Catalog/weekly planner
                                      (src/lib/flavors.ts), never a new style. flex-wrap above
                                      keeps this from crowding OFF/STORAGE on a phone. */}
                                  {item.category === 'Ice Mix' && item.flavor?.program && (
                                    <span className={PROGRAM_BADGE_CLASS}>
                                      <span>{PROGRAM_BADGE_ICON[item.flavor.program]}</span>
                                      {PROGRAM_LABELS[item.flavor.program]}
                                    </span>
                                  )}
                                </p>
                                <p className="text-sm text-gray-400">
                                  {item.unit}
                                  {item.secondary_unit && <span className="text-purple-400"> + {item.secondary_unit}</span>}
                                  {item.item_number && <span className="font-mono text-gray-400"> · #{item.item_number}</span>}
                                  {item.distributor && <span className="text-gray-300"> · {item.distributor}</span>}
                                </p>
                                {packSizePreview(item.unit, item.pack_size) && (
                                  <p className="text-xs text-gray-400">{packSizePreview(item.unit, item.pack_size)}</p>
                                )}
                                {item.category === 'Ice Mix' && item.flavor && (
                                  <p className="text-xs text-gray-400">
                                    Flavor: {item.flavor.name} ({FLAVOR_TYPE_LABELS[item.flavor.type]}){!item.flavor.active && ' — inactive'}
                                  </p>
                                )}
                              </div>
                            </div>

                            {/* Patch 44: pack size inline editor */}
                            {packSizeEditId === item.id && (
                              <div className="ml-8 bg-gray-50 border border-gray-200 rounded-xl p-3 flex flex-col gap-2">
                                <p className="text-xs text-gray-500">
                                  How many {unitLabel(item.unit, 2)} come in one case? Leave blank for no change to today&apos;s default order quantity.
                                </p>
                                <div className="flex items-center gap-2">
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    value={packSizeValue}
                                    onChange={(e) => { const v = e.target.value; if (v === '' || /^\d*$/.test(v)) setPackSizeValue(v) }}
                                    placeholder="e.g. 4"
                                    className="w-20 border border-gray-300 rounded-xl px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-gray-500"
                                  />
                                  <button
                                    onClick={() => savePackSize(item)}
                                    disabled={packSizeSaving}
                                    className="min-h-[36px] bg-gray-700 hover:bg-gray-800 disabled:opacity-50 text-white font-semibold text-sm px-3 py-1.5 rounded-lg"
                                  >
                                    {packSizeSaving ? 'Saving…' : 'Save'}
                                  </button>
                                </div>
                                {packSizePreview(item.unit, parseInt(packSizeValue, 10) || null) && (
                                  <p className="text-xs text-gray-500">{packSizePreview(item.unit, parseInt(packSizeValue, 10) || null)}</p>
                                )}
                              </div>
                            )}

                            {/* Patch 45: flavor link inline editor, Ice Mix only */}
                            {flavorEditId === item.id && (
                              <div className="ml-8 bg-gray-50 border border-gray-200 rounded-xl p-3 flex flex-col gap-2">
                                <p className="text-xs text-gray-500">
                                  Which flavor is this? Changing the flavor&apos;s program tag in the Flavor Catalog updates the badge here automatically.
                                </p>
                                <select
                                  value={flavorValue}
                                  onChange={(e) => setFlavorValue(e.target.value)}
                                  className="min-h-[44px] border border-gray-300 rounded-xl px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-gray-500"
                                >
                                  <option value="">No flavor</option>
                                  {groupFlavorsByType(
                                    flavors.filter((f) => f.active || f.id === item.flavor_id)
                                  ).map(({ type, flavors: typeFlavors }) => (
                                    <optgroup key={type} label={FLAVOR_TYPE_LABELS[type]}>
                                      {typeFlavors.map((f) => (
                                        <option key={f.id} value={f.id}>
                                          {f.name}{!f.active ? ' (inactive)' : ''}
                                        </option>
                                      ))}
                                    </optgroup>
                                  ))}
                                </select>
                                <button
                                  onClick={() => saveFlavor(item)}
                                  disabled={flavorSaving}
                                  className="min-h-[40px] bg-gray-700 hover:bg-gray-800 disabled:opacity-50 text-white font-semibold text-sm px-3 py-1.5 rounded-lg self-start"
                                >
                                  {flavorSaving ? 'Saving…' : 'Save'}
                                </button>
                              </div>
                            )}

                            {/* Patch 38: storage number + last-updated, only for flagged items */}
                            {item.has_storage && (
                              <div className="ml-8 text-xs text-teal-700 bg-teal-50 border border-teal-200 rounded-lg px-3 py-2 flex items-center justify-between gap-2 flex-wrap">
                                <span>📦 In storage: <span className="font-bold">{item.storage_count}</span> {unitLabel(item.unit, item.storage_count)}</span>
                                <span className="text-teal-500">
                                  {item.storage_updated_at
                                    ? `updated ${new Date(item.storage_updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                                    : 'never updated'}
                                </span>
                              </div>
                            )}

                            <div className="flex gap-2 flex-wrap pl-8">
                              <button
                                onClick={() => toggleOff(item)}
                                disabled={togglingId === item.id}
                                className={`min-h-[40px] text-sm font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                                  item.is_off
                                    ? 'bg-white text-gray-700 border-gray-200 hover:border-gray-400'
                                    : 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:border-indigo-400'
                                } disabled:opacity-50`}
                              >
                                {togglingId === item.id ? 'Working…' : item.is_off ? 'Turn On' : '❄️ Turn Off'}
                              </button>
                              <button
                                onClick={() => toggleHasStorage(item)}
                                disabled={storageTogglingId === item.id}
                                className={`min-h-[40px] text-sm font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                                  item.has_storage
                                    ? 'bg-white text-gray-700 border-gray-200 hover:border-gray-400'
                                    : 'bg-teal-50 text-teal-700 border-teal-200 hover:border-teal-400'
                                } disabled:opacity-50`}
                              >
                                {storageTogglingId === item.id ? 'Working…' : item.has_storage ? 'Remove Storage' : '📦 Has Storage'}
                              </button>
                              {item.has_storage && (
                                <button
                                  onClick={() => openStoragePanel(item)}
                                  className="min-h-[40px] text-sm font-semibold px-3 py-1.5 rounded-lg border border-teal-200 text-teal-700 hover:border-teal-400"
                                >
                                  {storagePanelId === item.id ? 'Close' : 'Manage Storage'}
                                </button>
                              )}
                              <button
                                onClick={() => (packSizeEditId === item.id ? setPackSizeEditId(null) : openPackSizeEdit(item))}
                                className="min-h-[40px] text-sm font-semibold px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:border-gray-400"
                              >
                                {packSizeEditId === item.id ? 'Close' : item.pack_size ? 'Edit Pack Size' : 'Set Pack Size'}
                              </button>
                              {item.category === 'Ice Mix' && (
                                <button
                                  onClick={() => (flavorEditId === item.id ? setFlavorEditId(null) : openFlavorEdit(item))}
                                  className="min-h-[40px] text-sm font-semibold px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:border-gray-400"
                                >
                                  {flavorEditId === item.id ? 'Close' : item.flavor ? 'Change Flavor' : 'Set Flavor'}
                                </button>
                              )}
                              <button
                                onClick={() => startEdit(item)}
                                className="min-h-[40px] text-sm text-blue-600 hover:text-blue-800 px-3 py-1.5 rounded-lg border border-blue-100 hover:border-blue-300"
                              >
                                Rename
                              </button>
                              <button
                                onClick={() => { setConfirmDeleteId(item.id); setEditingId(null) }}
                                className="min-h-[40px] text-sm text-red-500 hover:text-red-700 px-3 py-1.5 rounded-lg border border-red-100 hover:border-red-300"
                              >
                                Delete
                              </button>
                            </div>

                            {/* Patch 38: Add to Storage / Move to Store / Correct Count panel */}
                            {storagePanelId === item.id && (
                              <div className="ml-8 bg-teal-50 border border-teal-200 rounded-xl p-3 flex flex-col gap-2">
                                <div className="flex gap-2 flex-wrap">
                                  {(['add', 'move', 'move_to_storage', 'correction'] as const).map((a) => (
                                    <button
                                      key={a}
                                      onClick={() => { setStorageAction(a); setStorageAmount(''); setStorageNote('') }}
                                      className={`min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                                        storageAction === a ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-teal-700 border-teal-200'
                                      }`}
                                    >
                                      {a === 'add' ? 'Add to Storage' : a === 'move' ? 'Move to Store' : a === 'move_to_storage' ? 'Move to Storage' : 'Correct Count'}
                                    </button>
                                  ))}
                                </div>
                                <div className="flex gap-2 items-center">
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={storageAmount}
                                    onChange={(e) => {
                                      const v = e.target.value
                                      if (v === '' || /^\d*\.?\d*$/.test(v)) setStorageAmount(v)
                                    }}
                                    placeholder={storageAction === 'correction' ? 'New storage total' : 'Amount'}
                                    className="w-36 border border-teal-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-teal-400"
                                  />
                                  <span className="text-xs text-teal-600">{unitLabel(item.unit, parseFloat(storageAmount) || 0)}</span>
                                </div>
                                {storageAction === 'move' && (
                                  <p className="text-xs text-teal-600">Max: {item.storage_count} {unitLabel(item.unit, item.storage_count)} currently in storage.</p>
                                )}
                                {storageAction === 'move_to_storage' && (
                                  <p className="text-xs text-teal-600">Max: {item.current_count} {unitLabel(item.unit, item.current_count)} currently in the store.</p>
                                )}
                                <input
                                  type="text"
                                  value={storageNote}
                                  onChange={(e) => setStorageNote(e.target.value)}
                                  placeholder="Note (optional)"
                                  className="border border-teal-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-teal-400"
                                />
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => submitStorageAction(item)}
                                    disabled={storageWorking}
                                    className="min-h-[44px] flex-1 bg-teal-600 hover:bg-teal-700 disabled:bg-gray-300 text-white font-semibold py-2 rounded-xl text-sm transition-colors"
                                  >
                                    {storageWorking ? 'Working…' : 'Confirm'}
                                  </button>
                                  <button
                                    onClick={() => setStoragePanelId(null)}
                                    disabled={storageWorking}
                                    className="min-h-[44px] px-4 bg-white text-teal-700 border border-teal-200 rounded-xl text-sm font-semibold"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      </main>
      <BackToTop />
    </div>
  )
}
