'use client'

import { useCallback, useEffect, useState } from 'react'
import Navigation from '@/components/Navigation'
import FlavorSlotPicker from '@/components/todo/FlavorSlotPicker'
import { getRole } from '@/lib/auth'
import { Role } from '@/lib/types'
import { addDays, todayInTZ } from '@/lib/tasks'
import {
  FLAVOR_SECTIONS,
  FLAVOR_TYPE_BADGE,
  FLAVOR_TYPE_BADGE_CLASS,
  Flavor,
  FlavorSection,
  FlavorWeekSlot,
  formatWeekLabel,
  sectionForSlot,
  slotNumbersForSection,
  startOfWeek,
} from '@/lib/flavors'

// Patch 33: the one grid every section's slots render in -- 1 column on a
// phone-width screen, 2 at tablet width, 3 from laptop width up (the ViewSonic
// store touchscreen included), so the three sections can't drift apart again.
const SLOT_GRID_CLASS = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2'

// Weekly flavor planning board (patch 20) — open to everyone, like /todo:
// owners and shift leads (canManage, same tier as "+ Add Task") can
// fill/change/clear each slot; regular staff (role === null) see the exact
// same board read-only, no picker, no PIN-unlock escape hatch like Add Task
// has — this one's strictly role-gated.
export default function FlavorsPage() {
  const [role, setRole] = useState<Role | null>(null)
  const [roleLoaded, setRoleLoaded] = useState(false)
  const [weekStart, setWeekStart] = useState(() => startOfWeek(todayInTZ()))
  const [slots, setSlots] = useState<FlavorWeekSlot[]>([])
  const [flavors, setFlavors] = useState<Flavor[]>([])
  const [loading, setLoading] = useState(true)
  const [editingSlot, setEditingSlot] = useState<number | null>(null)
  const [savingSlot, setSavingSlot] = useState<number | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: resolve role once on mount, this app's standard page-load pattern
    setRole(getRole())
    setRoleLoaded(true)
  }, [])

  // Active flavors only — the catalog (including inactive ones) is a
  // separate owner-only screen under More ▾.
  useEffect(() => {
    fetch('/api/flavors')
      .then((res) => (res.ok ? res.json() : []))
      .then(setFlavors)
      .catch(() => {})
  }, [])

  const loadWeek = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/flavors/week?week_start=${weekStart}`)
      if (res.ok) {
        const data = await res.json()
        setSlots(data.slots ?? [])
      }
    } catch {
      // board just stays stale on a transient error
    } finally {
      setLoading(false)
    }
  }, [weekStart])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: fetches this week's slots on mount and whenever the week changes
    loadWeek()
  }, [loadWeek])

  const canManage = role !== null

  const handlePick = async (flavorId: string | null) => {
    if (editingSlot === null) return
    setError('')
    setSavingSlot(editingSlot)
    try {
      const res = await fetch('/api/flavors/week', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ week_start: weekStart, slot_number: editingSlot, flavor_id: flavorId }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Could not save')
      await loadWeek()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. Try again.')
    } finally {
      setSavingSlot(null)
      setEditingSlot(null)
    }
  }

  const slotMap = new Map(slots.map((s) => [s.slot_number, s]))
  const editingSlotData = editingSlot !== null ? slotMap.get(editingSlot) : undefined
  const editingSection = editingSlot !== null ? sectionForSlot(editingSlot) : undefined
  // Each section's picker only offers its own flavor types (patch 32) — the
  // ice picker is filtered here too, now that the catalog holds soft serve
  // and custard flavors as well, so it still lists exactly the ice types it
  // always has.
  const pickerFlavors = editingSection ? flavors.filter((f) => editingSection.types.includes(f.type)) : []

  // Glance-able hint only (patch 26) — Joshua always wants at least one
  // sugar-free and tries to have a cream ice represented, but a week can
  // still be saved/used without either. Ice section only (patch 32) — these
  // two types only ever live in ice slots, but the slot-number check keeps
  // this banner from drifting onto the new sections even if that changes.
  const iceSlots = slots.filter((s) => sectionForSlot(s.slot_number)?.key === 'ice')
  const hasSugarFree = iceSlots.some((s) => s.flavor_type === 'sugar_free')
  const hasCreamIce = iceSlots.some((s) => s.flavor_type === 'cream_ice')

  // Shared slot-card look, used by every section (patch 32) — same filled
  // vs. empty styling, same disabled behavior, for ice and the two new
  // sections alike.
  const renderSlotButton = (slotNum: number) => {
    const slot = slotMap.get(slotNum)
    const filled = !!slot
    return (
      <button
        key={slotNum}
        type="button"
        onClick={() => canManage && setEditingSlot(slotNum)}
        disabled={!canManage || savingSlot === slotNum}
        className={`rounded-2xl shadow-sm border px-4 py-3 flex items-center gap-3 text-left transition-colors disabled:opacity-60 ${
          filled ? 'bg-white border-gray-100' : 'bg-gray-50 border-dashed border-gray-200'
        }`}
      >
        <span className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-100 text-gray-500 font-bold flex items-center justify-center text-sm">
          {slotNum}
        </span>
        <span className={`flex-1 font-semibold ${filled ? 'text-gray-900' : 'text-gray-400'}`}>
          {slot?.flavor_name ?? 'Empty'}
        </span>
        {slot?.flavor_type && (
          <span
            className={`flex-shrink-0 text-xs font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${FLAVOR_TYPE_BADGE_CLASS[slot.flavor_type]}`}
          >
            {FLAVOR_TYPE_BADGE[slot.flavor_type]}
          </span>
        )}
        {canManage && <span className="text-gray-300 flex-shrink-0">›</span>}
      </button>
    )
  }

  const renderSection = (section: FlavorSection) => (
    <div key={section.key} className="mb-6">
      <h2 className="text-lg font-bold text-gray-900 mb-1">{section.label}</h2>
      {section.alwaysOnNote && <p className="text-xs text-gray-500 mb-2">{section.alwaysOnNote}</p>}
      <div className={`${SLOT_GRID_CLASS} mt-2`}>{slotNumbersForSection(section).map(renderSlotButton)}</div>
    </div>
  )

  return (
    <div className="min-h-screen flex flex-col bg-[#d4edda]">
      <Navigation />

      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-5">Flavors</h1>

        <div className="flex items-center justify-between mb-5 bg-white rounded-xl border border-gray-100 p-2">
          <button
            onClick={() => setWeekStart((w) => addDays(w, -7))}
            className="min-h-[40px] px-3 text-sm font-semibold text-gray-600 hover:bg-gray-50 rounded-lg"
          >
            ‹ Prev
          </button>
          <span className="text-sm font-bold text-gray-900">{formatWeekLabel(weekStart)}</span>
          <button
            onClick={() => setWeekStart((w) => addDays(w, 7))}
            className="min-h-[40px] px-3 text-sm font-semibold text-gray-600 hover:bg-gray-50 rounded-lg"
          >
            Next ›
          </button>
        </div>

        {error && <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3">{error}</div>}

        {!loading && (
          <div className="mb-5 flex flex-col gap-1.5 text-sm font-semibold">
            <p className={hasSugarFree ? 'text-green-700' : 'text-amber-600'}>
              {hasSugarFree ? '✓ Sugar Free covered' : '⚠ No Sugar Free flavor selected yet'}
            </p>
            <p className={hasCreamIce ? 'text-green-700' : 'text-amber-600'}>
              {hasCreamIce ? '✓ Cream Ice covered' : '⚠ No Cream Ice flavor selected yet'}
            </p>
          </div>
        )}

        {/* Patch 33: Ice now renders through the exact same renderSection/
            SLOT_GRID_CLASS as Soft Serve and Hand Scoop Custard -- one shared
            grid for all three, so they can't drift apart again. Slot numbers,
            fill/change/clear, the picker, and the banner above are untouched. */}
        {!roleLoaded || loading ? (
          <p className="text-gray-400 text-center py-10">Loading…</p>
        ) : (
          <>{FLAVOR_SECTIONS.map(renderSection)}</>
        )}
      </main>

      {editingSlot !== null && (
        <FlavorSlotPicker
          flavors={pickerFlavors}
          slotNumber={editingSlot}
          currentFlavorId={editingSlotData?.flavor_id ?? null}
          currentFlavorName={editingSlotData?.flavor_name ?? null}
          busy={savingSlot === editingSlot}
          onPick={handlePick}
          onClose={() => setEditingSlot(null)}
        />
      )}
    </div>
  )
}
