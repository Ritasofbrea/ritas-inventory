// Patch 44 fix: pure-logic regression for computeVendorDueInfo
// (src/lib/vendor-schedule.ts) and computeWeeksLeft (src/lib/weeks-left.ts).
// No DB, no localhost server, no Supabase — these are the same mocked-
// clock scenarios used to confirm the live-testing fixes:
//   1. Pressing "Order Placed"/"Nothing to order" always surfaces as
//      resolved somewhere the UI can show it, including the Sunday/Monday
//      wraparound (resolving a Monday-due vendor on Sunday rolls the
//      status forward to next week's "due_tomorrow" but must still carry
//      the just-made resolution so the UI doesn't look like the press did
//      nothing).
//   2. 8+ weeks caps the display; thin data (short elapsed window) hides
//      it entirely rather than showing a long, possibly-wrong number.
// Run via tsx (not plain node) — vendor-schedule.ts/tasks.ts use
// extensionless relative imports, which only bundler-style resolution
// (tsx, Next.js/Turbopack) handles; plain `node` ESM resolution does not.
import { computeVendorDueInfo } from '../../src/lib/vendor-schedule.ts'
import { computeWeeksLeft, WEEKS_LEFT_CAP, WEEKS_LEFT_MIN_ELAPSED_DAYS } from '../../src/lib/weeks-left.ts'

let failures = 0
const check = (name, cond) => {
  if (cond) console.log(`ok - ${name}`)
  else {
    console.log(`FAIL - ${name}`)
    failures++
  }
}

const DAY_MS = 24 * 60 * 60 * 1000

const balford = { vendor: 'balford', order_day: 1, cutoff_time: '11:30', reminder_start_time: '08:00', reminder_interval_minutes: 30, override_date: null, active: true }
const bunzl = { vendor: 'bunzl', order_day: 2, cutoff_time: '11:30', reminder_start_time: '08:00', reminder_interval_minutes: 30, override_date: null, active: true }
const anytime = { vendor: 'other-vendor', order_day: null, cutoff_time: '11:30', reminder_start_time: '08:00', reminder_interval_minutes: 30, override_date: null, active: true }

// Real calendar anchor used throughout: 2026-11-02 is confirmed (via the
// live /api/vendor-schedules response during this fix) to be a Monday.
const MON = '2026-11-02'
const WED = '2026-11-04'
const FRI = '2026-11-06'
const SUN = '2026-11-01' // the Sunday BEFORE MON

function run() {
  // --- Basic status transitions (regression for the original design) ---
  check('anytime vendor -> anytime', computeVendorDueInfo(anytime, [], MON, '09:00').status === 'anytime')
  check('balford on Monday before cutoff -> due_today', computeVendorDueInfo(balford, [], MON, '09:00').status === 'due_today')
  check('balford on Monday after cutoff -> overdue', computeVendorDueInfo(balford, [], MON, '12:00').status === 'overdue')
  check('balford on Sunday before Monday, unresolved -> overdue (last week never actioned)', computeVendorDueInfo(balford, [], SUN, '09:00').status === 'overdue')
  check('bunzl on Monday (due Tuesday) -> due_tomorrow', computeVendorDueInfo(bunzl, [], MON, '09:00').status === 'due_tomorrow')
  check('balford on Wednesday, unresolved all week -> overdue', computeVendorDueInfo(balford, [], WED, '09:00').status === 'overdue')
  check('balford on Friday, unresolved all week -> still overdue (never reverts to not_due mid-week)', computeVendorDueInfo(balford, [], FRI, '09:00').status === 'overdue')

  // --- Fix 1: pressing an action always surfaces somewhere, incl. the
  // Sunday/Monday wraparound that was silently dropping it ---

  // Resolve balford's CURRENT (just-passed, overdue) week, then check the
  // Sunday before it rolls to next Monday.
  const resolvedThisWeekRow = { vendor: 'balford', week_start: '2026-10-26', status: 'ordered', resolved_by: 'Josh', resolved_at: '2026-11-01T10:00:00Z' }
  // 2026-11-01 (SUN) belongs to the week starting 2026-10-26.
  const sunAfterResolving = computeVendorDueInfo(balford, [resolvedThisWeekRow], SUN, '09:00')
  check('Sunday, this week resolved, tomorrow (Monday) is a fresh due date -> due_tomorrow', sunAfterResolving.status === 'due_tomorrow')
  check('...AND resolvedThisWeek is null (the fresh Monday is genuinely unresolved -- buttons must show)', sunAfterResolving.resolvedThisWeek === null)
  check('...AND justResolved carries the press that was just made (fix for the live-testing bug)', sunAfterResolving.justResolved?.resolved_by === 'Josh')

  // Resolve Monday's (this) week on a Wednesday -- no wraparound applies
  // (Tuesday/Wednesday aren't "tomorrow" relative to next Monday), so it
  // should read as plain resolved-via-resolvedThisWeek.
  const resolvedCurrentWeek = { vendor: 'balford', week_start: MON, status: 'skipped', resolved_by: 'Gina', resolved_at: '2026-11-04T10:00:00Z' }
  const wedAfterResolving = computeVendorDueInfo(balford, [resolvedCurrentWeek], WED, '09:00')
  check('Wednesday, this week resolved, next Monday is not tomorrow -> not_due', wedAfterResolving.status === 'not_due')
  check('...AND resolvedThisWeek carries the press (plain case)', wedAfterResolving.resolvedThisWeek?.resolved_by === 'Gina')
  check('...AND no action buttons needed -> justResolved is null (not the active path)', wedAfterResolving.justResolved === null)

  // Bunzl (Tuesday-due), resolved this week, checked on Monday -- Tuesday
  // IS tomorrow, but it's the SAME week (not a wraparound to next week),
  // so this should be the plain resolvedThisWeek path, not due_tomorrow.
  const bunzlResolvedThisWeek = { vendor: 'bunzl', week_start: MON, status: 'ordered', resolved_by: 'Josh', resolved_at: '2026-11-02T09:00:00Z' }
  const bunzlMonAfterResolving = computeVendorDueInfo(bunzl, [bunzlResolvedThisWeek], MON, '09:00')
  check('bunzl resolved Tuesday this week, checked Monday -> not_due (not a wraparound)', bunzlMonAfterResolving.status === 'not_due')
  check('...resolvedThisWeek carries the press', bunzlMonAfterResolving.resolvedThisWeek?.resolved_by === 'Josh')

  // --- Monday morning: a vendor due TODAY, fresh week, nothing resolved
  // yet -- the exact scenario Josh asked to check explicitly. ---
  const mondayMorning = computeVendorDueInfo(balford, [], MON, '07:45')
  check('Monday morning 07:45 (before 08:00 reminder_start_time), unresolved -> due_today', mondayMorning.status === 'due_today')
  check('Monday morning: resolvedThisWeek/justResolved both null (nothing pressed yet)', mondayMorning.resolvedThisWeek === null && mondayMorning.justResolved === null)

  // --- Full week-long Sunday->Monday simulation: resolve on Sunday,
  // confirm the SAME vendor, walked day by day, never again says
  // "overdue" with nothing marked (the banner's reported symptom) ---
  const sundayPressRow = { vendor: 'balford', week_start: '2026-10-26', status: 'skipped', resolved_by: 'Josh', resolved_at: '2026-11-01T18:00:00Z' }
  const afterSundayPress = computeVendorDueInfo(balford, [sundayPressRow], SUN, '19:00')
  check('after a Sunday press, Sunday evening -> due_tomorrow, never overdue', afterSundayPress.status === 'due_tomorrow' && afterSundayPress.status !== 'overdue')
  // Monday itself, that same resolution no longer applies to THIS week
  // (it belongs to the week before) -- today IS the due day, unresolved.
  const mondayAfterSundayPress = computeVendorDueInfo(balford, [sundayPressRow], MON, '07:00')
  check('the day after (Monday), the old Sunday press does not silence the NEW week -> due_today', mondayAfterSundayPress.status === 'due_today')
}

function runWeeksLeft() {
  console.log('\n--- weeks-left ---')
  // Lemon-shaped: raw ~24 weeks (real data from live testing) -- well
  // above the cap, so it must show "8+ weeks left", NOT the real ~24. This
  // is exactly the point of the cap: a technically-accurate 24 still isn't
  // a number worth trusting that far out, and must never read as "plenty
  // of time, don't bother" with false precision.
  const lemon = computeWeeksLeft({ totalStock: 1.5, consumed: 0.25, flagged: false, elapsedMs: 28 * DAY_MS })
  check('Lemon-shaped input (raw ~24) -> capped at 8+', lemon.weeks_left === WEEKS_LEFT_CAP && lemon.capped)

  // Root Beer-shaped: ~2.4 weeks -- not capped, not hidden.
  const rootBeer = computeWeeksLeft({ totalStock: 1.5, consumed: 2.5, flagged: false, elapsedMs: 28 * DAY_MS })
  check('Root Beer-shaped input -> ~2.4 weeks, not capped', rootBeer.weeks_left === 2.4 && !rootBeer.capped)

  // A genuinely slow-moving item -- raw weeks far above the cap -> shows "8+", not the real (possibly wrong) number.
  const slowMover = computeWeeksLeft({ totalStock: 40, consumed: 1, flagged: false, elapsedMs: 28 * DAY_MS })
  check('raw weeks far above cap -> capped at 8, capped=true', slowMover.weeks_left === WEEKS_LEFT_CAP && slowMover.capped)

  // Thin data: only 3 days of real elapsed time between the two count
  // records -- hidden regardless of how extreme the resulting rate would be.
  const thin = computeWeeksLeft({ totalStock: 5, consumed: 1, flagged: false, elapsedMs: 3 * DAY_MS })
  check(`thin data (<${WEEKS_LEFT_MIN_ELAPSED_DAYS} days elapsed) -> hidden`, thin.weeks_left === null)

  // Exactly at the minimum elapsed-time boundary -- allowed through.
  const atBoundary = computeWeeksLeft({ totalStock: 5, consumed: 1, flagged: false, elapsedMs: WEEKS_LEFT_MIN_ELAPSED_DAYS * DAY_MS })
  check('exactly at the minimum elapsed days -> not hidden', atBoundary.weeks_left !== null)

  // Flagged (anomalous negative-after-correction consumption) -- hidden.
  const flaggedCase = computeWeeksLeft({ totalStock: 5, consumed: -2, flagged: true, elapsedMs: 28 * DAY_MS })
  check('flagged anomaly -> hidden', flaggedCase.weeks_left === null)

  // Zero/negative rate (nothing actually consumed) -- hidden, never "infinity weeks".
  const noConsumption = computeWeeksLeft({ totalStock: 10, consumed: 0, flagged: false, elapsedMs: 28 * DAY_MS })
  check('zero consumption -> hidden (not an infinite/huge number)', noConsumption.weeks_left === null)
}

run()
runWeeksLeft()
console.log(failures === 0 ? '\nALL PASSED (including weeks-left)' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
