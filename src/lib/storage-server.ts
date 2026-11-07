// Server-only helpers for patch 38's storage stock feature. Every write to
// items.storage_count goes through one of these two functions -- never a
// direct .update() elsewhere -- so the history row and the optimistic
// concurrency guard can't be forgotten at a new call site.
import type { SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type StorageWriteResult<T = {}> = ({ ok: true } & T) | { ok: false; error: string; status: number }

export type StorageMoveKind = 'add' | 'move_to_store' | 'receive_to_storage' | 'correction'

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

// Two quick taps (or two different people) racing the same item's
// storage_count: the UPDATE's .eq('storage_count', storageBefore) only
// applies if nobody else already changed it since we read it. A racer gets
// 0 rows back and retries against the fresh value instead of silently
// double-applying or clobbering the other write.
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

// 'add' (bulk purchase into storage) / 'move_to_store' (internal transfer,
// also bumps current_count) / 'receive_to_storage' (a delivery routed to
// storage instead of the store). amount must be a positive number for all
// three. move_to_store additionally can't exceed what's currently in storage.
export async function applyStorageChange(
  db: SupabaseClient,
  params: { itemId: string; kind: Exclude<StorageMoveKind, 'correction'>; amount: number; byName: string | null; note?: string | null }
): Promise<StorageWriteResult<{ item: Record<string, unknown> }>> {
  const { itemId, kind, amount, byName, note } = params
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'Amount must be a positive number', status: 400 }
  }

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
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
    } else {
      storageAfter = storageBefore + amount
      storeAfter = storeBefore
    }

    const result = await writeStorageChange(db, itemId, kind, storageBefore, storeBefore, storageAfter, storeAfter, amount, byName, note ?? null)
    if (result.ok || result.status !== 409) return result
    // status 409 ("retry") -- someone else changed storage_count since we read it; loop and re-read.
  }

  return { ok: false, error: 'Storage changed concurrently -- please try again', status: 409 }
}

// Reports fix (velocity + par-suggestions): a 'move_to_store' moves
// physical stock from storage into the store without a sale, which would
// otherwise make a naive (startCount - endCount) delta undercount -- or go
// negative on -- true consumption. Both report routes need, per item, every
// move_to_store amount with a timestamp, so they can sum just the ones that
// fall inside that item's own two chosen count-snapshot timestamps and add
// that back into the delta. Returns each item's moves sorted oldest-first;
// `beforeISO` only bounds the query (same upper edge as the item's count
// fetch) -- the per-item window filtering happens in the caller, since each
// item's actual start/end snapshot timestamps differ.
export async function fetchMoveToStoreHistory(
  db: SupabaseClient,
  itemIds: string[],
  beforeISO: string
): Promise<Record<string, { amount: number; ts: number }[]>> {
  if (itemIds.length === 0) return {}
  const { data, error } = await db
    .from('storage_moves')
    .select('item_id, amount, created_at')
    .eq('kind', 'move_to_store')
    .in('item_id', itemIds)
    .lte('created_at', beforeISO)
    .order('created_at', { ascending: true })
  if (error || !data) return {}

  const byItem: Record<string, { amount: number; ts: number }[]> = {}
  for (const row of data as { item_id: string; amount: number; created_at: string }[]) {
    if (!byItem[row.item_id]) byItem[row.item_id] = []
    byItem[row.item_id].push({ amount: Number(row.amount), ts: new Date(row.created_at).getTime() })
  }
  return byItem
}

// Sums a window's worth of fetchMoveToStoreHistory's per-item moves: every
// move with fromExclusiveTs < ts <= toInclusiveTs. Matches the exact two
// snapshot timestamps a report route picked for that item, not the
// caller's broader requested date range.
export function sumMovesInWindow(moves: { amount: number; ts: number }[] | undefined, fromExclusiveTs: number, toInclusiveTs: number): number {
  if (!moves) return 0
  return moves.reduce((sum, m) => (m.ts > fromExclusiveTs && m.ts <= toInclusiveTs ? sum + m.amount : sum), 0)
}

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

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const current = await readItemStorage(db, itemId)
    if (!current) return { ok: false, error: 'Item not found', status: 404 }
    if (!current.has_storage) return { ok: false, error: 'Item does not have storage enabled', status: 400 }

    const storageBefore = Number(current.storage_count)
    const storeBefore = Number(current.current_count)
    const amount = newValue - storageBefore

    const result = await writeStorageChange(db, itemId, 'correction', storageBefore, storeBefore, newValue, storeBefore, amount, byName, note ?? null)
    if (result.ok || result.status !== 409) return result
  }

  return { ok: false, error: 'Storage changed concurrently -- please try again', status: 409 }
}
