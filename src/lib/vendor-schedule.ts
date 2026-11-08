// Patch 44: shared vendor-order-schedule date/status logic. Safe for client
// and server (no DB, no Next.js import) — same spirit as src/lib/tasks.ts,
// and reuses its Pacific-time primitives (todayInTZ/weekdayMonday/addDays/
// nowTimeInTZ/toHM) instead of re-deriving DST-safe date math from scratch.
import { weekdayMonday, addDays, nowTimeInTZ, todayInTZ, toHM } from './tasks'

export interface VendorSchedule {
  vendor: string
  order_day: number | null // 0=Sunday..6=Saturday (JS Date.getDay() convention) — NOT tasks.ts's Monday-start convention
  cutoff_time: string
  reminder_start_time: string
  reminder_interval_minutes: number
  override_date: string | null
  active: boolean
}

export interface VendorWeekStatusRow {
  vendor: string
  week_start: string
  status: 'ordered' | 'skipped'
  resolved_by: string | null
  resolved_at: string
}

// Fix (live testing): there is no separate 'resolved' status value anymore.
// `resolvedThisWeek` is now ALWAYS populated whenever the current calendar
// week has an action on file, independent of `status` — `status` describes
// the next ACTIONABLE occurrence (which can roll forward to next week's
// due date, e.g. due_tomorrow on a Sunday after resolving an overdue
// Monday-due vendor), while `resolvedThisWeek` tells the UI "yes, this
// week's press took" so a section can show both at once instead of one
// masking the other.
export type VendorDueStatus = 'anytime' | 'due_today' | 'due_tomorrow' | 'overdue' | 'not_due'

export interface VendorDueInfo {
  vendor: string
  status: VendorDueStatus
  dueDate: string | null // the date this status refers to (null for 'anytime')
  weekStart: string // Monday of the week dueDate falls in (today's week for 'anytime')
  // Resolution of `weekStart` itself — present only when that SAME week
  // (the one status/dueDate describe) is already handled, i.e. status is
  // 'not_due' via the plain "already resolved, nothing more urgent" path.
  // Deliberately null whenever status is due_today/due_tomorrow/overdue —
  // those by definition mean the occurrence being described isn't resolved.
  resolvedThisWeek: VendorWeekStatusRow | null
  // The Sunday-today/Monday-due wraparound case: THIS week (the one that
  // was just overdue) got resolved, but tomorrow's a new due date (next
  // week) that still needs action. `status`/`weekStart` describe that new,
  // unresolved occurrence (so action buttons correctly still show); this
  // field carries the just-resolved PAST week's record so the UI can also
  // show "✓ done" feedback for the press that was just made, instead of
  // that feedback getting silently dropped.
  justResolved: VendorWeekStatusRow | null
}

// Monday (Pacific) of the week containing dateStr.
export function weekStartMonday(dateStr: string): string {
  return addDays(dateStr, -weekdayMonday(dateStr))
}

// 0=Sunday..6=Saturday for dateStr — the convention vendor_schedules.order_day
// uses (matches JS Date.getDay()), which is NOT tasks.ts's Monday-start
// weekdayMonday(). Derived from it rather than reimplemented: Monday(0)->1,
// ..., Sunday(6)->0.
export function pacificWeekdaySunday(dateStr: string): number {
  return (weekdayMonday(dateStr) + 1) % 7
}

// Days after that week's Monday that a Sunday-convention order_day falls on.
// Monday(1)->0, Tuesday(2)->1, ..., Sunday(0)->6.
function offsetFromMonday(orderDay: number): number {
  return (orderDay + 6) % 7
}

// The calendar date, within the week starting weekStart, that a vendor is
// due — or null if that vendor is "anytime" (no order_day and no active
// override) for that week. override_date only applies while it falls
// inside this specific week; otherwise it's ignored (expires by
// comparison, never needs to be cleaned up).
export function dueDateInWeek(schedule: Pick<VendorSchedule, 'order_day' | 'override_date'>, weekStart: string): string | null {
  const weekEnd = addDays(weekStart, 6)
  if (schedule.override_date && schedule.override_date >= weekStart && schedule.override_date <= weekEnd) {
    return schedule.override_date
  }
  if (schedule.order_day === null || schedule.order_day === undefined) return null
  return addDays(weekStart, offsetFromMonday(schedule.order_day))
}

// Core status computation, shared by the Order List UI, the Dashboard line,
// the in-app banner, and the reminder cron — so all four always agree.
// `today`/`nowTime` are injectable for tests (mocked-clock verification);
// default to the real current Pacific moment.
export function computeVendorDueInfo(
  schedule: VendorSchedule,
  weekStatusRows: VendorWeekStatusRow[],
  today: string = todayInTZ(),
  nowTime: string = nowTimeInTZ()
): VendorDueInfo {
  const thisWeekStart = weekStartMonday(today)
  const thisDue = dueDateInWeek(schedule, thisWeekStart)

  const findStatus = (weekStart: string) =>
    weekStatusRows.find((r) => r.vendor === schedule.vendor && r.week_start === weekStart) ?? null

  if (!schedule.active || thisDue === null) {
    return { vendor: schedule.vendor, status: 'anytime', dueDate: null, weekStart: thisWeekStart, resolvedThisWeek: null, justResolved: null }
  }

  const resolvedThisWeek = findStatus(thisWeekStart)

  if (resolvedThisWeek) {
    // This week is handled. The only remaining urgency case is the
    // Sunday-today/Monday-due wraparound, where "tomorrow" belongs to NEXT
    // week's still-unresolved slot even though this week is done. Fix for
    // a live-testing bug: this branch used to drop the resolution record
    // entirely when it jumped to 'due_tomorrow', which made Balford's
    // section on a Sunday look like the press hadn't done anything — the
    // tag correctly moved to "Due tomorrow", but there was no way to also
    // show "✓ done" for the week that actually got acted on. `justResolved`
    // carries that record; `resolvedThisWeek` stays null here on purpose
    // (the NEW occurrence this status/weekStart describes is NOT resolved
    // — that's exactly why it's due_tomorrow and still shows action
    // buttons).
    const nextWeekStart = addDays(thisWeekStart, 7)
    const nextDue = dueDateInWeek(schedule, nextWeekStart)
    const tomorrow = addDays(today, 1)
    if (nextDue && nextDue === tomorrow && !findStatus(nextWeekStart)) {
      return { vendor: schedule.vendor, status: 'due_tomorrow', dueDate: nextDue, weekStart: nextWeekStart, resolvedThisWeek: null, justResolved: resolvedThisWeek }
    }
    return { vendor: schedule.vendor, status: 'not_due', dueDate: thisDue, weekStart: thisWeekStart, resolvedThisWeek, justResolved: null }
  }

  if (today > thisDue) {
    return { vendor: schedule.vendor, status: 'overdue', dueDate: thisDue, weekStart: thisWeekStart, resolvedThisWeek: null, justResolved: null }
  }
  if (today === thisDue) {
    const pastCutoff = nowTime > (toHM(schedule.cutoff_time) as string)
    return { vendor: schedule.vendor, status: pastCutoff ? 'overdue' : 'due_today', dueDate: thisDue, weekStart: thisWeekStart, resolvedThisWeek: null, justResolved: null }
  }
  if (addDays(today, 1) === thisDue) {
    return { vendor: schedule.vendor, status: 'due_tomorrow', dueDate: thisDue, weekStart: thisWeekStart, resolvedThisWeek: null, justResolved: null }
  }
  return { vendor: schedule.vendor, status: 'not_due', dueDate: thisDue, weekStart: thisWeekStart, resolvedThisWeek: null, justResolved: null }
}

// A vendor section stays open (visible, not collapsed) in the Order List
// for any of these; only 'not_due' collapses under "Not due yet".
export function isOpenStatus(status: VendorDueStatus): boolean {
  return status === 'anytime' || status === 'due_today' || status === 'due_tomorrow' || status === 'overdue'
}

// Sort key for the open group: most urgent first, anytime vendors last
// (they have no due date to be urgent about).
export function urgencyRank(status: VendorDueStatus): number {
  if (status === 'overdue') return 0
  if (status === 'due_today') return 1
  if (status === 'due_tomorrow') return 2
  return 3 // anytime
}

// Plain-words due-day label for a schedule editor/header, e.g. "Monday" —
// null for an anytime vendor (order_day null).
const WEEKDAY_SUNDAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export function orderDayLabel(orderDay: number | null): string | null {
  if (orderDay === null || orderDay === undefined) return null
  return WEEKDAY_SUNDAY_FULL[orderDay] ?? null
}

// Display casing for a raw vendor string ("balford" -> "Balford",
// "bunzl" -> "Bunzl") — vendor_schedules.vendor is free text, typed
// lowercase to match items.distributor exactly, so it's never fit to show
// as-is. Fix (live testing): the in-app banner was rendering the raw
// string with no casing applied at all. Capitalizes the first letter of
// each word, which handles any future multi-word vendor name too, rather
// than a hardcoded label map that would need updating per vendor.
export function vendorDisplayLabel(vendor: string): string {
  return vendor.replace(/\b\w/g, (c) => c.toUpperCase())
}

// "12:00 PM" from a "HH:MM" or "HH:MM:SS" time-of-day string — re-exported
// here under a clearer name for callers of this module; same formatter
// tasks.ts already defines and uses for due_time (formatDueTime).
export { formatDueTime as formatTimeOfDay } from './tasks'
