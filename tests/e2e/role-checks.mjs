// Patch 29 regression: server-enforced role checks (requireRole in
// src/lib/session.ts) across a representative cross-section of
// route-access.md's tiers. Not exhaustive -- route-access.md is the full
// table; this exercises one real route per tier plus the 401-vs-403
// distinction itself: 401 = no/invalid/expired/revoked session,
// 403 = valid session, wrong role.
import { apiFetch, loginAsOwner, loginAsShiftLead, loginAsStaff } from './helpers/auth.mjs'

let failures = 0
const check = (name, cond) => {
  if (cond) console.log(`ok - ${name}`)
  else {
    console.log(`FAIL - ${name}`)
    failures++
  }
}

async function run() {
  const owner = await loginAsOwner()
  const shiftLead = await loginAsShiftLead()
  const staff = await loginAsStaff()

  // PUBLIC -- /api/session GET never requires a session; it's what tells a
  // device whether it has one.
  {
    const res = await apiFetch('/api/session', null, { method: 'GET' })
    check('PUBLIC: GET /api/session with no cookie -> 200', res.status === 200)
  }

  // ANY -- /api/checklists GET is readable by every role, but not by no one.
  {
    const noSession = await apiFetch('/api/checklists', null)
    check('ANY: GET /api/checklists with no session -> 401', noSession.status === 401)
    const asStaff = await apiFetch('/api/checklists', staff.cookie)
    check('ANY: GET /api/checklists as staff -> 200', asStaff.status === 200)
    const asShiftLead = await apiFetch('/api/checklists', shiftLead.cookie)
    check('ANY: GET /api/checklists as shift_lead -> 200', asShiftLead.status === 200)
    const asOwner = await apiFetch('/api/checklists', owner.cookie)
    check('ANY: GET /api/checklists as owner -> 200', asOwner.status === 200)
  }

  // OWNER -- /api/task-templates GET is owner-only (Repeating tab).
  {
    const noSession = await apiFetch('/api/task-templates', null)
    check('OWNER: GET /api/task-templates with no session -> 401', noSession.status === 401)
    const asStaff = await apiFetch('/api/task-templates', staff.cookie)
    check('OWNER: GET /api/task-templates as staff -> 403', asStaff.status === 403)
    const asShiftLead = await apiFetch('/api/task-templates', shiftLead.cookie)
    check('OWNER: GET /api/task-templates as shift_lead -> 403', asShiftLead.status === 403)
    const asOwner = await apiFetch('/api/task-templates', owner.cookie)
    check('OWNER: GET /api/task-templates as owner -> 200', asOwner.status === 200)
  }

  // OWNER (write path) -- DELETE /api/checklists on a name that doesn't
  // exist still proves the role gate runs BEFORE the delete logic: a
  // wrong-role caller gets 403 without ever reaching the "not found" branch.
  {
    const asStaff = await apiFetch('/api/checklists', staff.cookie, {
      method: 'DELETE',
      body: JSON.stringify({ name: 'ZZTEST Does Not Exist' }),
    })
    check('OWNER: DELETE /api/checklists as staff -> 403 (before not-found check)', asStaff.status === 403)
  }

  // SL+ -- POST /api/tasks (one-off create) is owner or shift_lead, not
  // staff. Cleans up its own fixture immediately via the owner session.
  {
    const body = JSON.stringify({ title: 'ZZTEST Role Check Task', assigned_to: 'Everyone', created_by: 'Josh' })
    const asStaff = await apiFetch('/api/tasks', staff.cookie, { method: 'POST', body })
    check('SL+: POST /api/tasks as staff -> 403', asStaff.status === 403)

    const asShiftLead = await apiFetch('/api/tasks', shiftLead.cookie, { method: 'POST', body })
    check('SL+: POST /api/tasks as shift_lead -> 200', asShiftLead.status === 200)
    if (asShiftLead.status === 200) {
      const created = await asShiftLead.json()
      await apiFetch('/api/tasks', owner.cookie, { method: 'DELETE', body: JSON.stringify({ id: created.id }) })
    }
  }

  // OWNER -- Patch 44: vendor schedules, per-vendor week status, owner
  // alert switches, pack size, and the reminder cron are all owner-only
  // (or secret-only for the cron) -- shift_lead/staff must never reach
  // them, matching the Order List/Manage Items pages they serve.
  {
    const noSession = await apiFetch('/api/vendor-schedules', null)
    check('OWNER: GET /api/vendor-schedules with no session -> 401', noSession.status === 401)
    const asShiftLead = await apiFetch('/api/vendor-schedules', shiftLead.cookie)
    check('OWNER: GET /api/vendor-schedules as shift_lead -> 403', asShiftLead.status === 403)
    const asStaff = await apiFetch('/api/vendor-schedules', staff.cookie)
    check('OWNER: GET /api/vendor-schedules as staff -> 403', asStaff.status === 403)
    const asOwner = await apiFetch('/api/vendor-schedules', owner.cookie)
    check('OWNER: GET /api/vendor-schedules as owner -> 200', asOwner.status === 200)
  }
  {
    const body = JSON.stringify({ vendor: 'ZZTEST Vendor', status: 'skipped' })
    const asShiftLead = await apiFetch('/api/vendor-week-status', shiftLead.cookie, { method: 'POST', body })
    check('OWNER: POST /api/vendor-week-status as shift_lead -> 403', asShiftLead.status === 403)
    const asStaff = await apiFetch('/api/vendor-week-status', staff.cookie, { method: 'POST', body })
    check('OWNER: POST /api/vendor-week-status as staff -> 403', asStaff.status === 403)
  }
  {
    const asShiftLead = await apiFetch('/api/owners/alerts', shiftLead.cookie)
    check('OWNER: GET /api/owners/alerts as shift_lead -> 403', asShiftLead.status === 403)
    const asOwner = await apiFetch('/api/owners/alerts', owner.cookie)
    check('OWNER: GET /api/owners/alerts as owner -> 200', asOwner.status === 200)
  }
  {
    const body = JSON.stringify({ id: '00000000-0000-0000-0000-000000000000', pack_size: 4 })
    const asShiftLead = await apiFetch('/api/items/pack-size', shiftLead.cookie, { method: 'PATCH', body })
    check('OWNER: PATCH /api/items/pack-size as shift_lead -> 403', asShiftLead.status === 403)
  }
  {
    const res = await apiFetch('/api/cron/vendor-reminders', null, { method: 'GET', headers: { Authorization: 'Bearer wrong-secret' } })
    check('SECRET: GET /api/cron/vendor-reminders with wrong bearer -> 401', res.status === 401)
  }

  // OWNER -- "Send me a test notification" (POST /api/owners/alerts/test).
  // Only ever checking the role gate and input validation here — it sends
  // a real push on success, so there's no 200 case in this script; the
  // dedicated linked-devices isolation check lives in
  // vendor-schedule-checks.mjs (push_subscriptions writes, ZZTEST-only).
  {
    const body = JSON.stringify({ name: 'Josh' })
    const noSession = await apiFetch('/api/owners/alerts/test', null, { method: 'POST', body })
    check('OWNER: POST /api/owners/alerts/test with no session -> 401', noSession.status === 401)
    const asShiftLead = await apiFetch('/api/owners/alerts/test', shiftLead.cookie, { method: 'POST', body })
    check('OWNER: POST /api/owners/alerts/test as shift_lead -> 403', asShiftLead.status === 403)
    const asOwnerBadName = await apiFetch('/api/owners/alerts/test', owner.cookie, { method: 'POST', body: JSON.stringify({ name: 'ZZTEST Owner' }) })
    check('OWNER: POST /api/owners/alerts/test with an unknown name -> 400', asOwnerBadName.status === 400)
  }

  console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`)
  process.exit(failures === 0 ? 0 : 1)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
