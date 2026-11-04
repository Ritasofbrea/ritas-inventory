'use client'

import { useEffect, useRef, useState } from 'react'

const SHOW_AFTER_RATIO = 0.8 // "a screen or so" of scroll before it appears

// Shared scroll-to-top button (patch 34), for any page long enough to need
// one on the store's ViewSonic touchscreen (no keyboard/mouse, so a quick
// tap back to the top matters). Distinct from Count's existing "scroll to
// Save" button and Todo's inline "Jump to Tasks" link -- those jump to a
// specific spot further down the page and are untouched; this one always
// goes to the very top and is the exact same component everywhere it's
// used, so it can't drift between pages.
//
// `bottomOffsetPx` only exists so this button can get out of the way of
// Count's and Receive Order's own floating "scroll to Save" button, which
// already sits in the default bottom-right spot -- per the brief, this
// button is the one that moves, never the other.
//
// Plain `fixed` positioning (removed from layout flow) so it never causes a
// layout shift when it appears or disappears. Tapping it is an ordinary
// pointerdown/scroll, both of which the auto-reload watcher (patch 30)
// already treats as activity on its own -- nothing extra to wire up there.
export default function BackToTop({ bottomOffsetPx = 24 }: { bottomOffsetPx?: number }) {
  const [visible, setVisible] = useState(false)
  const tickingRef = useRef(false)

  useEffect(() => {
    const onScroll = () => {
      if (tickingRef.current) return
      tickingRef.current = true
      requestAnimationFrame(() => {
        // A page only somewhat taller than the viewport can never reach
        // innerHeight * SHOW_AFTER_RATIO at all -- its max possible scrollY
        // (scrollHeight - innerHeight) is smaller than that, so the button
        // would never appear no matter how far down you scroll. Capping the
        // threshold at most halfway into whatever's actually scrollable
        // keeps "a screen or so" as the normal case on a long page, while
        // staying reachable on a shorter one.
        const maxScrollable = document.documentElement.scrollHeight - window.innerHeight
        const threshold = Math.min(window.innerHeight * SHOW_AFTER_RATIO, maxScrollable * 0.5)
        setVisible(maxScrollable > 0 && window.scrollY > threshold)
        tickingRef.current = false
      })
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  if (!visible) return null

  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      aria-label="Back to top"
      style={{ bottom: bottomOffsetPx }}
      className="fixed right-5 z-40 bg-[#1a7a3c] hover:bg-[#155f2f] active:bg-[#0f4a26] text-white w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-colors"
    >
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" />
      </svg>
    </button>
  )
}
