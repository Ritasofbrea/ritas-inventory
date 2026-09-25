'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Navigation from '@/components/Navigation'
import { getRole } from '@/lib/auth'
import { Item, InventoryCount, CATEGORIES, Category } from '@/lib/types'

interface CountDraft {
  [itemId: string]: string
}

type CountDraftData = {
  counts: CountDraft
  secondaryCounts: CountDraft
  countedBy: string
  isTestCount: boolean
  savedAt: number
}

type ServerDraft = {
  counts: CountDraft
  secondary_counts: CountDraft
  counted_by: string
  is_test_count: boolean
  updated_at: string
}

const DRAFT_SAVE_DEBOUNCE_MS = 2000

const toDraftData = (d: ServerDraft): CountDraftData => ({
  counts: d.counts,
  secondaryCounts: d.secondary_counts,
  countedBy: d.counted_by,
  isTestCount: d.is_test_count,
  savedAt: new Date(d.updated_at).getTime(),
})

// Count summary screen shown after a successful submit — see buildAndShowSummary.
interface SubmittedEntry {
  item: Item
  primary: string
  secondary: string
}

interface SummaryEntry extends SubmittedEntry {
  flagged: boolean
  reasons: string[]
}

const FLAG_HIGH = 'Much higher than last count'
const FLAG_LOW = 'Much lower than last count'
const FLAG_PAR = 'Well above par'

const computeFlags = (item: Item, primaryVal: number, secondaryVal: number, previousCount: number | null): string[] => {
  const reasons: string[] = []
  if (previousCount !== null && previousCount > 0) {
    if (primaryVal > previousCount * 2) reasons.push(FLAG_HIGH)
    else if (primaryVal < previousCount / 2) reasons.push(FLAG_LOW)
  }
  if (item.par_level > 0) {
    const combinedTotal = item.units_per_sub_unit && item.units_per_sub_unit > 0
      ? primaryVal + secondaryVal / item.units_per_sub_unit
      : primaryVal
    if (combinedTotal > item.par_level * 2) reasons.push(FLAG_PAR)
  }
  return reasons
}

// Looks up the count entered before this submission, using the same
// /api/counts endpoint the History page uses (already excludes test data).
// A non-test submission's own row is the newest match, so its "previous"
// count is the second row back; a test submission's row is filtered out
// entirely (is_test_data=false), so its "previous" count is the first row.
const fetchPreviousCount = async (itemId: string, wasTest: boolean): Promise<number | null> => {
  try {
    const res = await fetch(`/api/counts?item_id=${itemId}&limit=2`)
    if (!res.ok) return null
    const data: InventoryCount[] = await res.json()
    const row = wasTest ? data[0] : data[1]
    return row ? Number(row.count) : null
  } catch {
    return null
  }
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
  const [nameError, setNameError] = useState('')
  const [role, setRole] = useState<string | null>(null)
  const [lastCount, setLastCount] = useState<{ created_at: string; entered_by: string } | null>(null)
  const [search, setSearch] = useState('')
  const firstInputRef = useRef<HTMLInputElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const submitRef = useRef<HTMLDivElement>(null)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [draftToRestore, setDraftToRestore] = useState<CountDraftData | null>(null)
  const [isTestCount, setIsTestCount] = useState(false)
  const [confirmedItems, setConfirmedItems] = useState<Set<string>>(new Set())
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
  const [summaryData, setSummaryData] = useState<SummaryEntry[] | null>(null)
  const [showSummary, setShowSummary] = useState(false)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [recountFilterIds, setRecountFilterIds] = useState<Set<string> | null>(null)
  const draftSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const blurTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const clearBlurTimer = (itemId: string) => {
    const t = blurTimers.current[itemId]
    if (t) {
      clearTimeout(t)
      delete blurTimers.current[itemId]
    }
  }

  const clearAllBlurTimers = () => {
    Object.values(blurTimers.current).forEach(clearTimeout)
    blurTimers.current = {}
  }

  useEffect(() => {
    return () => {
      if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current)
      clearAllBlurTimers()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const el = submitRef.current
    if (!el) return
    const obs = new IntersectionObserver(([e]) => setShowScrollBtn(!e.isIntersecting), { threshold: 0.1 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [loading])

  const scrollToSave = useCallback(() => {
    submitRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [])

  // Add item modal state
  const [showAddModal, setShowAddModal] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCategory, setNewCategory] = useState<Category>(CATEGORIES[0])
  const [newUnit, setNewUnit] = useState('boxes')
  const [newSecondaryUnit, setNewSecondaryUnit] = useState('')
  const [newUnitsPerSubUnit, setNewUnitsPerSubUnit] = useState('')
  const [newDistributor, setNewDistributor] = useState('')
  const [newItemNumber, setNewItemNumber] = useState('')
  const [newDistributorItemName, setNewDistributorItemName] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')

  useEffect(() => {
    const r = getRole()
    if (!r) { router.replace('/login'); return }
    setRole(r)
    fetchItems()
    fetch('/api/dashboard-summary').then((res) => res.json()).then((d) => setLastCount(d.lastCount)).catch(() => {})
  }, [router])

  const handleCountedByChange = (val: string) => {
    setCountedBy(val)
    if (val.trim()) setNameError('')
  }

  const saveDraftNow = (c: CountDraft, sc: CountDraft, testFlag: boolean = isTestCount, by: string = countedBy) => {
    fetch('/api/count-draft', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ counts: c, secondary_counts: sc, counted_by: by, is_test_count: testFlag }),
    }).catch(() => {})
  }

  const saveDraft = (c: CountDraft, sc: CountDraft, testFlag: boolean = isTestCount) => {
    if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current)
    draftSaveTimer.current = setTimeout(() => saveDraftNow(c, sc, testFlag), DRAFT_SAVE_DEBOUNCE_MS)
  }

  const handleTestToggle = () => {
    const next = !isTestCount
    setIsTestCount(next)
    if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current)
    saveDraftNow(counts, secondaryCounts, next)
  }

  const handleRestore = () => {
    if (!draftToRestore) return
    clearAllBlurTimers()
    setCounts(draftToRestore.counts)
    setSecondaryCounts(draftToRestore.secondaryCounts)
    setIsTestCount(draftToRestore.isTestCount ?? false)
    setConfirmedItems(new Set(Object.entries(draftToRestore.counts).filter(([, v]) => v !== '').map(([id]) => id)))
    setCountedBy('')
    setDraftToRestore(null)
  }

  const handleDiscardDraft = () => {
    fetch('/api/count-draft', { method: 'DELETE' }).catch(() => {})
    setDraftToRestore(null)
  }

  const fetchItems = async () => {
    try {
      const res = await fetch('/api/items')
      const data = await res.json()
      setItems(data)
      clearAllBlurTimers()
      setCounts({})
      setSecondaryCounts({})
      setConfirmedItems(new Set())
      try {
        const draftRes = await fetch('/api/count-draft')
        const draft = await draftRes.json()
        if (draft) setDraftToRestore(toDraftData(draft as ServerDraft))
      } catch {
        // draft fetch failing shouldn't block count entry
      }
    } catch {
      setError('Failed to load items. Check your connection.')
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (itemId: string, value: string) => {
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      const next = { ...counts, [itemId]: value }
      setCounts(next)
      saveDraft(next, secondaryCounts)
    }
  }

  const handleSecondaryChange = (itemId: string, value: string) => {
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      const next = { ...secondaryCounts, [itemId]: value }
      setSecondaryCounts(next)
      saveDraft(counts, next)
    }
  }

  // Confirms/unconfirms an item based on whether either its primary or
  // secondary count has a value — same condition already used for the
  // progress bar and the submit payload. Called after a short delay from
  // blur (see handleItemInputBlur) rather than immediately, so tapping from
  // the primary input into that same item's secondary input doesn't briefly
  // move the item to Counted mid-entry.
  const confirmItem = (itemId: string) => {
    const hasPrimary = counts[itemId] !== undefined && counts[itemId] !== ''
    const hasSecondary = secondaryCounts[itemId] !== undefined && secondaryCounts[itemId] !== ''
    const hasValue = hasPrimary || hasSecondary
    setConfirmedItems((prev) => {
      if (hasValue === prev.has(itemId)) return prev
      const next = new Set(prev)
      if (hasValue) next.add(itemId)
      else next.delete(itemId)
      return next
    })
  }

  // Shared blur handler for both the primary and secondary inputs of an item.
  // Debounced: if focus lands back on the other input for the same item
  // within the delay, handleItemInputFocus cancels this before it fires.
  const handleItemInputBlur = (itemId: string) => {
    clearBlurTimer(itemId)
    blurTimers.current[itemId] = setTimeout(() => {
      delete blurTimers.current[itemId]
      confirmItem(itemId)
    }, 100)
  }

  const handleItemInputFocus = (itemId: string) => {
    clearBlurTimer(itemId)
  }

  const toggleCategory = (sectionKey: string, category: string) => {
    const key = `${sectionKey}:${category}`
    setExpandedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Fetches previous counts and par levels needed for the flag comparisons,
  // then shows the summary — run only after submit has already succeeded so
  // a slow/failed lookup here can never block or affect the save itself.
  const buildAndShowSummary = async (entries: SubmittedEntry[], wasTest: boolean) => {
    if (entries.length === 0) return
    setSummaryLoading(true)
    try {
      const withFlags = await Promise.all(
        entries.map(async ({ item, primary, secondary }) => {
          const primaryVal = primary !== '' ? parseFloat(primary) : 0
          const secondaryVal = secondary !== '' ? parseFloat(secondary) : 0
          const previousCount = await fetchPreviousCount(item.id, wasTest)
          const reasons = computeFlags(item, primaryVal, secondaryVal, previousCount)
          return { item, primary, secondary, flagged: reasons.length > 0, reasons }
        })
      )
      // Preserve existing category/sort_order (the order `items` already
      // comes in), just grouped flagged-first.
      const idxMap = new Map(items.map((it, i) => [it.id, i]))
      withFlags.sort((a, b) => (idxMap.get(a.item.id) ?? 0) - (idxMap.get(b.item.id) ?? 0))
      const flagged = withFlags.filter((e) => e.flagged)
      const normal = withFlags.filter((e) => !e.flagged)
      setSummaryData([...flagged, ...normal])
      setShowSummary(true)
    } catch {
      // Best-effort — the count itself already saved successfully.
    } finally {
      setSummaryLoading(false)
    }
  }

  const handleRecountFlagged = () => {
    if (!summaryData) return
    const flaggedEntries = summaryData.filter((e) => e.flagged)
    const flaggedIds = new Set(flaggedEntries.map((e) => e.item.id))
    setRecountFilterIds(flaggedIds)
    setSearch('')
    setExpandedCategories((prev) => {
      const next = new Set(prev)
      flaggedEntries.forEach((e) => next.add(`still:${e.item.category}`))
      return next
    })
    setShowSummary(false)
    setSummaryData(null)
  }

  const handleSummaryDismiss = () => {
    setShowSummary(false)
    setSummaryData(null)
    setRecountFilterIds(null)
  }

  const handleSubmit = async () => {
    if (role !== 'owner' && !countedBy.trim()) {
      setNameError('Please enter your name before saving.')
      nameInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      nameInputRef.current?.focus()
      return
    }
    setSaving(true)
    setError('')
    try {
      const submittedEntries: SubmittedEntry[] = items
        .filter((item) => {
          const hasPrimary = counts[item.id] !== undefined && counts[item.id] !== ''
          const hasSecondary = secondaryCounts[item.id] !== undefined && secondaryCounts[item.id] !== ''
          return hasPrimary || hasSecondary
        })
        .map((item) => ({
          item,
          primary: counts[item.id] ?? '',
          secondary: secondaryCounts[item.id] ?? '',
        }))

      const payload = submittedEntries.map(({ item, primary }) => ({
        item_id: item.id,
        count: primary !== '' ? parseFloat(primary) : 0,
      }))

      const res = await fetch('/api/counts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ counts: payload, entered_by: countedBy.trim() || 'shift_lead', is_test_data: isTestCount }),
      })
      if (!res.ok) throw new Error('Save failed')

      // Test counts must never touch live stock levels (secondary_count included)
      if (!isTestCount) {
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
      }

      const wasTestCount = isTestCount
      clearAllBlurTimers()
      setCounts({})
      setSecondaryCounts({})
      setConfirmedItems(new Set())
      setRecountFilterIds(null)
      if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current)
      fetch('/api/count-draft', { method: 'DELETE' }).catch(() => {})
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
      buildAndShowSummary(submittedEntries, wasTestCount)
      if (!wasTestCount) {
        const name = countedBy.trim() || 'Someone'
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        fetch('/api/send-push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'New Count Submitted', body: `${name} submitted a count at ${time}` }),
        }).then((r) => r.json()).then((d) => console.log('push result:', d)).catch((e) => console.error('push error:', e))
      }
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
        body: JSON.stringify({
          name: newName.trim(),
          category: newCategory,
          unit: newUnit.trim() || 'boxes',
          secondary_unit: newSecondaryUnit.trim(),
          units_per_sub_unit: newSecondaryUnit.trim() && newUnitsPerSubUnit ? parseInt(newUnitsPerSubUnit, 10) : null,
          distributor: newDistributor || null,
          item_number: newItemNumber.trim() || null,
          distributor_item_name: newDistributorItemName.trim() || null,
        }),
      })
      if (!res.ok) throw new Error()
      const created: Item = await res.json()
      setItems((prev) => [...prev, created])
      setCounts((prev) => ({ ...prev, [created.id]: '0' }))
      setSecondaryCounts((prev) => ({ ...prev, [created.id]: '' }))
      setConfirmedItems((prev) => new Set(prev).add(created.id))
      setNewName('')
      setNewUnit('boxes')
      setNewSecondaryUnit('')
      setNewUnitsPerSubUnit('')
      setNewDistributor('')
      setNewItemNumber('')
      setNewDistributorItemName('')
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

  const searchTerm = search.trim().toLowerCase()
  const searchedItems = searchTerm ? items.filter((i) => i.name.toLowerCase().includes(searchTerm)) : items
  const visibleItems = recountFilterIds ? searchedItems.filter((i) => recountFilterIds.has(i.id)) : searchedItems
  const stillCountingItems = visibleItems.filter((i) => !confirmedItems.has(i.id))
  const countedItems = visibleItems.filter((i) => confirmedItems.has(i.id))
  const stillCountingByCategory = CATEGORIES.reduce<Record<string, Item[]>>((acc, cat) => {
    acc[cat] = stillCountingItems.filter((i) => i.category === cat)
    return acc
  }, {})
  const countedByCategory = CATEGORIES.reduce<Record<string, Item[]>>((acc, cat) => {
    acc[cat] = countedItems.filter((i) => i.category === cat)
    return acc
  }, {})

  const renderCategorySections = (byCategory: Record<string, Item[]>, assignFirstRef: boolean, sectionKey: string) =>
    CATEGORIES.map((category) => {
      const catItems = byCategory[category] || []
      if (catItems.length === 0) return null
      const catAll = visibleItems.filter((i) => i.category === category)
      const catCounted = catAll.filter((i) => confirmedItems.has(i.id)).length
      const expanded = expandedCategories.has(`${sectionKey}:${category}`)
      return (
        <section key={category}>
          <button
            type="button"
            onClick={() => toggleCategory(sectionKey, category)}
            aria-expanded={expanded}
            className="w-full min-h-[48px] flex items-center justify-between gap-3 px-4 py-3 mb-3 bg-white rounded-xl border border-gray-100 shadow-sm active:bg-gray-50 transition-colors"
          >
            <span className="text-xs font-bold uppercase tracking-widest text-blue-500">
              {category}
            </span>
            <span className="flex items-center gap-2 flex-shrink-0">
              <span className="text-xs font-semibold text-gray-400">{catCounted} / {catAll.length} counted</span>
              <svg
                className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
              </svg>
            </span>
          </button>
          {expanded && (
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
                  <div className="flex flex-col items-center gap-0.5">
                    <input
                      ref={assignFirstRef && idx === 0 && category === CATEGORIES[0] ? firstInputRef : undefined}
                      type="text"
                      inputMode="decimal"
                      className="count-input w-20 text-center text-2xl font-bold border-2 border-gray-200 rounded-xl py-2 px-1 focus:outline-none focus:border-blue-400 bg-slate-50"
                      value={counts[item.id] ?? ''}
                      onChange={(e) => handleChange(item.id, e.target.value)}
                      onFocus={(e) => { e.target.select(); handleItemInputFocus(item.id) }}
                      onBlur={() => handleItemInputBlur(item.id)}
                      placeholder="0"
                    />
                    {item.current_count > 0 && (
                      <span className={`text-xs text-gray-300 ${counts[item.id] === undefined ? '' : 'invisible'}`}>
                        was {item.current_count}
                      </span>
                    )}
                  </div>
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
                          onFocus={(e) => { e.target.select(); handleItemInputFocus(item.id) }}
                          onBlur={() => handleItemInputBlur(item.id)}
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
          )}
        </section>
      )
    })

  return (
    <div className={`min-h-screen flex flex-col bg-[#d4edda] ${isTestCount ? 'ring-4 ring-inset ring-purple-400' : ''}`}>
      <Navigation />

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Count Entry</h1>
            {lastCount ? (() => {
              const d = new Date(lastCount.created_at)
              const isToday = d.toDateString() === new Date().toDateString()
              const dateStr = isToday
                ? `Today at ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
              const by = lastCount.entered_by && lastCount.entered_by !== 'shift_lead' ? ` by ${lastCount.entered_by}` : ''
              return <p className="text-sm mt-1 text-gray-400">Last count: {dateStr}{by}</p>
            })() : <p className="text-gray-500 mt-1">Enter today&apos;s counts for each item.</p>}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => { setShowAddModal(true); setAddError('') }}
              className="flex-shrink-0 bg-[#c8102e] hover:bg-[#a50d26] text-white font-semibold px-4 py-2 rounded-xl text-sm transition-colors"
            >
              + Add Item
            </button>
            {role === 'owner' && (
              <button
                onClick={handleTestToggle}
                role="switch"
                aria-checked={isTestCount}
                title="Test Count — excludes from reports, trends, and par suggestions"
                className={`flex-shrink-0 font-semibold px-4 py-2 rounded-xl text-sm transition-colors ${
                  isTestCount
                    ? 'bg-purple-500 hover:bg-purple-600 text-white'
                    : 'bg-white text-purple-600 border border-purple-200 hover:border-purple-400'
                }`}
              >
                🧪 Test{isTestCount ? ' ON' : ''}
              </button>
            )}
          </div>
        </div>

        {/* Recount-flagged-only filter, set by the "Recount flagged items" summary button */}
        {recountFilterIds && (
          <div className="mb-5 bg-amber-50 border border-amber-200 rounded-2xl px-5 py-3 flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-amber-800">
              ⚠️ Showing {recountFilterIds.size} flagged item{recountFilterIds.size === 1 ? '' : 's'} to recount
            </p>
            <button
              onClick={() => setRecountFilterIds(null)}
              className="flex-shrink-0 text-xs font-semibold text-amber-700 underline"
            >
              Show all items
            </button>
          </div>
        )}

        {/* Draft restore prompt */}
        {draftToRestore && (
          <div className="mb-5 bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4">
            <p className="text-sm font-semibold text-amber-800">
              {draftToRestore.countedBy?.trim()
                ? `Restore ${draftToRestore.countedBy.trim()}'s${draftToRestore.isTestCount ? ' TEST' : ''} count from ${new Date(draftToRestore.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}?`
                : `Restore ${draftToRestore.isTestCount ? 'TEST ' : ''}in-progress count from ${new Date(draftToRestore.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}?`}
            </p>
            <div className="flex gap-2 mt-3">
              <button
                onClick={handleRestore}
                className="flex-1 bg-amber-500 hover:bg-amber-600 text-white font-semibold py-2 rounded-xl text-sm transition-colors"
              >
                Restore
              </button>
              <button
                onClick={handleDiscardDraft}
                className="flex-1 bg-white hover:bg-gray-50 text-amber-700 font-semibold py-2 rounded-xl text-sm border border-amber-200 transition-colors"
              >
                Start Fresh
              </button>
            </div>
          </div>
        )}

        {/* Persistent test-mode indicator */}
        {isTestCount && (
          <div className="mb-5 bg-purple-100 border-2 border-purple-400 rounded-2xl px-5 py-3 flex items-center gap-3">
            <span className="text-xl">🧪</span>
            <div>
              <p className="text-sm font-bold text-purple-800">Test Mode Active</p>
              <p className="text-xs text-purple-600">This count won&apos;t update live stock and is excluded from reports.</p>
            </div>
          </div>
        )}

        {/* Who's counting — shift lead only */}
        {role !== 'owner' && (
          <div className="mb-5 bg-white rounded-2xl shadow-sm border border-gray-100 px-5 py-4">
            <div className="flex items-center gap-3">
              <label className="text-sm font-semibold text-gray-600 flex-shrink-0">Who&apos;s counting?</label>
              <input
                ref={nameInputRef}
                type="text"
                className={`flex-1 border rounded-xl px-3 py-2 text-gray-900 focus:outline-none text-sm ${nameError ? 'border-red-400 focus:border-red-500' : 'border-gray-200 focus:border-blue-400'}`}
                placeholder="Enter your name"
                value={countedBy}
                onChange={(e) => handleCountedByChange(e.target.value)}
              />
            </div>
            {nameError && (
              <p className="text-red-500 text-xs mt-2 ml-0">{nameError}</p>
            )}
          </div>
        )}

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3">
            {error}
          </div>
        )}

        {/* Count progress */}
        {items.length > 0 && (() => {
          const entered = items.filter((i) => {
            const hasPrimary = counts[i.id] !== undefined && counts[i.id] !== ''
            const hasSecondary = secondaryCounts[i.id] !== undefined && secondaryCounts[i.id] !== ''
            return hasPrimary || hasSecondary
          }).length
          const pct = entered / items.length
          const barColor = entered === items.length ? 'bg-green-500' : pct >= 0.5 ? 'bg-amber-400' : 'bg-blue-400'
          return (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-4 py-3 mb-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Items Entered</p>
                <p className="text-sm font-bold text-gray-900">
                  {entered} / {items.length}
                  {entered === items.length && <span className="text-green-500 ml-1.5">✓ All done</span>}
                </p>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div className={`h-2 rounded-full transition-all ${barColor}`} style={{ width: `${Math.round(pct * 100)}%` }} />
              </div>
            </div>
          )
        })()}

        <div className="mb-4">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search items…"
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 focus:outline-none focus:border-blue-400 bg-white text-sm"
          />
        </div>

        {searchTerm && visibleItems.length === 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-10 text-center mb-4">
            <p className="text-gray-400">No items match &ldquo;{search}&rdquo;</p>
          </div>
        )}

        <div className="flex flex-col gap-6">
          {countedItems.length > 0 && stillCountingItems.length > 0 && (
            <p className="text-xs font-bold uppercase tracking-widest text-gray-400 -mb-2">Still Counting</p>
          )}
          {renderCategorySections(stillCountingByCategory, true, 'still')}
        </div>

        {countedItems.length > 0 && (
          <div className="mt-8">
            <div className="flex items-center gap-3 mb-6">
              <span className="text-xs font-bold uppercase tracking-widest text-gray-400">Counted</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>
            <div className="flex flex-col gap-6">
              {renderCategorySections(countedByCategory, false, 'counted')}
            </div>
          </div>
        )}

        {/* Submit button */}
        <div ref={submitRef} className="mt-8 pb-8">
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

      {/* Scroll to save button */}
      {showScrollBtn && (
        <button
          onClick={scrollToSave}
          className="fixed bottom-6 right-5 z-40 bg-[#c8102e] hover:bg-[#a00d24] active:bg-[#7a0a1b] text-white w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-colors"
          aria-label="Scroll to save"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      )}

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

            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">Distributor <span className="text-gray-400 font-normal">(optional)</span></label>
              <select
                className="border border-gray-200 rounded-xl px-3 py-2.5 text-gray-900 focus:outline-none focus:border-blue-400 bg-white"
                value={newDistributor}
                onChange={(e) => {
                  const val = e.target.value
                  setNewDistributor(val)
                  if (val !== 'bunzl' && val !== 'balford') setNewItemNumber('')
                }}
              >
                <option value="">—</option>
                <option value="bunzl">Bunzl</option>
                <option value="balford">Balford</option>
                <option value="other">Other</option>
                <option value="seasonal">Seasonal/Promotional</option>
                <option value="discontinued">Discontinued</option>
              </select>
            </div>

            {(newDistributor === 'bunzl' || newDistributor === 'balford') && (
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500 font-medium">Distributor Item #</label>
                <input
                  type="text"
                  className="border border-gray-200 rounded-xl px-3 py-2.5 text-gray-900 focus:outline-none focus:border-blue-400"
                  placeholder="e.g. 0101"
                  value={newItemNumber}
                  onChange={(e) => setNewItemNumber(e.target.value)}
                />
              </div>
            )}

            {newDistributor && (
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500 font-medium">Distributor Item Name <span className="text-gray-400 font-normal">(optional)</span></label>
                <input
                  type="text"
                  className="border border-gray-200 rounded-xl px-3 py-2.5 text-gray-900 focus:outline-none focus:border-blue-400"
                  placeholder="Name in distributor's catalog"
                  value={newDistributorItemName}
                  onChange={(e) => setNewDistributorItemName(e.target.value)}
                />
              </div>
            )}

            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">Sub-unit <span className="text-gray-400 font-normal">(optional — e.g. sleeves, container)</span></label>
              <input
                type="text"
                className="border border-purple-200 rounded-xl px-3 py-2.5 text-gray-900 focus:outline-none focus:border-purple-400"
                placeholder="e.g. sleeves"
                value={newSecondaryUnit}
                onChange={(e) => setNewSecondaryUnit(e.target.value)}
              />
            </div>

            {newSecondaryUnit.trim() && (
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500 font-medium">
                  Units per {newSecondaryUnit.trim()} <span className="text-gray-400 font-normal">(optional — e.g. 20 sleeves per box)</span>
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  className="border border-purple-200 rounded-xl px-3 py-2.5 text-gray-900 focus:outline-none focus:border-purple-400"
                  placeholder="e.g. 20"
                  value={newUnitsPerSubUnit}
                  onChange={(e) => {
                    const v = e.target.value
                    if (v === '' || /^\d*$/.test(v)) setNewUnitsPerSubUnit(v)
                  }}
                />
              </div>
            )}

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

      {/* Preparing summary… (brief gap between submit succeeding and the summary being ready) */}
      {summaryLoading && !showSummary && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl px-6 py-5 flex items-center gap-3">
            <span className="w-5 h-5 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
            <p className="text-gray-600 font-medium">Preparing summary…</p>
          </div>
        </div>
      )}

      {/* Count summary — shown after a successful submit in place of a generic success message */}
      {showSummary && summaryData && (() => {
        const flaggedCount = summaryData.filter((e) => e.flagged).length
        return (
          <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md flex flex-col max-h-[85vh]">
              <div className="px-6 pt-6 pb-4 flex-shrink-0 border-b border-gray-100">
                <h2 className="text-xl font-bold text-gray-900">✓ Count Submitted</h2>
                <p className="text-sm text-gray-500 mt-1">
                  {summaryData.length} item{summaryData.length === 1 ? '' : 's'} counted
                  {flaggedCount > 0 && (
                    <span className="text-amber-600 font-semibold"> · {flaggedCount} flagged for review</span>
                  )}
                </p>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-2">
                {summaryData.map(({ item, primary, secondary, flagged, reasons }) => {
                  const primaryDisplay = primary !== '' ? primary : '0'
                  const secondaryVal = secondary !== '' ? parseFloat(secondary) : 0
                  const showSecondary = item.secondary_unit && secondaryVal > 0
                  return (
                    <div
                      key={item.id}
                      className={`rounded-xl border px-4 py-3 ${
                        flagged ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-100'
                      }`}
                    >
                      <p className="font-semibold text-gray-900 text-sm">
                        {item.name}
                        <span className="font-normal text-gray-600">
                          : {primaryDisplay} {item.unit}
                          {showSecondary && ` · ${secondary} ${item.secondary_unit}`}
                        </span>
                      </p>
                      {flagged && (
                        <div className="mt-1 flex flex-col gap-0.5">
                          {reasons.map((reason) => (
                            <p key={reason} className="text-xs font-semibold text-amber-700">
                              ⚠️ {reason}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              <div className="px-6 pb-6 pt-2 flex-shrink-0 flex flex-col gap-2">
                {flaggedCount > 0 && (
                  <button
                    onClick={handleRecountFlagged}
                    className="w-full bg-amber-500 hover:bg-amber-600 text-white font-semibold py-3 rounded-xl transition-colors"
                  >
                    Recount flagged items ({flaggedCount})
                  </button>
                )}
                <button
                  onClick={handleSummaryDismiss}
                  className={`w-full font-semibold py-3 rounded-xl transition-colors ${
                    flaggedCount > 0
                      ? 'bg-gray-100 hover:bg-gray-200 text-gray-600'
                      : 'bg-green-600 hover:bg-green-700 text-white'
                  }`}
                >
                  Looks good
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
