// Patch 44 follow-up: switching a vendor's week mark between "Order
// Placed" and "Nothing to order", and "Undo" clearing it back to
// pending — both directions, plus the audit trail
// (vendor_week_status_log, supabase/add-vendor-week-status-log.sql).
// Uses 'ZZTEST Vendor' (no real vendor_schedules row, but
// vendor_week_status/vendor_week_status_log have no FK requiring one) so
// nothing real is ever touched. Cleans up its own fixture either way.
//
// The log table's migration may not have been run yet — this script
// checks for it first and treats the log-specific assertions as
// non-fatal (reported, not failed) if it's missing, since the core
// switch/undo behavior never depends on that table existing.
import { apiFetch, loginAsOwner } from './helpers/auth.mjs'
import { rest } from './helpers/rest.mjs'

let failures = 0
const check = (name, cond) => {
  if (cond) console.log(`ok - ${name}`)
  else {
    console.log(`FAIL - ${name}`)
    failures++
  }
}

const VENDOR = 'ZZTEST Vendor'

async function currentWeekStart(owner) {
  // Derived the same way the server does: no public endpoint exposes it
  // directly, so read it back off whatever row this script itself just
  // wrote (every POST/DELETE below echoes week_start in its response, or
  // via the log).
  const res = await apiFetch('/api/vendor-week-status', owner.cookie, {
    method: 'POST',
    body: JSON.stringify({ vendor: VENDOR, status: 'skipped' }),
  })
  const row = await res.json()
  return row.week_start
}

async function logRowsFor(weekStart) {
  try {
    return await rest(`vendor_week_status_log?vendor=eq.${encodeURIComponent(VENDOR)}&week_start=eq.${weekStart}&order=at.asc`)
  } catch (e) {
    if (String(e.message).includes('404') || String(e.message).includes('42P01') || String(e.message).includes('does not exist')) return null
    throw e
  }
}

async function run() {
  const owner = await loginAsOwner()

  try {
    // 1. Mark skipped (also establishes week_start for the rest of this run).
    const weekStart = await currentWeekStart(owner)
    check('POST skipped -> 200, got a week_start', typeof weekStart === 'string' && weekStart.length > 0)

    // Confirm the mark actually landed as 'skipped'.
    let row = (await rest(`vendor_week_status?vendor=eq.${encodeURIComponent(VENDOR)}&week_start=eq.${weekStart}`))[0]
    check("after marking skipped, the row's status is 'skipped'", row?.status === 'skipped')

    // 2. SWITCH: press Order Placed on the same vendor/week.
    const switchRes = await apiFetch('/api/vendor-week-status', owner.cookie, {
      method: 'POST',
      body: JSON.stringify({ vendor: VENDOR, status: 'ordered' }),
    })
    check('POST ordered (switching from skipped) -> 200', switchRes.status === 200)
    row = (await rest(`vendor_week_status?vendor=eq.${encodeURIComponent(VENDOR)}&week_start=eq.${weekStart}`))[0]
    check("switching: the SAME row's status is now 'ordered' (not a duplicate row)", row?.status === 'ordered')

    // 3. SWITCH BACK the other direction: Nothing to order again.
    const switchBackRes = await apiFetch('/api/vendor-week-status', owner.cookie, {
      method: 'POST',
      body: JSON.stringify({ vendor: VENDOR, status: 'skipped' }),
    })
    check('POST skipped (switching back from ordered) -> 200', switchBackRes.status === 200)
    row = (await rest(`vendor_week_status?vendor=eq.${encodeURIComponent(VENDOR)}&week_start=eq.${weekStart}`))[0]
    check("switching back: status is 'skipped' again", row?.status === 'skipped')

    // 4. UNDO: clears the mark entirely.
    const undoRes = await apiFetch('/api/vendor-week-status', owner.cookie, {
      method: 'DELETE',
      body: JSON.stringify({ vendor: VENDOR }),
    })
    const undoBody = await undoRes.json()
    check('DELETE (Undo) -> 200', undoRes.status === 200)
    check('Undo reports it actually cleared something', undoBody.cleared === true)
    const rowsAfterUndo = await rest(`vendor_week_status?vendor=eq.${encodeURIComponent(VENDOR)}&week_start=eq.${weekStart}`)
    check('Undo: no row left for this vendor/week (pending again)', rowsAfterUndo.length === 0)

    // 5. Undo again (nothing to undo) -- idempotent, never errors, reports cleared=false.
    const undoAgainRes = await apiFetch('/api/vendor-week-status', owner.cookie, { method: 'DELETE', body: JSON.stringify({ vendor: VENDOR }) })
    const undoAgainBody = await undoAgainRes.json()
    check('Undo with nothing to undo -> 200, cleared=false', undoAgainRes.status === 200 && undoAgainBody.cleared === false)

    // 6. The OTHER direction end-to-end: Order Placed, then Undo.
    const orderRes = await apiFetch('/api/vendor-week-status', owner.cookie, { method: 'POST', body: JSON.stringify({ vendor: VENDOR, status: 'ordered' }) })
    check('POST ordered (fresh) -> 200', orderRes.status === 200)
    const undoOrderRes = await apiFetch('/api/vendor-week-status', owner.cookie, { method: 'DELETE', body: JSON.stringify({ vendor: VENDOR }) })
    const undoOrderBody = await undoOrderRes.json()
    check('Undo after Order Placed -> cleared=true', undoOrderBody.cleared === true)
    const rowsAfterSecondUndo = await rest(`vendor_week_status?vendor=eq.${encodeURIComponent(VENDOR)}&week_start=eq.${weekStart}`)
    check('no row left after the second Undo either', rowsAfterSecondUndo.length === 0)

    // 7. Audit trail — non-fatal if the migration hasn't been run yet.
    const logRows = await logRowsFor(weekStart)
    if (logRows === null) {
      console.log('skip - vendor_week_status_log audit trail checks (table not migrated yet — run supabase/add-vendor-week-status-log.sql)')
    } else {
      const actions = logRows.map((r) => r.action)
      check(
        'audit log recorded every press in order: skipped, ordered, skipped, undone, ordered, undone',
        JSON.stringify(actions) === JSON.stringify(['skipped', 'ordered', 'skipped', 'undone', 'ordered', 'undone'])
      )
      check('every log row names who did it', logRows.every((r) => r.by === 'ZZTEST Owner'))
    }
  } finally {
    await rest(`vendor_week_status?vendor=eq.${encodeURIComponent(VENDOR)}`, { method: 'DELETE' })
    await rest(`vendor_week_status_log?vendor=eq.${encodeURIComponent(VENDOR)}`, { method: 'DELETE' }).catch(() => {})
  }

  console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`)
  process.exit(failures === 0 ? 0 : 1)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
