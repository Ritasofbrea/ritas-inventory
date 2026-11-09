// Server-only helpers for patch 38's storage stock feature, and (patch 48)
// the shared optimistic-concurrency primitive every write to items.
// current_count/storage_count should go through -- never a direct
// .update() elsewhere -- so the history row and the retry-on-conflict
// guard can't be forgotten at a new call site.
import type { SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type StorageWriteResult<T = {}> = ({ ok: true } & T) | { ok: false; error: string; status: number }

export type StorageMoveKind = 'add' | 'move_to_store' | 'receive_to_storage' | 'correction' | 'move_to_storage'

interface ItemStorageRow {
  id: string
  current_count: number
  storage_count: number
  has_storage: boolean
}

async function readItemStorage(db: SupabaseClient, itemId: string): Promise<ItemStorageRow | null> {
  const { data } = await db.from('items').select('id, current_count, storage_count, has_storage').eq('id', itemId).maybeSingle()
  return (data as ItemStorageRow) ?? null
}

const MAX_RETRIES = 3

// Patch 48: the one place "try up to MAX_RETRIES times, give up with a
// clear conflict error" lives -- attempt() returns a result with
// status 409 to mean "stale read, retry against a fresh one"; anything
// else (ok, or a non-409 error) returns immediately. Shared by every
// count-column writer below, and by the receive-order non-storage
// increment (applyCurrentCountIncrement) -- the actual CAS mechanics stay
// in each attempt(), only the retry control flow is shared, so this can't
// drift into two slightly-different retry loops.
async function withRetry<T extends { ok: boolean; status?: number }>(attempt: () => Promise<T>, onExhausted: () => T): Promise<T> {
  for (let i = 0; i < MAX_RETRIES; i++) {
    const result = await attempt()
    if (result.ok || result.status !== 409) return result
  }
  return onExhausted()
}

// Two quick taps (or two different people) racing the same item's storage
// or store count: the UPDATE's .eq(...) guards on BOTH columns we read, so
// it only applies if neither changed since we read them. Patch 39: widened
// from storage_count alone -- move_to_storage validates against
// current_count, so a concurrent weekly Count submission (which only
// touches current_count) must also be caught, not just a racing storage
// write. A racer gets 0 rows back and retries against fresh values instead
// of silently double-applying or clobbering the other write.
async function writeStorageChange(
  db: SupabaseClient,
  itemId: string,
  kind: StorageMoveKind,
  storageBefore: number,
  storeBefore: number,
  storageAfter: number,
  storeAfter: number,
  amount: number,
  byName: string | null,
  note: string | null
): Promise<StorageWriteResult<{ item: Record<string, unknown> }>> {
  const now = new Date().toISOString()
  const { data: updated, error: updateError } = await db
    .from('items')
    .update({ storage_count: storageAfter, current_count: storeAfter, storage_updated_at: now })
    .eq('id', itemId)
    .eq('storage_count', storageBefore)
    .eq('current_count', storeBefore)
    .select()
    .maybeSingle()

  if (updateError) return { ok: false, error: updateError.message, status: 500 }
  if (!updated) return { ok: false, error: 'retry', status: 409 }

  const { error: historyError } = await db.from('storage_moves').insert({
    item_id: itemId,
    kind,
    amount,
    store_before: storeBefore,
    store_after: storeAfter,
    storage_before: storageBefore,
    storage_after: storageAfter,
    by_name: byName,
    note: note || null,
  })
  if (historyError) return { ok: false, error: historyError.message, status: 500 }

  return { ok: true, item: updated }
}

// 'add' (bulk purchase into storage) / 'move_to_store' (internal transfer
// storage -> store) / 'move_to_storage' (internal transfer store ->
// storage, patch 39) / 'receive_to_storage' (a delivery routed to storage
// instead of the store). amount must be a positive number for all four.
// move_to_store can't exceed what's currently in storage; move_to_storage
// can't exceed what's currently in the store.
export async function applyStorageChange(
  db: SupabaseClient,
  params: { itemId: string; kind: Exclude<StorageMoveKind, 'correction'>; amount: number; byName: string | null; note?: string | null }
): Promise<StorageWriteResult<{ item: Record<string, unknown> }>> {
  const { itemId, kind, amount, byName, note } = params
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'Amount must be a positive number', status: 400 }
  }

  return withRetry(
    async () => {
      const current = await readItemStorage(db, itemId)
      if (!current) return { ok: false, error: 'Item not found', status: 404 }
      if (!current.has_storage) return { ok: false, error: 'Item does not have storage enabled', status: 400 }

      const storageBefore = Number(current.storage_count)
      const storeBefore = Number(current.current_count)

      let storageAfter: number
      let storeAfter: number
      if (kind === 'move_to_store') {
        if (amount > storageBefore) return { ok: false, error: 'Amount exceeds what is in storage', status: 400 }
        storageAfter = storageBefore - amount
        storeAfter = storeBefore + amount
      } else if (kind === 'move_to_storage') {
        if (amount > storeBefore) return { ok: false, error: 'Amount exceeds what is in the store', status: 400 }
        storageAfter = storageBefore + amount
        storeAfter = storeBefore - amount
      } else {
        storageAfter = storageBefore + amount
        storeAfter = storeBefore
      }

      // status 409 ("retry") -- someone else changed storage_count or current_count since we read them; withRetry loops and re-reads.
      return writeStorageChange(db, itemId, kind, storageBefore, storeBefore, storageAfter, storeAfter, amount, byName, note ?? null)
    },
    () => ({ ok: false, error: 'Storage changed concurrently -- please try again', status: 409 })
  )
}

// Patch 39: the move-history-for-reports helpers that used to live here
// (fetchMoveToStoreHistory/sumMovesInWindow) were replaced by the broader
// fetchStoreFlowHistory/sumFlowInWindow in src/lib/usage-server.ts, which
// also accounts for deliveries and the new move_to_storage kind.

// Owner sets storage to an exact number (fixing a miscount). Unlike the
// kinds above, the signed delta (can be negative) is itself the history
// row's `amount` -- there's no separate "how much" the owner enters.
export async function applyStorageCorrection(
  db: SupabaseClient,
  params: { itemId: string; newValue: number; byName: string | null; note?: string | null }
): Promise<StorageWriteResult<{ item: Record<string, unknown> }>> {
  const { itemId, newValue, byName, note } = params
  if (typeof newValue !== 'number' || !Number.isFinite(newValue) || newValue < 0) {
    return { ok: false, error: 'New storage value must be zero or a positive number', status: 400 }
  }

  return withRetry(
    async () => {
      const current = await readItemStorage(db, itemId)
      if (!current) return { ok: false, error: 'Item not found', status: 404 }
      if (!current.has_storage) return { ok: false, error: 'Item does not have storage enabled', status: 400 }

      const storageBefore = Number(current.storage_count)
      const storeBefore = Number(current.current_count)
      const amount = newValue - storageBefore

      return writeStorageChange(db, itemId, 'correction', storageBefore, storeBefore, newValue, storeBefore, amount, byName, note ?? null)
    },
    () => ({ ok: false, error: 'Storage changed concurrently -- please try again', status: 409 })
  )
}

// Patch 48: a single-column version of the same read-guard-retry shape as
// writeStorageChange above, for items where a plain delivery just goes
// straight into current_count (not routed to storage) -- the receive-order
// race the audit found. Also used, with a negative delta, to roll a
// receipt's already-applied increments back if a LATER item in the same
// receipt can't be applied (see order-history/route.ts) -- one function,
// not a second copy that could drift from this one.
async function applyColumnDelta(
  db: SupabaseClient,
  itemId: string,
  column: 'current_count' | 'storage_count',
  delta: number
): Promise<StorageWriteResult<{ item: Record<string, unknown> }>> {
  return withRetry(
    async () => {
      const { data: current, error: readError } = await db.from('items').select(`id, ${column}`).eq('id', itemId).maybeSingle()
      if (readError) return { ok: false, error: readError.message, status: 500 }
      if (!current) return { ok: false, error: 'Item not found', status: 404 }

      const before = Number((current as Record<string, unknown>)[column])
      const after = before + delta

      const { data: updated, error: updateError } = await db
        .from('items')
        .update({ [column]: after })
        .eq('id', itemId)
        .eq(column, before)
        .select()
        .maybeSingle()

      if (updateError) return { ok: false, error: updateError.message, status: 500 }
      if (!updated) return { ok: false, error: 'retry', status: 409 }
      return { ok: true, item: updated }
    },
    () => ({ ok: false, error: 'Stock changed concurrently -- please try again', status: 409 })
  )
}

// Public, positive-only entry point for a normal non-storage receive.
// Rollback compensation (route.ts) calls applyColumnDelta directly with a
// negative delta instead, since this one rejects non-positive amounts.
export async function applyCurrentCountIncrement(
  db: SupabaseClient,
  params: { itemId: string; amount: number }
): Promise<StorageWriteResult<{ item: Record<string, unknown> }>> {
  const { itemId, amount } = params
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'Amount must be a positive number', status: 400 }
  }
  return applyColumnDelta(db, itemId, 'current_count', amount)
}

// Exported for the rollback-compensation use above (negative deltas on
// current_count or storage_count) -- never for a normal positive write;
// use applyCurrentCountIncrement or applyStorageChange for those so the
// positive-amount validation isn't bypassed.
export async function applyRawCountDelta(
  db: SupabaseClient,
  params: { itemId: string; column: 'current_count' | 'storage_count'; delta: number }
): Promise<StorageWriteResult<{ item: Record<string, unknown> }>> {
  const { itemId, column, delta } = params
  if (typeof delta !== 'number' || !Number.isFinite(delta) || delta === 0) {
    return { ok: false, error: 'Delta must be a non-zero number', status: 400 }
  }
  return applyColumnDelta(db, itemId, column, delta)
}
