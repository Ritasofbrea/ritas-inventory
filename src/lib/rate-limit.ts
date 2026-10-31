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
