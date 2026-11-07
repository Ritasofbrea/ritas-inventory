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

  console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`)
  process.exit(failures === 0 ? 0 : 1)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
