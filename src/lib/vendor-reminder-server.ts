import type { SupabaseClient } from '@supabase/supabase-js'

// Patch 47: pulled out of the cron route so the failure path (the
// vendor_reminder_log upsert erroring) can be tested directly against a
// stub db, without a live Supabase write. The cron route calls this BEFORE
// sending the push, not after — if the write itself fails, that vendor's
// push is skipped for this tick (safe: the next tick just tries again)
// instead of sending the push and then failing to record it, which is what
// let a vendor get re-reminded every ~10 minutes until the write finally
// stuck.
export async function recordReminderSent(
  db: SupabaseClient,
  vendor: string,
  weekStart: string,
  nextSendCount: number
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await db
    .from('vendor_reminder_log')
    .upsert(
      { vendor, week_start: weekStart, last_sent_at: new Date().toISOString(), send_count: nextSendCount },
      { onConflict: 'vendor,week_start' }
    )
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
