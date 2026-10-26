'use client'

import { useLayoutEffect, useRef, useState } from 'react'

// Clamps long note content to ~5 lines by default (CSS line-clamp), with a
// "Show more"/"Show less" toggle that only appears when the content actually
// overflows that clamp — measured via scrollHeight vs clientHeight, not a
// naive character/line count, so it stays correct across card width and
// font-size. Expand state is local to this card and intentionally not
// persisted — collapsing back on reload is fine (patch 19).
export default function TruncatedNoteContent({ content, handled }: { content: string; handled: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const ref = useRef<HTMLParagraphElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || expanded) return
    const measure = () => setOverflowing(el.scrollHeight > el.clientHeight + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [content, expanded])

  return (
    <div className="flex-1 min-w-0">
      <p
        ref={ref}
        className={`text-gray-900 whitespace-pre-wrap ${handled ? 'line-through text-gray-400' : ''} ${expanded ? '' : 'line-clamp-5'}`}
      >
        {content}
      </p>
      {(overflowing || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="text-xs font-semibold text-blue-600 hover:text-blue-700 mt-0.5"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}
