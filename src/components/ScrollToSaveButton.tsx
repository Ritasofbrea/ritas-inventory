'use client'

import { RefObject, useEffect, useState } from 'react'

// Floating "scroll to Save" button -- appears once its target (the Save/
// Submit area) scrolls out of view, and smooth-scrolls it back into view on
// tap. Previously duplicated verbatim between Count and Receive Order
// (patch 34: extracted here so there's never a third copy-pasted version;
// this is NOT the generic back-to-top button -- see BackToTop.tsx -- it
// jumps to a specific target further down the page, not to the top).
//
// `retryKey`: pass something that changes whenever the target element might
// mount/unmount independently of this component (e.g. Receive Order's
// wizard `step`, since the target div only exists during one step) so the
// observer re-attaches. Omit it on a page where the target mounts once and
// stays mounted (e.g. Count, gated only by its own one-time loading flag).
export default function ScrollToSaveButton({
  targetRef,
  show = true,
  retryKey,
}: {
  targetRef: RefObject<HTMLElement | null>
  show?: boolean
  retryKey?: unknown
}) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = targetRef.current
    if (!el) return
    const obs = new IntersectionObserver(([e]) => setVisible(!e.isIntersecting), { threshold: 0.1 })
    obs.observe(el)
    return () => obs.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- targetRef is a stable ref object; retryKey is the intentional re-attach signal
  }, [retryKey])

  const scrollToTarget = () => {
    targetRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  if (!visible || !show) return null

  return (
    <button
      onClick={scrollToTarget}
      className="fixed bottom-6 right-5 z-40 bg-[#c8102e] hover:bg-[#a00d24] active:bg-[#7a0a1b] text-white w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-colors"
      aria-label="Scroll to save"
    >
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
      </svg>
    </button>
  )
}
