'use client'

// Simple tap-to-enlarge modal for a note's reference photo (patch 22) —
// task-completion photos don't have an in-app lightbox of their own (they
// just open in a new tab), so this is a fresh, minimal pattern rather than
// reusing something that doesn't exist yet.
export default function PhotoLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] p-4"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute top-4 right-4 text-white text-3xl leading-none px-2"
      >
        ×
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt="Note photo"
        className="max-w-full max-h-full rounded-lg object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  )
}
