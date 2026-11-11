import type { SupabaseClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'

const WINDOW_MINUTES = 15
const MAX_FAILURES = 10

// First entry of x-forwarded-for is the original client IP Vercel saw;
// later entries are intermediate proxies. Falls back to a constant string
// (shared bucket) if the header is ever missing, which only matters locally.
export function clientIp(request: NextRequest): string {
  const header = request.headers.get('x-forwarded-for')
  if (header) return header.split(',')[0].trim()
  return 'unknown'
}

// Checks failures from this IP in the last 15 minutes against login_attempts
// (add-login-attempts.sql). Does NOT record anything itself — callers record
// the actual attempt (success or failure) separately via recordLoginAttempt,
// after they know the outcome.
export async function isRateLimited(db: SupabaseClient, ip: string): Promise<boolean> {
  const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString()
  const { count } = await db
    .from('login_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('ip', ip)
    .eq('success', false)
    .gte('attempted_at', since)
  return (count ?? 0) >= MAX_FAILURES
}

export async function recordLoginAttempt(db: SupabaseClient, ip: string, success: boolean): Promise<void> {
  await db.from('login_attempts').insert({ ip, success })
}

// 7-day purge, called from the nightly cleanup-photos cron (patch 29 B9) —
// no new cron job/vercel.json change needed for this.
export async function cleanupOldLoginAttempts(db: SupabaseClient): Promise<number> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await db.from('login_attempts').delete().lt('attempted_at', cutoff).select('id')
  if (error) throw new Error(error.message)
  return data?.length ?? 0
}

// Patch 63: invoice scanning limit. Not tied to login_attempts -- counts
// invoices created in the last 15 minutes (any status). The store scans a
// handful of invoices a week, so 20 per window only ever stops a runaway
// client or a leaked session, never real use. Combined with the per-draft
// page cap (MAX_INVOICE_PAGES) and the "uploads only to a fresh draft"
// rule in /api/invoices/photo-upload, this bounds how many signed upload
// URLs can ever be handed out.
const INVOICE_WINDOW_MINUTES = 15
const MAX_INVOICES_PER_WINDOW = 20

export async function isInvoiceScanRateLimited(db: SupabaseClient): Promise<boolean> {
  const since = new Date(Date.now() - INVOICE_WINDOW_MINUTES * 60 * 1000).toISOString()
  const { count, error } = await db
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', since)
  // Fail closed: if the count itself can't be read, don't hand out uploads.
  if (error) return true
  return (count ?? 0) >= MAX_INVOICES_PER_WINDOW
}
