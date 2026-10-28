'use client'

import { useCallback, useEffect, useState } from 'react'
import Navigation from '@/components/Navigation'
import FlavorSlotPicker from '@/components/todo/FlavorSlotPicker'
import { getRole } from '@/lib/auth'
import { Role } from '@/lib/types'
import { addDays, todayInTZ } from '@/lib/tasks'
import {
  FLAVOR_SLOT_COUNT,
  FLAVOR_TYPE_BADGE,
  FLAVOR_TYPE_BADGE_CLASS,
  Flavor,
  FlavorWeekSlot,
  formatWeekLabel,
  startOfWeek,
} from '@/lib/flavors'

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
  // Glance-able hint only (patch 26) — Joshua always wants at least one
  // sugar-free and tries to have a cream ice represented, but a week can
  // still be saved/used without either.
  const hasSugarFree = slots.some((s) => s.flavor_type === 'sugar_free')
  const hasCreamIce = slots.some((s) => s.flavor_type === 'cream_ice')

  return (
    <div className="min-h-screen flex flex-col bg-[#d4edda]">
      <Navigation />

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6">
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

        {!roleLoaded || loading ? (
          <p className="text-gray-400 text-center py-10">Loading…</p>
        ) : (
          <div className="flex flex-col gap-2">
            {Array.from({ length: FLAVOR_SLOT_COUNT }, (_, i) => i + 1).map((slotNum) => {
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
            })}
          </div>
        )}
      </main>

      {editingSlot !== null && (
        <FlavorSlotPicker
          flavors={flavors}
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
