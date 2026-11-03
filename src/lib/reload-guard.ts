import { useEffect } from 'react'

// Patch 30: a tiny shared counter any modal, picker, or in-flight
// save/upload can register against, so the auto-reload watcher
// (src/components/AutoReloadWatcher.tsx) knows when it's unsafe to reload.
// Module-level on purpose — no React context needed, since the watcher just
// polls isReloadBlocked() imperatively rather than subscribing to changes.
let blockers = 0

export function isReloadBlocked(): boolean {
  return blockers > 0
}

// Imperative form, for code with no natural "mount while open" component to
// hang a hook off of (e.g. a save request fired from a plain button tap,
// not a modal) — call the returned function when the operation finishes.
export function blockReload(): () => void {
  blockers++
  let released = false
  return () => {
    if (released) return
    released = true
    blockers = Math.max(0, blockers - 1)
  }
}

// Declarative form for modals/pickers: call unconditionally inside a
// component that should only exist while it's "open" (the common pattern in
// this app — `{show && <TheModal />}`), so mount = block, unmount = unblock.
// Also works for a plain boolean that flips over a component's lifetime
// (effect re-runs its cleanup/setup on every change, not just on unmount).
export function useBlockReload(active: boolean): void {
  useEffect(() => {
    if (!active) return
    const unblock = blockReload()
    return unblock
  }, [active])
}
