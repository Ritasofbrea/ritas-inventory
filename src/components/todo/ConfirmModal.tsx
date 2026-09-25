'use client'

// Simple "Are you sure?" dialog used before any permanent delete.
export default function ConfirmModal({
  message,
  confirmLabel = 'Delete',
  busy,
  onConfirm,
  onCancel,
}: {
  message: string
  confirmLabel?: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" onClick={busy ? undefined : onCancel}>
      <div
        role="alertdialog"
        aria-label="Are you sure?"
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 className="text-xl font-bold text-gray-900">Are you sure?</h2>
          <p className="text-sm text-gray-600 mt-2">{message}</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={busy}
            className="flex-1 min-h-[48px] bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-600 font-semibold rounded-xl"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 min-h-[48px] bg-[#c8102e] hover:bg-[#a50d26] disabled:opacity-50 text-white font-semibold rounded-xl"
          >
            {busy ? 'Deleting…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
