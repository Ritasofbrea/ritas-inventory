'use client'

import { useState } from 'react'
import { FLAVOR_TYPE_LABELS, Flavor, groupFlavorsByType, sectionForSlot, PROGRAM_LABELS, PROGRAM_BADGE_ICON, PROGRAM_BADGE_CLASS } from '@/lib/flavors'
import { useBlockReload } from '@/lib/reload-guard'

// "an Ice flavor" vs "a Soft Serve flavor" -- the only vowel-led section
// label today is Ice; this reads correctly for any future one too.
const articleFor = (label: string) => (/^[aeiou]/i.test(label) ? 'an' : 'a')

// Bottom-sheet list of flavor buttons for one week's slot — same pattern as
// StaffPicker, plus a "Clear this slot" option when it's already filled.
// Grouped by type (patch 26) rather than a flat alphabetical list — with
// ~89 flavors, that's the difference between "easy to find things" and a
// lot of scrolling; no search/filter needed on top of it.
export default function FlavorSlotPicker({
  flavors,
  slotNumber,
  currentFlavorId,
  currentFlavorName,
  busy,
  onPick,
  onClose,
}: {
  flavors: Flavor[]
  slotNumber: number
  currentFlavorId: string | null
  currentFlavorName: string | null
  busy?: boolean
  onPick: (flavorId: string | null) => void
  onClose: () => void
}) {
  useBlockReload(true) // patch 30: open picker, never auto-reload while it is
  // Patch 35: the slot number doesn't show anywhere in the UI anymore --
  // this title named it ("Slot 7"); now it names the section instead
  // ("Pick an Ice flavor"), which is the thing a person actually needs to
  // know here. slot_number itself is unchanged in the DB/API/props.
  const section = sectionForSlot(slotNumber)
  const title = section ? `Pick ${articleFor(section.label)} ${section.label} flavor` : 'Pick a flavor'

  // Patch 40: hibernate flavors are hidden by default -- this component
  // remounts fresh every time the picker opens (flavors/page.tsx only
  // renders it while editingSlot !== null), so useState(false) here already
  // resets the toggle each time without any extra effect.
  const [showHibernating, setShowHibernating] = useState(false)
  const visibleFlavors = showHibernating ? flavors : flavors.filter((f) => f.program !== 'hibernate')
  const hiddenHibernateCount = flavors.length - visibleFlavors.length

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-3 flex-shrink-0">
          <h2 className="text-xl font-bold text-gray-900">{title}</h2>
          {currentFlavorName && <p className="text-sm text-gray-500 mt-1">Currently: {currentFlavorName}</p>}
        </div>
        <div className="flex-1 overflow-y-auto px-6 pb-2 flex flex-col gap-2">
          {currentFlavorId && (
            <button
              disabled={busy}
              onClick={() => onPick(null)}
              className="min-h-[48px] bg-red-50 hover:bg-red-100 active:bg-red-200 disabled:opacity-50 text-red-600 font-semibold rounded-xl px-3 py-2 border border-red-100 transition-colors"
            >
              Clear this slot
            </button>
          )}
          {hiddenHibernateCount > 0 && (
            <button
              type="button"
              onClick={() => setShowHibernating((v) => !v)}
              className="min-h-[44px] text-sm font-semibold text-gray-600 border border-gray-300 rounded-xl px-3 flex items-center justify-center gap-1.5"
            >
              {showHibernating
                ? 'Hide hibernating flavors'
                : `Show hibernating flavors (${hiddenHibernateCount})`}
            </button>
          )}
          {groupFlavorsByType(visibleFlavors).map((group) => (
            <div key={group.type}>
              <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-1.5">{FLAVOR_TYPE_LABELS[group.type]}</p>
              <div className="grid grid-cols-2 gap-2">
                {group.flavors.map((f) => (
                  <button
                    key={f.id}
                    disabled={busy}
                    onClick={() => onPick(f.id)}
                    className={`min-h-[52px] font-semibold rounded-xl px-3 py-2 border transition-colors disabled:opacity-50 flex flex-col items-start gap-1 ${
                      f.id === currentFlavorId
                        ? 'bg-[#1a7a3c] text-white border-[#1a7a3c]'
                        : 'bg-green-50 hover:bg-green-100 active:bg-green-200 text-gray-900 border-green-100'
                    }`}
                  >
                    <span>{f.name}</span>
                    {f.program && (
                      <span
                        className={
                          f.id === currentFlavorId
                            ? 'inline-flex items-center gap-1 text-[11px] font-semibold text-white/80 border border-white/40 rounded-full px-2 py-0.5'
                            : PROGRAM_BADGE_CLASS
                        }
                      >
                        <span>{PROGRAM_BADGE_ICON[f.program]}</span>
                        {PROGRAM_LABELS[f.program]}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {visibleFlavors.length === 0 && (
            <p className="text-gray-400 text-sm py-4">
              {flavors.length === 0 ? 'No active flavors in the catalog yet.' : 'No flavors to show -- try "Show hibernating flavors."'}
            </p>
          )}
        </div>
        <div className="px-6 pb-6 pt-3 flex-shrink-0">
          <button onClick={onClose} className="w-full bg-gray-100 hover:bg-gray-200 text-gray-600 font-semibold py-3 rounded-xl">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
