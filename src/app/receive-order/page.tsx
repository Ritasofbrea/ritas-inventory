'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Navigation from '@/components/Navigation'
import { getRole } from '@/lib/auth'
import { Item, CATEGORIES } from '@/lib/types'

interface OrderRecord {
  id: string
  type: string
  created_at: string
  order_history_items: { item_id: string; item_name: string; quantity: number; unit: string }[]
}

interface ReceivedQty { [itemId: string]: string }
interface ShortItem { item_id: string; item_name: string; unit: string; ordered: number; received: number; short: number; acknowledged: boolean }

type Step = 'select' | 'enter' | 'shorts' | 'done'

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
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
  const [notes, setNotes] = useState('')
  const [shorts, setShorts] = useState<ShortItem[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submitRef = useRef<HTMLDivElement>(null)
  const [showScrollBtn, setShowScrollBtn] = useState(false)

  useEffect(() => {
    const el = submitRef.current
    if (!el) return
    const obs = new IntersectionObserver(([e]) => setShowScrollBtn(!e.isIntersecting), { threshold: 0.1 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [step])

  const scrollToSave = useCallback(() => {
    submitRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [])

  useEffect(() => {
    const role = getRole()
    if (!role) { router.replace('/login'); return }
    Promise.all([fetchItems(), fetchRecentOrders()]).finally(() => setLoading(false))
  }, [router])

  const fetchItems = async () => {
    const res = await fetch('/api/items')
    setItems(await res.json())
  }

  const fetchRecentOrders = async () => {
    const res = await fetch('/api/order-history?type=ordered')
    const data = await res.json()
    setRecentOrders(Array.isArray(data) ? data.slice(0, 6) : [])
  }

  const handleChange = (id: string, val: string) => {
    if (val === '' || /^\d*\.?\d*$/.test(val)) {
      setReceived((prev) => ({ ...prev, [id]: val }))
    }
  }

  const handleContinue = () => {
    setError('')
    const entered = Object.entries(received).filter(([, v]) => v !== '' && parseFloat(v) > 0)
    if (entered.length === 0) { setError('Enter at least one quantity before continuing.'); return }

    if (!selectedOrder) { proceedToSave([]); return }

    // Detect shorts against the selected order
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
          return { item_id, item_name: item.name, quantity: parseFloat(qty), unit: item.unit }
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

  const itemsByCategory = CATEGORIES.reduce<Record<string, Item[]>>((acc, cat) => {
    acc[cat] = items.filter((i) => i.category === cat)
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
              <input type="radio" name="order" checked={selectedOrder === null} onChange={() => setSelectedOrder(null)} className="accent-blue-600" />
              <div>
                <p className="font-semibold text-gray-900">No specific order / Standalone</p>
                <p className="text-xs text-gray-400">Just receiving stock — no short tracking</p>
              </div>
            </label>
            {recentOrders.length === 0 ? (
              <div className="px-5 py-4 text-sm text-gray-400">No recent orders found. Use "Mark as Ordered" on the Order List first.</div>
            ) : (
              recentOrders.map((order) => (
                <label key={order.id} className={`flex items-center gap-3 px-5 py-4 cursor-pointer border-b border-gray-100 last:border-0 transition-colors ${selectedOrder?.id === order.id ? 'bg-green-50' : 'hover:bg-gray-50'}`}>
                  <input type="radio" name="order" checked={selectedOrder?.id === order.id} onChange={() => setSelectedOrder(order)} className="accent-[#1a7a3c]" />
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

        <div className="flex flex-col gap-6">
          {CATEGORIES.map((category) => {
            const catItems = itemsByCategory[category] || []
            if (catItems.length === 0) return null
            return (
              <section key={category}>
                <h2 className="text-xs font-bold uppercase tracking-widest text-blue-500 mb-3">{category}</h2>
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                  {catItems.map((item, idx) => {
                    const isOnOrder = orderedItemIds.has(item.id)
                    const orderedQty = orderedQtyMap[item.id]
                    const receivedVal = parseFloat(received[item.id] || '0') || 0
                    const isShort = isOnOrder && received[item.id] !== undefined && received[item.id] !== '' && receivedVal < Number(orderedQty)
                    const isFull = isOnOrder && received[item.id] !== undefined && received[item.id] !== '' && receivedVal >= Number(orderedQty)

                    return (
                      <div
                        key={item.id}
                        className={`flex items-center gap-4 px-5 py-4 ${idx < catItems.length - 1 ? 'border-b border-gray-100' : ''} ${isOnOrder ? 'bg-green-50/40' : ''}`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-semibold text-gray-900 text-base leading-tight">{item.name}</p>
                            {isOnOrder && <span className="text-xs bg-[#1a7a3c] text-white px-1.5 py-0.5 rounded font-medium">On Order</span>}
                          </div>
                          <p className="text-sm text-gray-400">
                            {item.unit} · on hand: {item.current_count}
                            {isOnOrder && <span className="text-[#1a7a3c] font-semibold"> · ordered: {orderedQty}</span>}
                          </p>
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
                            placeholder="0"
                          />
                          {isShort && <span className="text-xs text-red-600 font-bold">SHORT</span>}
                          {isFull && <span className="text-xs text-[#1a7a3c] font-bold">✓</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>
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

      {showScrollBtn && step === 'enter' && (
        <button
          onClick={scrollToSave}
          className="fixed bottom-6 right-5 z-40 bg-[#1a7a3c] hover:bg-[#155f2f] active:bg-[#0f4a25] text-white w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-colors"
          aria-label="Scroll to save"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      )}
    </div>
  )
}
