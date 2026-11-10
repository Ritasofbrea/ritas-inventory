'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Navigation from '@/components/Navigation'
import ScrollToSaveButton from '@/components/ScrollToSaveButton'
import BackToTop from '@/components/BackToTop'
import { getRole } from '@/lib/auth'
import { Item, CATEGORIES } from '@/lib/types'
import { PROGRAM_LABELS, PROGRAM_BADGE_ICON, PROGRAM_BADGE_CLASS } from '@/lib/flavors'
import { usesBoxOrdering, getOrderUnitLabel, packSizePreview, getPackWord } from '@/lib/order-units'
import { unitLabel } from '@/lib/units'
import { useBlockReload } from '@/lib/reload-guard'

interface OrderRecord {
  id: string
  type: string
  created_at: string
  related_order_id: string | null
  order_history_items: { item_id: string; item_name: string; quantity: number; unit: string }[]
}

interface ReceivedQty { [itemId: string]: string }
interface ShortItem { item_id: string; item_name: string; unit: string; ordered: number; received: number; short: number; acknowledged: boolean }

// Patch 56: a pack_size item whose typed box/case count looks like a
// mistake (typed more than was ordered, or -- when nothing was ordered for
// it -- typed a whole pack_size's worth or more). Flagged at Review & Save
// time, not on every keystroke, so a confirm popup never appears mid-typing.
interface MistakeItem { item_id: string; item_name: string; typedQty: number; stockQty: number; orderWord: string; stockUnit: string }

// Patch 57: one row of the will_call summary popup -- `detail` is the
// already-formatted "2 boxes = 12 bottles" (pack_size item) or "3 bags"
// (plain item) half of the line, item_name is kept separate so the modal
// can bold it the same way MistakeGuardModal bolds item names.
interface WillCallRow { item_id: string; item_name: string; detail: string }

type Step = 'select' | 'enter' | 'shorts' | 'done'

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// Patch 56: gray/neutral confirm popup for a suspiciously large pack_size
// quantity -- deliberately not amber/red/green/teal/indigo, since those
// already mean SHORT/FULL/storage/flavor-badge elsewhere in this app. A
// separate component (not inline JSX) so useBlockReload can be called
// unconditionally while it's mounted, same pattern as ConfirmModal.
function MistakeGuardModal({ items, onConfirm, onCancel }: { items: MistakeItem[]; onConfirm: () => void; onCancel: () => void }) {
  useBlockReload(true)
  const singleTotal = items.length === 1 ? items[0].stockQty : null
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" onClick={onCancel}>
      <div
        role="alertdialog"
        aria-label="Double-check this quantity"
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 className="text-xl font-bold text-gray-900">Double-check this quantity</h2>
          <div className="text-sm text-gray-600 mt-2 flex flex-col gap-1.5">
            {items.map((m) => (
              <p key={m.item_id}>
                <span className="font-semibold text-gray-800">{m.item_name}:</span> you typed {m.typedQty} {unitLabel(m.orderWord, m.typedQty)} = {m.stockQty} {unitLabel(m.stockUnit, m.stockQty)}. Is that right?
              </p>
            ))}
          </div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 min-h-[48px] bg-gray-100 hover:bg-gray-200 text-gray-600 font-semibold rounded-xl"
          >
            Fix it
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 min-h-[48px] bg-gray-700 hover:bg-gray-800 text-white font-semibold rounded-xl"
          >
            {singleTotal != null ? `Yes, add ${singleTotal}` : 'Yes, add all'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Patch 57: will_call's one summary popup at Save, replacing the per-item
// mistake guard for this delivery type only -- a will_call almost never has
// a prior order line to compare against, so every entered line is shown,
// always, regardless of quantity. Same gray/neutral styling as
// MistakeGuardModal, same two-big-button shape, deliberately a separate
// component (not a shared one with different props) since the two modals'
// trigger conditions and content are different enough that sharing would
// need more branching than just writing both out.
function WillCallSummaryModal({ rows, onConfirm, onCancel }: { rows: WillCallRow[]; onConfirm: () => void; onCancel: () => void }) {
  useBlockReload(true)
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" onClick={onCancel}>
      <div
        role="alertdialog"
        aria-label="Confirm will call receipt"
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 className="text-xl font-bold text-gray-900">Confirm Will Call Receipt</h2>
          <div className="text-sm text-gray-600 mt-2 flex flex-col gap-1.5">
            {rows.map((r) => (
              <p key={r.item_id}>
                <span className="font-semibold text-gray-800">{r.item_name}:</span> {r.detail}
              </p>
            ))}
          </div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 min-h-[48px] bg-gray-100 hover:bg-gray-200 text-gray-600 font-semibold rounded-xl"
          >
            Go back
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 min-h-[48px] bg-gray-700 hover:bg-gray-800 text-white font-semibold rounded-xl"
          >
            Yes, save all
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ReceiveOrderPage() {
  const router = useRouter()
  const [items, setItems] = useState<Item[]>([])
  const [recentOrders, setRecentOrders] = useState<OrderRecord[]>([])
  const [loading, setLoading] = useState(true)

  const [step, setStep] = useState<Step>('select')
  const [deliveryType, setDeliveryType] = useState<'received' | 'will_call'>('received')
  const [selectedOrder, setSelectedOrder] = useState<OrderRecord | null>(null)
  const [received, setReceived] = useState<ReceivedQty>({})
  // Patch 38: owner-only, per-item destination for a has_storage item's
  // received quantity. Defaults to 'store' -- identical to today's
  // behavior -- for every item unless an owner explicitly picks 'storage'.
  const [destinations, setDestinations] = useState<Record<string, 'store' | 'storage'>>({})
  const [notes, setNotes] = useState('')
  const [receivedBy, setReceivedBy] = useState('')
  const [shorts, setShorts] = useState<ShortItem[]>([])
  const [mistakeItems, setMistakeItems] = useState<MistakeItem[]>([])
  const [showMistakeModal, setShowMistakeModal] = useState(false)
  const [willCallRows, setWillCallRows] = useState<WillCallRow[]>([])
  const [showWillCallSummary, setShowWillCallSummary] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [role, setRole] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
  }

  const submitRef = useRef<HTMLDivElement>(null)

  const fetchItems = async () => {
    const res = await fetch('/api/items')
    setItems(await res.json())
  }

  const fetchRecentOrders = async () => {
    const res = await fetch('/api/order-history')
    const data = await res.json()
    const all: OrderRecord[] = Array.isArray(data) ? data : []
    const fulfilledIds = new Set(
      all.filter((r) => r.type === 'received' || r.type === 'will_call').map((r) => r.related_order_id).filter(Boolean) as string[]
    )
    const pending = all.filter((r) => r.type === 'ordered' && !fulfilledIds.has(r.id))
    setRecentOrders(pending.slice(0, 6))
  }

  useEffect(() => {
    const r = getRole()
    if (!r) { router.replace('/login'); return }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: resolve role once on mount, this app's standard page-load pattern
    setRole(r)
    Promise.all([fetchItems(), fetchRecentOrders()]).finally(() => setLoading(false))
  }, [router])

  const handleChange = (id: string, val: string) => {
    if (val === '' || /^\d*\.?\d*$/.test(val)) {
      setReceived((prev) => ({ ...prev, [id]: val }))
    }
  }

  const handleSelectOrder = (order: OrderRecord | null) => {
    setSelectedOrder(order)
    if (order) {
      const prefilled: ReceivedQty = {}
      order.order_history_items.forEach((i) => {
        prefilled[i.item_id] = String(i.quantity)
      })
      setReceived(prefilled)
    } else {
      setReceived({})
    }
  }

  // Patch 56: pack_size items only (plain items are never flagged, same as
  // today). Flags a typed box/case count that's either bigger than what
  // was actually ordered for that item, or -- when the item isn't on the
  // order at all (including a standalone/no-order receive) -- at or above
  // one full pack_size, since typing "6" for a 6-per-case item usually
  // means "I received 6 bottles," not "I received 6 cases."
  const detectMistakes = (): MistakeItem[] => {
    const flagged: MistakeItem[] = []
    for (const [itemId, val] of Object.entries(received)) {
      if (val === '' || !(parseFloat(val) > 0)) continue
      const item = items.find((i) => i.id === itemId)
      if (!item || !usesBoxOrdering(item)) continue
      const typedQty = parseFloat(val)
      const packSize = item.pack_size as number
      const onOrder = orderedItemIds.has(itemId)
      const orderedQtyForItem = onOrder ? Number(orderedQtyMap[itemId]) : null
      const isOverOrder = onOrder && orderedQtyForItem != null && typedQty > orderedQtyForItem
      const isOverPackWithNoOrder = !onOrder && typedQty >= packSize
      if (isOverOrder || isOverPackWithNoOrder) {
        flagged.push({
          item_id: itemId,
          item_name: item.name,
          typedQty,
          stockQty: Math.round(typedQty * packSize * 100) / 100,
          orderWord: getOrderUnitLabel(item),
          stockUnit: item.unit,
        })
      }
    }
    return flagged
  }

  // Patch 57: builds every entered line's summary row for the will_call
  // popup -- box/case math for a pack_size item (matching the live math
  // line already shown under that field), plain "qty unit" for everything
  // else. Mirrors detectMistakes()'s iteration but never filters anything
  // out -- will_call shows every entered line, always.
  const buildWillCallRows = (): WillCallRow[] => {
    const rows: WillCallRow[] = []
    for (const [itemId, val] of Object.entries(received)) {
      if (val === '' || !(parseFloat(val) > 0)) continue
      const item = items.find((i) => i.id === itemId)
      if (!item) continue
      const typedQty = parseFloat(val)
      if (usesBoxOrdering(item)) {
        const packSize = item.pack_size as number
        const stockQty = Math.round(typedQty * packSize * 100) / 100
        const orderWord = getOrderUnitLabel(item)
        rows.push({
          item_id: itemId,
          item_name: item.name,
          detail: `${typedQty} ${unitLabel(orderWord, typedQty)} = ${stockQty} ${unitLabel(item.unit, stockQty)}`,
        })
      } else {
        rows.push({ item_id: itemId, item_name: item.name, detail: `${typedQty} ${unitLabel(item.unit, typedQty)}` })
      }
    }
    return rows
  }

  // The shorts-detection + proceed flow -- unchanged from before patch 56,
  // just pulled out so the mistake-guard confirm can sit in front of it.
  const continueAfterMistakeCheck = () => {
    if (!selectedOrder) { proceedToSave([]); return }

    const detectedShorts: ShortItem[] = []
    for (const orderedItem of selectedOrder.order_history_items) {
      const orderedQty = Number(orderedItem.quantity)
      const receivedQty = parseFloat(received[orderedItem.item_id] || '0') || 0
      if (receivedQty < orderedQty) {
        detectedShorts.push({
          item_id: orderedItem.item_id,
          item_name: orderedItem.item_name,
          unit: orderedItem.unit,
          ordered: orderedQty,
          received: receivedQty,
          short: orderedQty - receivedQty,
          acknowledged: false,
        })
      }
    }

    if (detectedShorts.length > 0) {
      setShorts(detectedShorts)
      setStep('shorts')
    } else {
      proceedToSave([])
    }
  }

  const handleContinue = () => {
    setError('')
    if (role !== 'owner' && !receivedBy.trim()) { setError('Please enter your name before continuing.'); return }
    const entered = Object.entries(received).filter(([, v]) => v !== '' && parseFloat(v) > 0)
    if (entered.length === 0) { setError('Enter at least one quantity before continuing.'); return }

    // Patch 57: will_call always gets the one summary popup instead of
    // patch 56's per-item mistake guard -- a will_call line has nothing to
    // compare against (see the WillCallSummaryModal comment above), so
    // every entered line is shown, every time, and detectMistakes() (which
    // is built around "bigger than what was ordered" / "a full pack_size
    // with nothing ordered") never runs for this delivery type.
    if (deliveryType === 'will_call') {
      setWillCallRows(buildWillCallRows())
      setShowWillCallSummary(true)
      return
    }

    const flagged = detectMistakes()
    if (flagged.length > 0) {
      setMistakeItems(flagged)
      setShowMistakeModal(true)
      return
    }
    continueAfterMistakeCheck()
  }

  const confirmMistakeAndContinue = () => {
    setShowMistakeModal(false)
    continueAfterMistakeCheck()
  }

  const cancelMistakeModal = () => {
    setShowMistakeModal(false)
    setMistakeItems([])
  }

  const confirmWillCallAndContinue = () => {
    setShowWillCallSummary(false)
    continueAfterMistakeCheck()
  }

  const cancelWillCallSummary = () => {
    setShowWillCallSummary(false)
  }

  const toggleAck = (idx: number) => {
    setShorts((prev) => prev.map((s, i) => i === idx ? { ...s, acknowledged: !s.acknowledged } : s))
  }

  const allAcknowledged = shorts.every((s) => s.acknowledged)

  const proceedToSave = async (shortItems: ShortItem[]) => {
    setSaving(true)
    setError('')
    try {
      const receivedItems = Object.entries(received)
        .filter(([, qty]) => qty !== '' && parseFloat(qty) > 0)
        .map(([item_id, qty]) => {
          const item = items.find((i) => i.id === item_id)!
          // Patch 55: for an Ice Mix box item, the field the person typed
          // into is boxes -- convert to gallons here (the one and only
          // place) before it ever reaches the server, so
          // /api/order-history's patch-48 compare-and-swap stock write
          // and order_history_items both keep working in gallons exactly
          // as they do for every other item, unchanged.
          const enteredQty = parseFloat(qty)
          const quantity = usesBoxOrdering(item) ? enteredQty * (item.pack_size as number) : enteredQty
          return { item_id, item_name: item.name, quantity, unit: item.unit, destination: destinations[item_id] || 'store' }
        })

      // Save the receipt
      const receiptRes = await fetch('/api/order-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: deliveryType,
          notes,
          items: receivedItems,
          related_order_id: selectedOrder?.id || null,
          resolved: true,
          received_by: receivedBy.trim() || null,
        }),
      })
      if (!receiptRes.ok) throw new Error()
      const receipt = await receiptRes.json()

      // Save short shipment record if there are shorts
      if (shortItems.length > 0) {
        const shortRes = await fetch('/api/order-history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'short',
            notes: `Short shipment from ${deliveryType === 'will_call' ? 'will call' : 'delivery'} on ${new Date().toLocaleDateString()}`,
            items: shortItems.map((s) => ({
              item_id: s.item_id,
              item_name: s.item_name,
              quantity: s.short,
              unit: s.unit,
            })),
            related_order_id: receipt.id,
            resolved: false,
          }),
        })
        if (!shortRes.ok) {
          const errData = await shortRes.json().catch(() => ({}))
          throw new Error(errData.error || 'Failed to save short record')
        }
      }

      setStep('done')
      const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      const pushPayload = shortItems.length > 0
        ? { title: 'Short Shipment', body: `${shortItems.length} item${shortItems.length !== 1 ? 's' : ''} not received — check the dashboard` }
        : { title: 'Order Received', body: `An order was marked received at ${time}` }
      fetch('/api/send-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pushPayload),
      }).catch(() => {})
      setTimeout(() => router.push(shortItems.length > 0 ? '/dashboard' : '/order-list'), 1800)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save. Try again.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen"><p className="text-gray-400 text-lg">Loading…</p></div>
  }

  const receiveSearchTerm = search.trim().toLowerCase()
  const itemsByCategory = CATEGORIES.reduce<Record<string, Item[]>>((acc, cat) => {
    acc[cat] = items.filter((i) => i.category === cat && (!receiveSearchTerm || i.name.toLowerCase().includes(receiveSearchTerm)))
    return acc
  }, {})

  // Items on the selected order (for highlighting)
  const orderedItemIds = new Set(selectedOrder?.order_history_items.map((i) => i.item_id) || [])
  const orderedQtyMap = Object.fromEntries(selectedOrder?.order_history_items.map((i) => [i.item_id, i.quantity]) || [])

  const totalEntered = Object.values(received).filter((v) => v !== '' && parseFloat(v) > 0).length

  // STEP: DONE
  if (step === 'done') {
    return (
      <div className="min-h-screen flex flex-col bg-[#d4edda]">
        <Navigation />
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="bg-white rounded-2xl shadow-md p-10 text-center max-w-sm w-full">
            <p className="text-5xl mb-4">{shorts.length > 0 ? '⚠️' : '✅'}</p>
            <p className="text-2xl font-bold text-gray-900 mb-2">Receipt Saved</p>
            {shorts.length > 0 ? (
              <p className="text-red-600 font-semibold">Short shipment alert has been saved. Check the dashboard.</p>
            ) : (
              <p className="text-gray-500">All items received. Counts have been updated.</p>
            )}
          </div>
        </div>
      </div>
    )
  }

  // STEP: ACKNOWLEDGE SHORTS
  if (step === 'shorts') {
    return (
      <div className="min-h-screen flex flex-col bg-[#d4edda]">
        <Navigation />
        <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900">⚠️ Short Shipment Detected</h1>
            <p className="text-gray-500 mt-1">The following items are missing from this delivery. Check each box to confirm you have read this.</p>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-red-200 overflow-hidden mb-6">
            {shorts.map((s, idx) => (
              <label
                key={s.item_id}
                className={`flex items-center gap-4 px-5 py-4 cursor-pointer transition-colors ${s.acknowledged ? 'bg-red-50' : 'hover:bg-gray-50'} ${idx < shorts.length - 1 ? 'border-b border-gray-100' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={s.acknowledged}
                  onChange={() => toggleAck(idx)}
                  className="w-5 h-5 accent-[#c8102e] flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-gray-900">{s.item_name}</p>
                  <p className="text-sm text-gray-500">
                    Ordered: <span className="font-semibold">{s.ordered} {s.unit}</span>
                    {' · '}Received: <span className="font-semibold">{s.received} {s.unit}</span>
                    {' · '}<span className="text-red-600 font-bold">Short: {s.short} {s.unit}</span>
                  </p>
                </div>
              </label>
            ))}
          </div>

          {!allAcknowledged && (
            <p className="text-center text-sm text-red-500 mb-4 font-medium">Check all boxes above to confirm you have seen the shortage.</p>
          )}

          {error && <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">{error}</div>}

          <div className="flex gap-3">
            <button
              onClick={() => setStep('enter')}
              className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-4 rounded-2xl"
            >
              ← Go Back
            </button>
            <button
              onClick={() => proceedToSave(shorts)}
              disabled={!allAcknowledged || saving}
              className={`flex-1 py-4 rounded-2xl font-bold text-white transition-colors ${allAcknowledged && !saving ? 'bg-[#c8102e] hover:bg-[#a50d26]' : 'bg-gray-300 cursor-not-allowed'}`}
            >
              {saving ? 'Saving…' : 'Confirm & Save'}
            </button>
          </div>
        </main>
      </div>
    )
  }

  // STEP: SELECT ORDER
  if (step === 'select') {
    return (
      <div className="min-h-screen flex flex-col bg-[#d4edda]">
        <Navigation />
        <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6">
          <div className="mb-6">
            <button onClick={() => router.back()} className="text-sm text-gray-500 hover:text-gray-700 mb-2 flex items-center gap-1">← Back</button>
            <h1 className="text-2xl font-bold text-gray-900">Receive Order</h1>
            <p className="text-gray-500 mt-1">What are you receiving?</p>
          </div>

          {/* Delivery type */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-5 flex gap-3">
            <button
              onClick={() => setDeliveryType('received')}
              className={`flex-1 py-3 rounded-xl font-semibold text-sm transition-colors ${deliveryType === 'received' ? 'bg-[#1a7a3c] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              Weekly Delivery
            </button>
            <button
              onClick={() => setDeliveryType('will_call')}
              className={`flex-1 py-3 rounded-xl font-semibold text-sm transition-colors ${deliveryType === 'will_call' ? 'bg-[#c8102e] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              Will Call
            </button>
          </div>

          {/* Match to an order? */}
          <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Receiving against which order?</h2>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mb-5">
            <label className={`flex items-center gap-3 px-5 py-4 cursor-pointer border-b border-gray-100 transition-colors ${selectedOrder === null ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
              <input type="radio" name="order" checked={selectedOrder === null} onChange={() => handleSelectOrder(null)} className="accent-blue-600" />
              <div>
                <p className="font-semibold text-gray-900">No specific order / Standalone</p>
                <p className="text-xs text-gray-400">Just receiving stock — no short tracking</p>
              </div>
            </label>
            {recentOrders.length === 0 ? (
              <div className="px-5 py-4 text-sm text-gray-400">No recent orders found. Use &quot;Mark as Ordered&quot; on the Order List first.</div>
            ) : (
              recentOrders.map((order) => (
                <label key={order.id} className={`flex items-center gap-3 px-5 py-4 cursor-pointer border-b border-gray-100 last:border-0 transition-colors ${selectedOrder?.id === order.id ? 'bg-green-50' : 'hover:bg-gray-50'}`}>
                  <input type="radio" name="order" checked={selectedOrder?.id === order.id} onChange={() => handleSelectOrder(order)} className="accent-[#1a7a3c]" />
                  <div>
                    <p className="font-semibold text-gray-900">{formatDate(order.created_at)}</p>
                    <p className="text-xs text-gray-400">{order.order_history_items.length} items on this order</p>
                  </div>
                </label>
              ))
            )}
          </div>

          <button
            onClick={() => setStep('enter')}
            className="w-full bg-[#1a7a3c] hover:bg-[#155f2f] text-white font-bold py-4 rounded-2xl text-lg"
          >
            Continue →
          </button>
        </main>
      </div>
    )
  }

  // STEP: ENTER QUANTITIES
  return (
    <div className="min-h-screen flex flex-col bg-[#d4edda]">
      <Navigation />
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6">
        <div className="mb-4">
          <button onClick={() => setStep('select')} className="text-sm text-gray-500 hover:text-gray-700 mb-2 flex items-center gap-1">← Back</button>
          <h1 className="text-2xl font-bold text-gray-900">Enter Quantities Received</h1>
          {selectedOrder ? (
            <p className="text-sm text-[#1a7a3c] font-medium mt-1">Matching against order from {formatDate(selectedOrder.created_at)}</p>
          ) : (
            <p className="text-gray-500 mt-1 text-sm">Quantities will be added to current counts.</p>
          )}
        </div>

        {/* Who's receiving — shift lead only */}
        {role !== 'owner' && (
          <div className="mb-4 bg-white rounded-2xl shadow-sm border border-gray-100 px-5 py-4 flex items-center gap-3">
            <label className="text-sm font-semibold text-gray-600 flex-shrink-0">Who&apos;s receiving?</label>
            <input
              type="text"
              className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:border-blue-400 text-sm"
              placeholder="Enter your name"
              value={receivedBy}
              onChange={(e) => setReceivedBy(e.target.value)}
            />
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-5 py-4 mb-5">
          <input
            type="text"
            placeholder="Notes (optional) — e.g. missing 2 cases, damaged box"
            className="w-full text-sm text-gray-700 focus:outline-none placeholder-gray-400"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        {selectedOrder && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-5 text-sm text-amber-800 font-medium">
            Items highlighted in green were on this order. Enter less than the ordered amount to trigger a short shipment alert.
          </div>
        )}

        {error && <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">{error}</div>}

        <div className="mb-4">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search items…"
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 focus:outline-none focus:border-blue-400 bg-white text-sm"
          />
        </div>

        <div className="flex flex-col gap-6">
          {CATEGORIES.map((category) => {
            const catItems = itemsByCategory[category] || []
            if (catItems.length === 0) return null
            const expanded = expandedCategories.has(category)
            return (
              <section key={category}>
                <button
                  type="button"
                  onClick={() => toggleCategory(category)}
                  aria-expanded={expanded}
                  className="w-full min-h-[48px] flex items-center justify-between gap-3 px-4 py-3 mb-3 bg-white rounded-xl border border-gray-100 shadow-sm active:bg-gray-50 transition-colors"
                >
                  <span className="text-xs font-bold uppercase tracking-widest text-blue-500">{category}</span>
                  <svg className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {expanded && (
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                  {catItems.map((item, idx) => {
                    const isOnOrder = orderedItemIds.has(item.id)
                    const orderedQty = orderedQtyMap[item.id]
                    const receivedVal = parseFloat(received[item.id] || '0') || 0
                    const isShort = isOnOrder && received[item.id] !== undefined && received[item.id] !== '' && receivedVal < Number(orderedQty)
                    const isFull = isOnOrder && received[item.id] !== undefined && received[item.id] !== '' && receivedVal >= Number(orderedQty)
                    // Patch 55: for these items the field above is boxes,
                    // not the item's own (gallons) unit -- orderedQty is
                    // already box-denominated too (Order List's "Mark as
                    // Ordered" already sends box/case quantities), so the
                    // short/full comparisons above needed no changes at
                    // all, only the wording here and the final gallon
                    // conversion at save time.
                    const isBoxItem = usesBoxOrdering(item)

                    return (
                      <div
                        key={item.id}
                        className={`flex items-center gap-4 px-5 py-4 ${idx < catItems.length - 1 ? 'border-b border-gray-100' : ''} ${isOnOrder ? 'bg-green-50/40' : ''}`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="font-semibold text-gray-900 text-base leading-tight">{item.name}</p>
                            {isOnOrder && <span className="text-xs bg-[#1a7a3c] text-white px-1.5 py-0.5 rounded font-medium">On Order</span>}
                            {item.has_storage && <span className="flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded bg-teal-100 text-teal-700 border border-teal-200">📦 STORAGE</span>}
                            {/* Patch 52: flavor program badge -- label only, same shared
                                badge as Current Stock/Order List/Count/Par. flex-wrap
                                above keeps this from crowding On Order/STORAGE on a phone. */}
                            {item.category === 'Ice Mix' && item.flavor?.program && (
                              <span className={PROGRAM_BADGE_CLASS}>
                                <span>{PROGRAM_BADGE_ICON[item.flavor.program]}</span>
                                {PROGRAM_LABELS[item.flavor.program]}
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-gray-400">
                            {item.unit} · on hand: {item.current_count}
                            {item.has_storage && <span className="text-teal-600"> · in storage: {item.storage_count}</span>}
                            {isOnOrder && (
                              <span className="text-[#1a7a3c] font-semibold">
                                {' '}· ordered: {orderedQty}{isBoxItem ? ` ${unitLabel(getOrderUnitLabel(item), Number(orderedQty))}` : ''}
                              </span>
                            )}
                          </p>
                          {/* Patch 56: the conversion factor itself ("1 box
                              = 6 bottles"), shown for every pack_size item
                              regardless of whether anything's been typed
                              yet -- same shared helper Order List/Manage
                              Items use. */}
                          {isBoxItem && (
                            <p className="text-xs text-gray-400">{packSizePreview(item.unit, item.pack_size, getPackWord(item))}</p>
                          )}
                          {/* Patch 38: owner-only destination choice for a
                              has_storage item's received quantity. Default
                              stays Store -- shift_lead never sees this, and
                              an item without has_storage never gets it. */}
                          {role === 'owner' && item.has_storage && (
                            <div className="flex gap-1.5 mt-1.5">
                              {(['store', 'storage'] as const).map((d) => (
                                <button
                                  key={d}
                                  type="button"
                                  onClick={() => setDestinations((prev) => ({ ...prev, [item.id]: d }))}
                                  className={`min-h-[32px] px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                                    (destinations[item.id] || 'store') === d
                                      ? 'bg-teal-600 text-white border-teal-600'
                                      : 'bg-white text-teal-700 border-teal-200'
                                  }`}
                                >
                                  {d === 'store' ? 'Store' : 'Storage'}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col items-center gap-1 flex-shrink-0">
                          <input
                            type="text"
                            inputMode="decimal"
                            className={`w-20 text-center text-2xl font-bold border-2 rounded-xl py-2 px-1 focus:outline-none transition-colors ${
                              isShort ? 'border-red-400 bg-red-50 text-red-700' :
                              isFull ? 'border-[#1a7a3c] bg-green-50' :
                              received[item.id] && parseFloat(received[item.id]) > 0 ? 'border-blue-300 bg-blue-50' :
                              'border-gray-200 bg-slate-50 focus:border-[#1a7a3c]'
                            }`}
                            value={received[item.id] ?? ''}
                            onChange={(e) => handleChange(item.id, e.target.value)}
                            onFocus={(e) => e.target.select()}
                            placeholder="0"
                          />
                          {/* Patch 55/56: this field is boxes/cases for any
                              pack_size item -- label it plainly and show
                              the real-stock-unit conversion before saving,
                              so there's never a question of which unit was
                              typed. */}
                          {isBoxItem && (
                            <span className="text-xs text-gray-400 font-medium">{unitLabel(getOrderUnitLabel(item), receivedVal)}</span>
                          )}
                          {isBoxItem && receivedVal > 0 && (
                            <span className="text-xs text-gray-500 font-semibold">
                              = {Math.round(receivedVal * (item.pack_size as number) * 100) / 100} {unitLabel(item.unit, Math.round(receivedVal * (item.pack_size as number) * 100) / 100)}
                            </span>
                          )}
                          {isShort && <span className="text-xs text-red-600 font-bold">SHORT</span>}
                          {isFull && <span className="text-xs text-[#1a7a3c] font-bold">✓</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>
                )}
              </section>
            )
          })}
        </div>

        <div ref={submitRef} className="mt-8 pb-8">
          <button
            onClick={handleContinue}
            disabled={saving}
            className="w-full py-5 rounded-2xl text-xl font-bold bg-[#1a7a3c] hover:bg-[#155f2f] text-white shadow-md transition-colors"
          >
            {saving ? 'Saving…' : `Review & Save${totalEntered > 0 ? ` (${totalEntered} items)` : ''}`}
          </button>
        </div>
      </main>

      {showMistakeModal && (
        <MistakeGuardModal items={mistakeItems} onConfirm={confirmMistakeAndContinue} onCancel={cancelMistakeModal} />
      )}
      {showWillCallSummary && (
        <WillCallSummaryModal rows={willCallRows} onConfirm={confirmWillCallAndContinue} onCancel={cancelWillCallSummary} />
      )}

      <ScrollToSaveButton targetRef={submitRef} show={step === 'enter'} retryKey={step} />
      {/* Patch 34: back-to-top stacks above the scroll-to-save button so
          neither one covers the other. */}
      <BackToTop bottomOffsetPx={96} />
    </div>
  )
}
