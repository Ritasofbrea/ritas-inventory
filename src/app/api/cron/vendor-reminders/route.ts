import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { computeVendorDueInfo, VendorSchedule, VendorWeekStatusRow } from '@/lib/vendor-schedule'
import { getItemsNeedingOrderByVendor } from '@/lib/order-list-server'
import { sendPushToSubs, subsForOwnersWithAlert } from '@/lib/push-server'
import { recordReminderSent } from '@/lib/vendor-reminder-server'
import { todayInTZ, nowTimeInTZ, toHM } from '@/lib/tasks'

// Hit every few minutes by a GitHub Actions scheduled workflow (Vercel
// Hobby cron is daily-only — see the Phase 1 report). Same bearer-secret
// auth pattern as the two Vercel-cron routes (generate-tasks,
// cleanup-photos), just invoked by a different scheduler.
//
// Never double-sends or skips on a late/jittery run: the decision is "how
// long since vendor_reminder_log.last_sent_at", not "did a specific clock
// slot just pass" — see add-vendor-schedule-and-pack-size.sql's comment on
// that table (Josh's corrected version: vendor_reminder_log, one row per
// (vendor, week_start), last_sent_at + send_count).
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = getServerSupabase()
  const today = todayInTZ()
  const nowTime = nowTimeInTZ()
  const nowMs = Date.now()

  const { data: schedules, error: schedError } = await db.from('vendor_schedules').select('*').eq('active', true)
  if (schedError) return NextResponse.json({ error: schedError.message }, { status: 500 })
  const rows = (schedules ?? []) as VendorSchedule[]
  if (rows.length === 0) return NextResponse.json({ checked: 0, sent: 0 })

  const vendors = rows.map((r) => r.vendor)
  const [{ data: weekStatus, error: weekError }, byVendorItems] = await Promise.all([
    db.from('vendor_week_status').select('vendor, week_start, status, resolved_by, resolved_at').in('vendor', vendors),
    getItemsNeedingOrderByVendor(db),
  ])
  if (weekError) return NextResponse.json({ error: weekError.message }, { status: 500 })
  const weekStatusRows = (weekStatus ?? []) as VendorWeekStatusRow[]

  let sent = 0
  const skipped: Record<string, string> = {}
  const failed: Record<string, string> = {}

  for (const schedule of rows) {
    const info = computeVendorDueInfo(schedule, weekStatusRows, today, nowTime)

    // Only a due-today or overdue vendor ever reminds. Never 'anytime',
    // 'due_tomorrow', or 'not_due'.
    if (info.status !== 'due_today' && info.status !== 'overdue') {
      skipped[schedule.vendor] = info.status
      continue
    }

    // Daily floor, even while overdue on a later day — no 3am pushes.
    if (nowTime < (toHM(schedule.reminder_start_time) as string)) {
      skipped[schedule.vendor] = 'before reminder_start_time'
      continue
    }

    const itemCount = (byVendorItems[schedule.vendor] ?? []).length
    if (itemCount === 0) {
      skipped[schedule.vendor] = 'nothing to order'
      continue
    }

    const { data: logRow } = await db
      .from('vendor_reminder_log')
      .select('last_sent_at, send_count')
      .eq('vendor', schedule.vendor)
      .eq('week_start', info.weekStart)
      .maybeSingle()

    if (logRow) {
      const elapsedMs = nowMs - new Date(logRow.last_sent_at).getTime()
      if (elapsedMs < schedule.reminder_interval_minutes * 60 * 1000) {
        skipped[schedule.vendor] = 'interval not elapsed'
        continue
      }
    }

    // Patch 47: record the send BEFORE actually sending the push — see
    // recordReminderSent's comment for why this order, not the reverse.
    const record = await recordReminderSent(db, schedule.vendor, info.weekStart, (logRow?.send_count ?? 0) + 1)
    if (!record.ok) {
      console.error(
        `vendor-reminders: failed to record vendor_reminder_log for ${schedule.vendor}/${info.weekStart} -- skipping this tick's push: ${record.error}`
      )
      failed[schedule.vendor] = record.error
      continue
    }

    const subs = await subsForOwnersWithAlert(db, 'order_alerts_enabled')
    const overdue = info.status === 'overdue'
    await sendPushToSubs(db, subs, {
      title: overdue ? `Overdue: ${schedule.vendor} order` : `Order ${schedule.vendor} today`,
      body: `${itemCount} item${itemCount !== 1 ? 's' : ''} to order${overdue ? ' — past the usual cutoff' : ` by ${toHM(schedule.cutoff_time)}`}`,
    })

    sent++
  }

  // A non-200 here is what makes the GitHub Actions step (curl -f) go red
  // on a log-write failure, instead of a silently-swallowed retry loop.
  const hasFailures = Object.keys(failed).length > 0
  return NextResponse.json({ checked: rows.length, sent, skipped, failed }, { status: hasFailures ? 500 : 200 })
}
