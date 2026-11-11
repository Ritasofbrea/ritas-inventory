'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Navigation from '@/components/Navigation'
import BackToTop from '@/components/BackToTop'
import { getRole } from '@/lib/auth'
import { Item, getStockStatus } from '@/lib/types'
import { unitLabel } from '@/lib/units'
import { getOrderUnitLabel, getDefaultOrderQty, packSizePreview, usesBoxOrdering, getPackWord, formatUnitsWithBoxes } from '@/lib/order-units'
import { isOpenStatus, urgencyRank, orderDayLabel, formatTimeOfDay, vendorKeyForItem, vendorDisplayLabel, VendorDueStatus } from '@/lib/vendor-schedule'
import { PROGRAM_LABELS, PROGRAM_BADGE_ICON, PROGRAM_BADGE_CLASS } from '@/lib/flavors'

type DistributorItem = Item & { distributor?: string; item_number?: string; distributor_item_name?: string }

interface OrderHistoryItem {
  item_id: string
  item_name: string
  quantity: number
  unit: string
}

interface OrderRecord {
  id: string
  type: 'ordered' | 'received' | 'will_call' | 'short'
  notes: string
  created_at: string
  related_order_id: string | null
  received_by: string | null
  resolved_at: string | null
  resolved_by: string | null
  note_review_needed?: boolean
  // Split orders by vendor: set on new 'ordered' rows only; null on every
  // older order and on all receipt rows.
  vendor?: string | null
  order_history_items: OrderHistoryItem[]
}

// Patch 44: schedule + computed due-status for a vendor, exactly as GET
// /api/vendor-schedules returns it (computeVendorDueInfo's output merged
// with the raw schedule row and an itemCount). Only vendors with a
// vendor_schedules row appear here — today that's just Balford/Bunzl; any
// other distributor bucket has no entry and is always "anytime" by absence.
type WeekStatusRecord = { status: 'ordered' | 'skipped'; resolved_by: string | null; resolved_at: string }
interface VendorInfo {
  vendor: string
  order_day: number | null
  cutoff_time: string
  status: VendorDueStatus
  resolvedThisWeek: WeekStatusRecord | null
  justResolved: WeekStatusRecord | null
  itemCount: number
}

const DISTRIBUTOR_ORDER = ['bunzl', 'balford', 'other', 'seasonal', 'discontinued']
const DISTRIBUTOR_LABELS: Record<string, string> = { bunzl: 'Bunzl', balford: 'Balford', other: 'Other', seasonal: 'Seasonal', discontinued: 'Discontinued' }
const DISTRIBUTOR_COLORS: Record<string, string> = { bunzl: 'text-blue-600', balford: 'text-purple-600', other: 'text-gray-500', seasonal: 'text-green-600', discontinued: 'text-gray-400' }

const TYPE_LABELS: Record<string, string> = { ordered: 'Order Placed', received: 'Delivery Received', will_call: 'Will Call Received', short: 'Short Shipment' }
const TYPE_COLORS: Record<string, string> = { ordered: 'bg-blue-100 text-blue-700', received: 'bg-green-100 text-green-700', will_call: 'bg-purple-100 text-purple-700', short: 'bg-red-100 text-red-700' }

// Gray outlined style for the new due-date tags — per the patch's own rule,
// never reuse an existing color's established meaning (amber/orange =
// overdue, hot pink = Action Needed, etc.).
const DUE_TAG_LABEL: Record<string, string> = { due_today: 'Due today', due_tomorrow: 'Due tomorrow', overdue: 'Cutoff passed' }

export default function OrderListPage() {
  const router = useRouter()
  const [items, setItems] = useState<DistributorItem[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'today' | 'history'>('today')
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  // Mark as ordered
  const [marking, setMarking] = useState(false)
  const [marked, setMarked] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [orderQuantities, setOrderQuantities] = useState<Record<string, string>>({})

  // On-order tracking
  const [onOrderItemIds, setOnOrderItemIds] = useState<Set<string>>(new Set())
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null)
  const [pendingOrders, setPendingOrders] = useState<OrderRecord[]>([])

  // Order history tab
  const [orderHistory, setOrderHistory] = useState<OrderRecord[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set())
  const [reviewingNoteId, setReviewingNoteId] = useState<string | null>(null)

  // Patch 44: vendor schedules/status, "about N weeks left", per-vendor
  // Order Placed/Nothing-to-order actions, and the "Not due yet" collapse.
  const [vendorInfos, setVendorInfos] = useState<VendorInfo[]>([])
  const [weeksLeft, setWeeksLeft] = useState<Record<string, { value: number; capped: boolean }>>({})
  const [vendorActionWorking, setVendorActionWorking] = useState<string | null>(null)
  const [notDueOpen, setNotDueOpen] = useState(false)

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch('/api/items')
      const data: DistributorItem[] = await res.json()
      setItems(data)
      setLastUpdated(new Date())
      return data
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchPendingOrders = useCallback(async () => {
    const res = await fetch('/api/order-history')
    if (!res.ok) return { onOrderIds: new Set<string>() }
    const all: OrderRecord[] = await res.json()

    const fulfilledOrderIds = new Set(
      all
        .filter((r) => r.type === 'received' || r.type === 'will_call')
        .map((r) => r.related_order_id)
        .filter(Boolean) as string[]
    )

    const pending = all.filter((r) => r.type === 'ordered' && !fulfilledOrderIds.has(r.id))

    const itemIds = new Set<string>()
    for (const order of pending) {
      for (const item of order.order_history_items) {
        if (item.item_id) itemIds.add(item.item_id)
      }
    }

    setOnOrderItemIds(itemIds)
    setPendingOrders(pending)
    return { onOrderIds: itemIds }
  }, [])

  const fetchVendorInfos = useCallback(async () => {
    const res = await fetch('/api/vendor-schedules')
    if (!res.ok) return
    setVendorInfos(await res.json())
  }, [])

  // Secondary, non-blocking info line — never awaited by loadAll, so a slow
  // or failed fetch here never delays the main list from showing.
  const fetchWeeksLeft = useCallback(async (ids: string[]) => {
    if (ids.length === 0) { setWeeksLeft({}); return }
    try {
      const res = await fetch(`/api/reports/weeks-left?ids=${ids.join(',')}`)
      if (!res.ok) return
      const rows: { item_id: string; weeks_left: number | null; capped: boolean }[] = await res.json()
      const map: Record<string, { value: number; capped: boolean }> = {}
      for (const r of rows) if (r.weeks_left != null) map[r.item_id] = { value: r.weeks_left, capped: r.capped }
      setWeeksLeft(map)
    } catch {
      // best-effort — the line is just omitted if this fails
    }
  }, [])

  const loadAll = useCallback(async () => {
    const [data, { onOrderIds }] = await Promise.all([fetchItems(), fetchPendingOrders(), fetchVendorInfos()])
    if (data) {
      const needsOrder = data.filter((i) => !i.is_off && getStockStatus(i) !== 'ok')
      const toOrderIds = needsOrder.filter((i) => !onOrderIds.has(i.id)).map((i) => i.id)
      setSelectedIds(new Set(toOrderIds))
      fetchWeeksLeft(needsOrder.map((i) => i.id))
    }
  }, [fetchItems, fetchPendingOrders, fetchVendorInfos, fetchWeeksLeft])

  useEffect(() => {
    const role = getRole()
    if (!role) { router.replace('/login'); return }
    if (role !== 'owner') { router.replace('/count'); return }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: fetches on mount, this app's standard load-on-mount pattern
    loadAll()
  }, [router, loadAll])

  const fetchHistory = async () => {
    if (orderHistory.length > 0) return
    setHistoryLoading(true)
    try {
      const res = await fetch('/api/order-history')
      setOrderHistory(await res.json())
    } finally {
      setHistoryLoading(false)
    }
  }

  const handleViewChange = (v: 'today' | 'history') => {
    setView(v)
    if (v === 'history') fetchHistory()
  }

  // Select all / Unselect all: checks or unchecks exactly the given Order
  // List items (the whole list, or one vendor's bucket -- including ones
  // inside the collapsed "Not due yet" section, since callers pass the full
  // item lists, not what's rendered). Never adds an id that isn't passed in.
  const setItemsSelected = (ids: string[], select: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        if (select) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }

  const toggleItem = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const getQtyValue = (item: DistributorItem) => orderQuantities[item.id] ?? String(getDefaultOrderQty(item))

  const handleQtyChange = (id: string, value: string) => {
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      setOrderQuantities((prev) => ({ ...prev, [id]: value }))
    }
  }

  const clearQuantitiesFor = (ids: string[]) => {
    setOrderQuantities((prev) => {
      const next = { ...prev }
      for (const id of ids) delete next[id]
      return next
    })
  }

  // Marks any scheduled vendor represented in `orderedItems` as "ordered"
  // for its current week, so a reminder never keeps nagging about
  // something just ordered through the global button. Silent — no extra
  // confirmation beyond the order save itself.
  // Fix (live testing): the in-app banner (Navigation.tsx) fetches vendor
  // status on its own, independent of this page, and only ever refreshed
  // on navigation — pressing a button here never changed the banner until
  // the user left and came back. Mirrors the existing 'tasks-changed'
  // pattern (Navigation's To-Do badge) exactly: fire a DOM event, listen
  // for it in Navigation.
  const broadcastVendorStatusChanged = () => {
    window.dispatchEvent(new Event('vendor-status-changed'))
  }

  // Fix: always marks every touched vendor 'ordered' for the week,
  // regardless of its current mark — switching an existing "Nothing to
  // order" to "Order placed" is exactly what pressing Order Placed (here,
  // globally, for items spanning that vendor) is supposed to do. The old
  // `!v.resolvedThisWeek` filter skipped already-resolved vendors, which
  // meant a global order placed after a vendor had been marked skipped
  // never updated that mark.
  const silenceVendorsForItems = async (orderedItems: DistributorItem[]) => {
    const touched = new Set(orderedItems.map((i) => vendorKeyForItem(i.distributor)))
    const toSilence = vendorInfos.filter((v) => touched.has(v.vendor))
    await Promise.all(
      toSilence.map((v) =>
        fetch('/api/vendor-week-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vendor: v.vendor, status: 'ordered' }),
        })
      )
    )
  }

  // One order line per item, in the shape POST /api/order-history expects.
  // Shared by the general and per-vendor Order Placed buttons.
  const toOrderLines = (orderItems: DistributorItem[]) =>
    orderItems.map((item) => ({
      item_id: item.id,
      item_name: item.name,
      quantity: parseFloat(orderQuantities[item.id] ?? '') || getDefaultOrderQty(item),
      // Patch 44 bug fix (new orders only — existing history rows are
      // never rewritten): this used to always save `item.unit` (the
      // STOCK unit) even when the quantity above is in CASES, so History
      // could show "2 gallons" for an order that was actually 2 cases (8
      // gallons). Now saves the real order-unit word the quantity is in.
      unit: getOrderUnitLabel(item),
    }))

  // Split orders by vendor: the general button groups the checked items by
  // vendorKeyForItem (no distributor -> 'other') and saves ONE order per
  // vendor, so every order belongs to exactly one vendor and can later be
  // matched against that vendor's invoice. Saved one vendor at a time; if
  // one vendor's save fails, the ones that did save stay saved (they drop
  // off the checked list on reload, since they're now on order), the
  // failed vendor's items stay checked with their quantities, and an alert
  // says which vendor didn't save, so pressing again never re-orders the
  // vendors that already went through.
  const handleMarkOrdered = async () => {
    if (selectedIds.size === 0) return
    setMarking(true)
    try {
      const checkedItems = toOrder.filter((item) => selectedIds.has(item.id))
      const byVendor = new Map<string, DistributorItem[]>()
      for (const item of checkedItems) {
        const vendor = vendorKeyForItem(item.distributor)
        const group = byVendor.get(vendor)
        if (group) group.push(item)
        else byVendor.set(vendor, [item])
      }

      const savedItems: DistributorItem[] = []
      const failedVendors: string[] = []
      for (const [vendor, vendorItems] of byVendor) {
        const res = await fetch('/api/order-history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'ordered', vendor, items: toOrderLines(vendorItems) }),
        })
        if (res.ok) savedItems.push(...vendorItems)
        else failedVendors.push(vendor)
      }

      if (savedItems.length > 0) {
        await silenceVendorsForItems(savedItems)
        clearQuantitiesFor(savedItems.map((i) => i.id))
        setOrderHistory([])
        await loadAll()
        broadcastVendorStatusChanged()
      }
      if (failedVendors.length === 0) {
        setMarked(true)
        setTimeout(() => setMarked(false), 3000)
      } else {
        const failedNames = failedVendors.map(vendorDisplayLabel).join(', ')
        window.alert(
          savedItems.length > 0
            ? `The ${failedNames} order did not save. The other vendors' orders did save. Press the button again to retry ${failedNames}.`
            : `The order did not save. Please try again.`
        )
      }
    } finally {
      setMarking(false)
    }
  }

  // Per-vendor "Order Placed": same save as the global button, scoped to
  // just this vendor's currently-checked items, then silences this
  // vendor's reminder for the week. If nothing is checked for this vendor
  // right now, it still silences the week (the owner may have already
  // ordered by phone/in person without using the checkboxes here).
  const handleMarkOrderedForVendor = async (vendor: string) => {
    const vendorItems = toOrder.filter((item) => vendorKeyForItem(item.distributor) === vendor && validSelected.has(item.id))
    setVendorActionWorking(vendor)
    try {
      if (vendorItems.length > 0) {
        const res = await fetch('/api/order-history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'ordered', vendor, items: toOrderLines(vendorItems) }),
        })
        if (!res.ok) return
        clearQuantitiesFor(vendorItems.map((i) => i.id))
        setOrderHistory([])
      }
      await fetch('/api/vendor-week-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendor, status: 'ordered' }),
      })
      await loadAll()
      broadcastVendorStatusChanged()
    } finally {
      setVendorActionWorking(null)
    }
  }

  const handleSkipVendorWeek = async (vendor: string) => {
    setVendorActionWorking(vendor)
    try {
      await fetch('/api/vendor-week-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendor, status: 'skipped' }),
      })
      await fetchVendorInfos()
      broadcastVendorStatusChanged()
    } finally {
      setVendorActionWorking(null)
    }
  }

  // "Undo": clears the mark entirely (server deletes the vendor_week_status
  // row), bringing back the normal pending state — buttons and the real
  // due-tag, exactly as if nothing had been pressed yet this week. The
  // press itself is still recorded in vendor_week_status_log server-side.
  const handleUndoVendorWeek = async (vendor: string) => {
    setVendorActionWorking(vendor)
    try {
      await fetch('/api/vendor-week-status', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendor }),
      })
      await fetchVendorInfos()
      broadcastVendorStatusChanged()
    } finally {
      setVendorActionWorking(null)
    }
  }

  const cancelOrder = async (orderId: string) => {
    setCancellingOrderId(orderId)
    await fetch('/api/order-history', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: orderId }) })
    setOrderHistory([])
    await loadAll()
    setCancellingOrderId(null)
  }

  const markNoteReviewed = async (id: string) => {
    setReviewingNoteId(id)
    try {
      await fetch('/api/order-history', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, mark_note_reviewed: true }) })
      setOrderHistory((prev) => prev.map((o) => (o.id === id ? { ...o, note_review_needed: false } : o)))
    } finally {
      setReviewingNoteId(null)
    }
  }

  const toggleOrder = (id: string) => {
    setExpandedOrders((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  const formatShort = (d: string) =>
    new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen"><p className="text-gray-400 text-lg">Loading…</p></div>
  }

  // Patch 37: off items are excluded from the data pipeline here (not just
  // styled away) so they can't surface in toOrder or onOrder below either.
  const needsOrder = items.filter((i) => !i.is_off && getStockStatus(i) !== 'ok')

  // Split: items on order (ordered, not yet received) vs still needs ordering
  const onOrderItems = needsOrder.filter((i) => onOrderItemIds.has(i.id))
  const toOrder = needsOrder.filter((i) => !onOrderItemIds.has(i.id))
  const outItems = toOrder.filter((i) => getStockStatus(i) === 'out')
  const lowItems = toOrder.filter((i) => getStockStatus(i) === 'low')

  // Auto-sync selectedIds to only include toOrder items
  const validSelected = new Set([...selectedIds].filter((id) => toOrder.some((i) => i.id === id)))

  const sorted = [...toOrder].sort((a, b) => {
    if (a.supplier_order == null && b.supplier_order == null) return 0
    if (a.supplier_order == null) return 1
    if (b.supplier_order == null) return -1
    return a.supplier_order - b.supplier_order
  })

  // Patch 46 fix: a single pass, one key per item (vendorKeyForItem — a
  // literal 'other' distributor and no distributor at all both become
  // 'other'), so every item lands in exactly ONE bucket. This used to be
  // two separate filters with overlapping predicates (`i.distributor ??
  // 'other'` for the 'other' bucket, plus a separate `unmapped` list for
  // `!i.distributor`) — a null-distributor item matched both, so it
  // appeared twice, under two different sections that were each labeled
  // "Other".
  const byDistributor = DISTRIBUTOR_ORDER.reduce<Record<string, DistributorItem[]>>((acc, d) => {
    acc[d] = sorted.filter((i) => vendorKeyForItem(i.distributor) === d)
    return acc
  }, {})

  const vendorInfoByName = new Map(vendorInfos.map((v) => [v.vendor, v]))

  // Patch 44: one "bucket" per DISTRIBUTOR_ORDER entry — the 5 groups the
  // Order List has always shown (no distributor and a literal 'other'
  // distributor now share the one 'other' bucket/section, fixed in patch
  // 46). A bucket with no vendor_schedules row (today: everything except
  // bunzl/balford) has no vendorInfo and is always "open" with no due tag,
  // unchanged from before.
  interface Bucket { key: string; label: string; colorClass: string; distItems: DistributorItem[]; vendorInfo: VendorInfo | undefined }
  const allBuckets: Bucket[] = DISTRIBUTOR_ORDER.map((d) => ({
    key: d,
    label: DISTRIBUTOR_LABELS[d],
    colorClass: DISTRIBUTOR_COLORS[d],
    distItems: byDistributor[d] ?? [],
    vendorInfo: vendorInfoByName.get(d),
  })).filter((b) => b.distItems.length > 0)

  const openBuckets = allBuckets
    .filter((b) => !b.vendorInfo || isOpenStatus(b.vendorInfo.status))
    .sort((a, b) => urgencyRank(a.vendorInfo?.status ?? 'anytime') - urgencyRank(b.vendorInfo?.status ?? 'anytime'))
  const collapsedBuckets = allBuckets.filter((b) => b.vendorInfo && !isOpenStatus(b.vendorInfo.status))

  const renderItemRow = (item: DistributorItem, idx: number, arr: DistributorItem[]) => {
    const status = getStockStatus(item)
    const checked = validSelected.has(item.id)
    const isBoxItem = usesBoxOrdering(item)
    const preview = checked ? packSizePreview(item.unit, item.pack_size, getPackWord(item)) : null
    const weeks = weeksLeft[item.id]
    return (
      <div
        key={item.id}
        onClick={() => toggleItem(item.id)}
        className={`flex items-center gap-3 px-5 py-4 cursor-pointer transition-colors ${idx < arr.length - 1 ? 'border-b border-gray-100' : ''} ${checked ? '' : 'opacity-50 bg-gray-50'}`}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={() => toggleItem(item.id)}
          onClick={(e) => e.stopPropagation()}
          className="w-5 h-5 flex-shrink-0 accent-[#1a7a3c] cursor-pointer"
        />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 flex items-center gap-1.5 flex-wrap">
            {item.name}
            {/* Patch 45: flavor program badge -- label only, same shared badge
                as the Flavor Catalog/weekly planner. flex-wrap above keeps
                this from crowding any other badge on a phone (Order List
                itself never shows OFF/STORAGE on this row today). */}
            {item.category === 'Ice Mix' && item.flavor?.program && (
              <span className={PROGRAM_BADGE_CLASS}>
                <span>{PROGRAM_BADGE_ICON[item.flavor.program]}</span>
                {PROGRAM_LABELS[item.flavor.program]}
              </span>
            )}
          </p>
          <p className="text-sm text-gray-400">
            {item.item_number && <span className="font-mono text-gray-500 mr-2">#{item.item_number}</span>}
            {item.distributor_item_name ?? item.category}
          </p>
          {checked && (
            <div className="flex items-center gap-1.5 mt-1.5" onClick={(e) => e.stopPropagation()}>
              <span className="text-xs text-gray-400">Order qty:</span>
              <input
                type="text"
                inputMode="decimal"
                value={getQtyValue(item)}
                onChange={(e) => handleQtyChange(item.id, e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onFocus={(e) => e.target.select()}
                className="w-16 text-sm text-center border border-gray-200 rounded-lg py-0.5 px-1 focus:outline-none focus:border-[#1a7a3c]"
              />
              <span className="text-xs text-gray-400">{unitLabel(getOrderUnitLabel(item), parseFloat(getQtyValue(item)) || 0)}</span>
            </div>
          )}
          {preview && <p className="text-xs text-gray-400 mt-1">{preview}</p>}
          {weeks != null && (
            <p className="text-xs text-gray-400 mt-0.5">
              {weeks.capped ? `${weeks.value}+ weeks left` : `~${weeks.value} week${weeks.value !== 1 ? 's' : ''} left`}
            </p>
          )}
        </div>
        {isBoxItem ? (
          // Patch 55/56: any item with a pack_size shows the box/case +
          // stock-unit breakdown and the suggested box/case order up
          // front, so deciding what to order never needs math -- Ice Mix's
          // current_count is the whole gallon total (secondary_unit was
          // cleared in the patch 55 SQL), and Sugar Free/Syrups/other
          // pack_size items have no sub-unit portion of their own either,
          // so current_count is always the full stock-unit total here.
          <div className="text-right flex-shrink-0 mr-2">
            <p className="text-sm text-gray-500">
              Have: <span className="font-bold text-gray-900">{formatUnitsWithBoxes(item.current_count, item.pack_size as number, item.unit, getOrderUnitLabel(item))}</span>
            </p>
            <p className="text-sm text-gray-400">Par: {formatUnitsWithBoxes(item.par_level, item.pack_size as number, item.unit, getOrderUnitLabel(item))}</p>
            <p className="text-sm font-semibold text-[#1a7a3c]">
              Order: {getDefaultOrderQty(item)} {unitLabel(getOrderUnitLabel(item), getDefaultOrderQty(item))}
            </p>
          </div>
        ) : (
          <div className="text-right flex-shrink-0 mr-2">
            <p className="text-sm text-gray-500">
              Have <span className="font-bold text-gray-900">{item.current_count}</span>
              {', want '}
              <span className="text-gray-400">{item.par_level} {unitLabel(item.unit, item.par_level)}</span>
            </p>
          </div>
        )}
        <span className={`flex-shrink-0 text-xs font-bold px-2.5 py-1 rounded-lg ${status === 'out' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
          {status === 'out' ? 'OUT' : 'LOW'}
        </span>
      </div>
    )
  }

  // Shared "Select all" / "Unselect all" button: "Unselect all" only when
  // every one of `list` is already checked.
  const renderSelectAllButton = (list: DistributorItem[]) => {
    const allChecked = list.length > 0 && list.every((i) => validSelected.has(i.id))
    return (
      <button
        type="button"
        onClick={() => setItemsSelected(list.map((i) => i.id), !allChecked)}
        disabled={marking}
        className="min-h-[48px] px-4 text-sm font-semibold text-gray-700 bg-white border border-gray-300 rounded-xl active:bg-gray-100 disabled:opacity-50"
      >
        {allChecked ? 'Unselect all' : 'Select all'}
      </button>
    )
  }

  const renderBucket = (bucket: Bucket) => {
    const { key, label, colorClass, distItems, vendorInfo } = bucket
    const tag = vendorInfo ? DUE_TAG_LABEL[vendorInfo.status] : undefined
    const dayLabel = vendorInfo ? orderDayLabel(vendorInfo.order_day) : null
    const confirmation = vendorInfo?.resolvedThisWeek ?? vendorInfo?.justResolved ?? null
    // Fix: both buttons always show whenever there's a vendor to act on —
    // not just before a mark exists. Pressing the other one from whichever
    // is currently marked SWITCHES it (the server already overwrites
    // status/resolved_by/resolved_at regardless of what it was); "Undo"
    // (shown only once something is actually marked for this exact week)
    // clears the mark entirely via a server delete, bringing back the
    // plain pending state. See order-history still keeps every item
    // actually ordered either way — this only ever touches the week's
    // ordered/skipped/undone MARK, never that record.
    const working = vendorActionWorking === key
    return (
      <section key={key} className="mb-6">
        <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
          <div className="flex items-center gap-2">
            <h2 className={`text-xs font-bold uppercase tracking-widest ${colorClass}`}>{label}</h2>
            {tag && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-gray-300 text-gray-500 uppercase tracking-wide">
                {tag}
              </span>
            )}
          </div>
          {!!vendorInfo && (
            <div className="flex gap-2">
              <button
                onClick={() => handleMarkOrderedForVendor(key)}
                disabled={working}
                className={`text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50 ${
                  vendorInfo.resolvedThisWeek?.status === 'ordered'
                    ? 'text-white bg-[#1a7a3c] ring-2 ring-offset-1 ring-[#1a7a3c]'
                    : 'text-white bg-[#1a7a3c] hover:bg-[#155f2f]'
                }`}
              >
                {working ? 'Saving…' : 'Order Placed'}
              </button>
              <button
                onClick={() => handleSkipVendorWeek(key)}
                disabled={working}
                className={`text-xs font-semibold px-3 py-1.5 rounded-lg border disabled:opacity-50 ${
                  vendorInfo.resolvedThisWeek?.status === 'skipped'
                    ? 'text-gray-700 bg-gray-100 border-gray-400'
                    : 'text-gray-600 border-gray-300 hover:bg-gray-50'
                }`}
              >
                Nothing to order
              </button>
              {vendorInfo.resolvedThisWeek && (
                <button
                  onClick={() => handleUndoVendorWeek(key)}
                  disabled={working}
                  className="text-xs font-semibold text-gray-400 hover:text-gray-600 px-2 py-1.5 rounded-lg disabled:opacity-50"
                >
                  Undo checkmark
                </button>
              )}
            </div>
          )}
        </div>
        {dayLabel && (
          <p className="text-xs text-gray-400 mb-2">
            Due {dayLabel} by {formatTimeOfDay(vendorInfo!.cutoff_time)}
          </p>
        )}
        {confirmation && (
          <p className="text-xs text-green-600 mb-2">
            ✓ {confirmation.status === 'ordered' ? 'Order placed' : 'Nothing to order'} this week
            {confirmation.resolved_by ? ` · ${confirmation.resolved_by}` : ''}
          </p>
        )}
        {/* "Undo checkmark" only clears this week's mark (vendor_week_status);
            it never touches the saved order. Cancel Order in the On Order
            section deletes the order itself -- say so, since one Order
            Placed press creates both. */}
        {vendorInfo?.resolvedThisWeek?.status === 'ordered' && (
          <p className="text-xs text-gray-400 mb-2">
            Undo checkmark only clears this week&apos;s mark. To cancel the order itself, use Cancel Order in On Order below.
          </p>
        )}
        <div className="flex justify-end mb-2">
          {renderSelectAllButton(distItems)}
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          {distItems.map((item, idx) => renderItemRow(item, idx, distItems))}
        </div>
      </section>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#d4edda]">
      <Navigation />

      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-6">
        <div className="mb-6 flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Order List</h1>
            {lastUpdated && (
              <p className="text-gray-400 text-sm mt-0.5">
                Updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={loadAll} className="text-sm text-blue-600 hover:text-blue-800 border border-blue-200 hover:border-blue-400 px-3 py-1.5 rounded-lg">
              Refresh
            </button>
            <button
              onClick={() => router.push('/receive-order')}
              className="text-sm bg-[#1a7a3c] hover:bg-[#155f2f] text-white font-semibold px-3 py-1.5 rounded-lg"
            >
              + Receive Order
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 bg-gray-100 p-1 rounded-xl w-fit">
          <button
            onClick={() => handleViewChange('today')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${view === 'today' ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}
          >
            Today&apos;s Order
          </button>
          <button
            onClick={() => handleViewChange('history')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${view === 'history' ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}
          >
            Order History
          </button>
        </div>

        {view === 'today' ? (
          <>
            {needsOrder.length === 0 ? (
              <div className="bg-green-50 border border-green-200 rounded-2xl px-5 py-8 text-center">
                <p className="text-4xl mb-3">✅</p>
                <p className="text-green-800 font-bold text-xl">Everything is stocked!</p>
                <p className="text-green-600 text-sm mt-1">Nothing needs to be ordered right now.</p>
              </div>
            ) : (
              <>
                {/* Needs ordering section */}
                {toOrder.length > 0 && (
                  <>
                    <div className="bg-red-50 border border-red-200 rounded-2xl px-5 py-4 mb-6 flex items-center justify-between gap-4">
                      <div>
                        <p className="text-red-800 font-bold text-lg">{toOrder.length} item{toOrder.length !== 1 ? 's' : ''} to order</p>
                        <p className="text-red-600 text-sm mt-0.5">
                          {outItems.length} out of stock · {lowItems.length} running low
                          {validSelected.size < toOrder.length && validSelected.size > 0 && (
                            <span className="ml-1 font-semibold">· {validSelected.size} selected</span>
                          )}
                        </p>
                      </div>
                      <button
                        onClick={handleMarkOrdered}
                        disabled={marking || marked || validSelected.size === 0}
                        className={`flex-shrink-0 font-semibold px-4 py-2.5 rounded-xl text-sm transition-colors ${
                          marked ? 'bg-green-500 text-white' : marking || validSelected.size === 0 ? 'bg-gray-200 text-gray-400' : 'bg-[#1a7a3c] hover:bg-[#155f2f] text-white'
                        }`}
                      >
                        {marked ? '✓ Order Saved' : marking ? 'Saving…' : validSelected.size < toOrder.length && validSelected.size > 0 ? `Order ${validSelected.size} Item${validSelected.size !== 1 ? 's' : ''}` : 'Mark as Ordered'}
                      </button>
                    </div>

                    {/* Whole list, every vendor, including the collapsed
                        "Not due yet" section (toOrder, not what's showing). */}
                    <div className="flex justify-end mb-6 -mt-3">
                      {renderSelectAllButton(toOrder)}
                    </div>

                    {openBuckets.map(renderBucket)}

                    {collapsedBuckets.length > 0 && (
                      <section className="mb-6">
                        <button
                          onClick={() => setNotDueOpen((o) => !o)}
                          className="w-full flex items-center justify-between bg-white rounded-2xl shadow-sm border border-gray-100 px-5 py-3 text-left"
                        >
                          <span className="text-sm font-semibold text-gray-500">
                            Not due yet ({collapsedBuckets.length} vendor{collapsedBuckets.length !== 1 ? 's' : ''})
                          </span>
                          <svg className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${notDueOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        {notDueOpen && <div className="mt-4">{collapsedBuckets.map(renderBucket)}</div>}
                      </section>
                    )}
                  </>
                )}

                {toOrder.length === 0 && onOrderItems.length > 0 && (
                  <div className="bg-blue-50 border border-blue-200 rounded-2xl px-5 py-4 mb-6">
                    <p className="text-blue-800 font-bold">All low/out items are on order</p>
                    <p className="text-blue-600 text-sm mt-0.5">Waiting on delivery. Items will reappear if a short is received.</p>
                  </div>
                )}

                {/* On Order section */}
                {pendingOrders.length > 0 && (
                  <section className="mb-6">
                    <h2 className="text-xs font-bold uppercase tracking-widest text-blue-500 mb-2">On Order</h2>
                    <div className="flex flex-col gap-3">
                      {pendingOrders.map((order) => (
                        <div key={order.id} className="bg-white rounded-2xl shadow-sm border border-blue-100 overflow-hidden">
                          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
                            <p className="text-xs text-gray-400">
                              <span className="font-semibold text-gray-600">{order.vendor ? vendorDisplayLabel(order.vendor) : 'Unknown vendor'}</span>
                              {' · '}Ordered {formatShort(order.created_at)} · {order.order_history_items.length} items
                            </p>
                            <button
                              onClick={() => cancelOrder(order.id)}
                              disabled={cancellingOrderId === order.id}
                              className="text-xs text-red-500 hover:text-red-700 font-semibold disabled:opacity-50"
                            >
                              {cancellingOrderId === order.id ? 'Cancelling…' : 'Cancel Order'}
                            </button>
                          </div>
                          {order.order_history_items.map((item, idx) => (
                            <div key={item.item_id} className={`flex items-center gap-3 px-5 py-3 ${idx < order.order_history_items.length - 1 ? 'border-b border-gray-100' : ''}`}>
                              <p className="flex-1 text-sm font-semibold text-gray-500">{item.item_name}</p>
                              <p className="text-sm text-gray-400">{item.quantity} {unitLabel(item.unit, item.quantity)}</p>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </>
        ) : (
          <>
            {historyLoading ? (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-12 text-center">
                <p className="text-gray-400">Loading history…</p>
              </div>
            ) : orderHistory.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-12 text-center">
                <p className="text-gray-400 text-lg">No order history yet.</p>
                <p className="text-gray-400 text-sm mt-1">Use &quot;Mark as Ordered&quot; or &quot;Receive Order&quot; to start tracking.</p>
              </div>
            ) : (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                {(() => {
                  const orderById = Object.fromEntries(orderHistory.map((o) => [o.id, o]))
                  return orderHistory.map((order, idx, arr) => {
                    const isExpanded = expandedOrders.has(order.id)
                    const relatedOrder = order.related_order_id ? orderById[order.related_order_id] : null
                    return (
                      <div key={order.id} className={idx < arr.length - 1 ? 'border-b border-gray-100' : ''}>
                        <button
                          onClick={() => toggleOrder(order.id)}
                          className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors text-left"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <span className={`flex-shrink-0 text-xs font-bold px-2.5 py-1 rounded-lg ${TYPE_COLORS[order.type] ?? 'bg-gray-100 text-gray-500'}`}>
                              {TYPE_LABELS[order.type] ?? order.type}
                            </span>
                            {order.note_review_needed && (
                              <span className="flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border border-gray-300 text-gray-500 uppercase tracking-wide">
                                Note
                              </span>
                            )}
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-gray-900">{formatDate(order.created_at)}</p>
                              <p className="text-xs text-gray-400">
                                {order.type === 'ordered' && (
                                  <span className="font-semibold text-gray-600">{order.vendor ? vendorDisplayLabel(order.vendor) : 'Unknown vendor'} · </span>
                                )}
                                {order.order_history_items.length} items
                                {order.received_by && <span className="text-[#1a7a3c] font-medium"> · {order.received_by}</span>}
                                {order.type === 'short' && relatedOrder && (
                                  <span className="text-gray-400"> · from {formatDate(relatedOrder.created_at)} delivery</span>
                                )}
                              </p>
                            </div>
                          </div>
                          <svg className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        {isExpanded && (
                          <div className="border-t border-gray-100">
                            {order.order_history_items.map((item, i) => {
                              // Patch 55/56: a received/will-call receipt stores any
                              // pack_size item's quantity in its real stock unit
                              // (unchanged math) -- show the box/case count alongside
                              // it here so the history still reads in the unit the
                              // person actually counted out. "Mark as Ordered"
                              // entries (type 'ordered') and short records already
                              // store box/case quantities directly, so they need no
                              // extra conversion text.
                              const sourceItem = items.find((i2) => i2.id === item.item_id)
                              const showBoxes = sourceItem && usesBoxOrdering(sourceItem) && (order.type === 'received' || order.type === 'will_call')
                              const boxCount = showBoxes ? Math.round((item.quantity / (sourceItem!.pack_size as number)) * 100) / 100 : 0
                              return (
                                <div key={i} className={`flex items-center justify-between px-5 py-3 bg-gray-50 ${i < order.order_history_items.length - 1 ? 'border-b border-gray-100' : ''}`}>
                                  <p className="text-sm font-medium text-gray-900">{item.item_name}</p>
                                  <p className="text-sm font-bold text-gray-700">
                                    {item.quantity} <span className="font-normal text-gray-400">{unitLabel(item.unit, item.quantity)}</span>
                                    {showBoxes && <span className="font-normal text-gray-400"> ({boxCount} {unitLabel(getOrderUnitLabel(sourceItem!), boxCount)})</span>}
                                  </p>
                                </div>
                              )
                            })}
                            {order.notes && (
                              <div className="px-5 py-3 bg-yellow-50 border-t border-gray-100 flex items-center justify-between gap-3">
                                <p className="text-xs text-gray-500 italic">{order.notes}</p>
                                {order.note_review_needed && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); markNoteReviewed(order.id) }}
                                    disabled={reviewingNoteId === order.id}
                                    className="flex-shrink-0 text-xs font-semibold border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 px-3 py-1 rounded-lg"
                                  >
                                    {reviewingNoteId === order.id ? '…' : 'Reviewed ✓'}
                                  </button>
                                )}
                              </div>
                            )}
                            {order.type === 'short' && order.resolved_at && (
                              <div className="px-5 py-3 bg-green-50 border-t border-gray-100">
                                <p className="text-xs text-green-700">
                                  Resolved {new Date(order.resolved_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                  {order.resolved_by && <span className="font-semibold"> · {order.resolved_by}</span>}
                                </p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })
                })()}
              </div>
            )}
          </>
        )}
      </main>
      <BackToTop />
    </div>
  )
}
