// Patch 28 regression: a 'checklist'-style task template's instance can't
// be completed until every one of its steps is checked (canCompleteInstance
// in src/lib/task-server.ts), and check-step/uncheck-step toggle correctly.
// Pure API, no browser -- faster and this is really a server-logic check.
import { apiFetch, loginAsOwner } from './helpers/auth.mjs'
import { sweepZztestFixtures } from './helpers/zztest.mjs'

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

  // Setup: a 'checklist'-style template with 2 steps, generated for today.
  const createRes = await apiFetch('/api/task-templates', owner.cookie, {
    method: 'POST',
    body: JSON.stringify({
      title: 'ZZTEST Step Check Task',
      assigned_to: 'Everyone',
      created_by: 'Josh',
      recurrence: 'daily',
      step_style: 'checklist',
    }),
  })
  check('setup: template created', createRes.status === 200)
  const { template } = await createRes.json()

  const step1Res = await apiFetch('/api/task-templates/steps', owner.cookie, {
    method: 'POST',
    body: JSON.stringify({ template_id: template.id, content: 'ZZTEST Step 1' }),
  })
  const { steps: afterStep1 } = await step1Res.json()
  const step2Res = await apiFetch('/api/task-templates/steps', owner.cookie, {
    method: 'POST',
    body: JSON.stringify({ template_id: template.id, content: 'ZZTEST Step 2' }),
  })
  const { steps: afterStep2 } = await step2Res.json()
  check('setup: 2 steps created', afterStep1.length === 1 && afterStep2.length === 2)
  const [step1, step2] = afterStep2.sort((a, b) => a.sort_order - b.sort_order)

  // Find today's generated instance for this template.
  const todayRes = await apiFetch('/api/tasks', owner.cookie, { method: 'GET' })
  const { open } = await todayRes.json()
  const instance = open.find((i) => i.template_id === template.id)
  check('setup: instance generated for today with 2 steps attached', !!instance && instance.steps?.length === 2)

  // Need a real active staff name for completed_by (isActiveStaff check).
  const staffRes = await apiFetch('/api/staff', owner.cookie, { method: 'GET' })
  const staffList = await staffRes.json()
  check('setup: at least one active staff member exists to complete as', staffList.length > 0)
  const completedBy = staffList[0]?.name

  const tryComplete = () =>
    apiFetch('/api/tasks', owner.cookie, {
      method: 'PATCH',
      body: JSON.stringify({ id: instance.id, action: 'complete', completed_by: completedBy }),
    })
  const checkStep = (stepId) =>
    apiFetch('/api/tasks', owner.cookie, { method: 'PATCH', body: JSON.stringify({ id: instance.id, action: 'check-step', step_id: stepId }) })
  const uncheckStep = (stepId) =>
    apiFetch('/api/tasks', owner.cookie, { method: 'PATCH', body: JSON.stringify({ id: instance.id, action: 'uncheck-step', step_id: stepId }) })

  // Blocked with both steps unchecked.
  check('complete blocked with 0/2 steps checked -> 400', (await tryComplete()).status === 400)

  // Check step 1, still blocked (1/2).
  check('check-step 1 -> success', (await checkStep(step1.id)).status === 200)
  check('complete still blocked with 1/2 steps checked -> 400', (await tryComplete()).status === 400)

  // Uncheck step 1 to prove the toggle actually un-checks, then re-check it.
  check('uncheck-step 1 -> success', (await uncheckStep(step1.id)).status === 200)
  check('complete still blocked after unchecking back to 0/2 -> 400', (await tryComplete()).status === 400)
  check('re-check-step 1 -> success', (await checkStep(step1.id)).status === 200)

  // Check step 2 -> 2/2 -> complete succeeds.
  check('check-step 2 -> success', (await checkStep(step2.id)).status === 200)
  const completeRes = await tryComplete()
  check('complete succeeds with 2/2 steps checked -> 200', completeRes.status === 200)
  if (completeRes.status === 200) {
    const completed = await completeRes.json()
    check('completed instance has status "done"', completed.status === 'done')
  }

  await sweepZztestFixtures()
  console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`)
  process.exit(failures === 0 ? 0 : 1)
}

run().catch(async (e) => {
  console.error(e)
  await sweepZztestFixtures().catch(() => {})
  process.exit(1)
})
