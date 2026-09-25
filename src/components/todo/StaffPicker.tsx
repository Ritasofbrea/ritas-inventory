'use client'

import { Staff } from '@/lib/tasks'

// Bottom-sheet list of big name buttons — no typing, one tap picks a name.
export default function StaffPicker({
  staff,
  title,
  busy,
  onPick,
  onClose,
}: {
  staff: Staff[]
  title: string
  busy?: boolean
  onPick: (name: string) => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-3 flex-shrink-0">
          <h2 className="text-xl font-bold text-gray-900">{title}</h2>
          <p className="text-sm text-gray-500 mt-1">Tap your name</p>
        </div>
        <div className="flex-1 overflow-y-auto px-6 pb-2 grid grid-cols-2 gap-2 content-start">
          {staff.map((s) => (
            <button
              key={s.id}
              disabled={busy}
              onClick={() => onPick(s.name)}
              className="min-h-[52px] bg-green-50 hover:bg-green-100 active:bg-green-200 disabled:opacity-50 text-gray-900 font-semibold rounded-xl px-3 py-2 border border-green-100 transition-colors"
            >
              {s.name}
            </button>
          ))}
          {staff.length === 0 && <p className="col-span-2 text-gray-400 text-sm py-4">No staff names yet.</p>}
        </div>
        <div className="px-6 pb-6 pt-3 flex-shrink-0">
          <button
            onClick={onClose}
            className="w-full bg-gray-100 hover:bg-gray-200 text-gray-600 font-semibold py-3 rounded-xl"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
