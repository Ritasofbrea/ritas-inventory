'use client'

import { Flavor } from '@/lib/flavors'

// Bottom-sheet list of flavor buttons for one week's slot — same pattern as
// StaffPicker, plus a "Clear this slot" option when it's already filled.
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
  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-3 flex-shrink-0">
          <h2 className="text-xl font-bold text-gray-900">Slot {slotNumber}</h2>
          <p className="text-sm text-gray-500 mt-1">
            {currentFlavorName ? `Currently: ${currentFlavorName}` : 'Pick a flavor'}
          </p>
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
          <div className="grid grid-cols-2 gap-2">
            {flavors.map((f) => (
              <button
                key={f.id}
                disabled={busy}
                onClick={() => onPick(f.id)}
                className={`min-h-[52px] font-semibold rounded-xl px-3 py-2 border transition-colors disabled:opacity-50 ${
                  f.id === currentFlavorId
                    ? 'bg-[#1a7a3c] text-white border-[#1a7a3c]'
                    : 'bg-green-50 hover:bg-green-100 active:bg-green-200 text-gray-900 border-green-100'
                }`}
              >
                {f.name}
              </button>
            ))}
            {flavors.length === 0 && (
              <p className="col-span-2 text-gray-400 text-sm py-4">No active flavors in the catalog yet.</p>
            )}
          </div>
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
