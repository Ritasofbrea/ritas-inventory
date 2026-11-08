// Patch 44 fix: pure "about N weeks left" math, pulled out of the API
// route so it's directly unit-testable with plain numbers (no DB, no
// clock). Two safety rules Josh asked for after live testing:
//   1. Hide (never show a number) when the data behind the rate is thin —
//      specifically, less than a week of real elapsed time between the
//      two count records used to compute it. A single miscount or odd
//      timing that close together can swing the rate wildly, and a wrong
//      long number must never talk her out of ordering.
//   2. Cap the DISPLAYED number at "8+ weeks" — once there's clearly
//      plenty of runway, a precise (and more extrapolation-prone) count
//      stops being useful and starts being a false-confidence risk.
export const WEEKS_LEFT_WINDOW_DAYS = 28
export const WEEKS_LEFT_MIN_ELAPSED_DAYS = 7
export const WEEKS_LEFT_CAP = 8

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

export interface WeeksLeftResult {
  weeks_left: number | null // null = hide the line entirely
  capped: boolean // true -> client shows "8+ weeks left" literally, ignoring the exact number
}

export function computeWeeksLeft(params: {
  totalStock: number
  consumed: number
  flagged: boolean
  elapsedMs: number
}): WeeksLeftResult {
  const { totalStock, consumed, flagged, elapsedMs } = params
  const hide: WeeksLeftResult = { weeks_left: null, capped: false }

  const elapsedDays = elapsedMs / DAY_MS
  if (elapsedDays < WEEKS_LEFT_MIN_ELAPSED_DAYS) return hide
  if (flagged) return hide

  const weeklyRate = elapsedMs > 0 ? consumed / (elapsedMs / WEEK_MS) : null
  if (weeklyRate === null || weeklyRate <= 0) return hide

  const raw = totalStock / weeklyRate
  if (raw >= WEEKS_LEFT_CAP) return { weeks_left: WEEKS_LEFT_CAP, capped: true }
  return { weeks_left: Math.round(raw * 10) / 10, capped: false }
}
