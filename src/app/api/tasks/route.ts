import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { todayInTZ, photoFlags, PhotoSetting, Priority } from '@/lib/tasks'
import {
  attachStepsToInstances,
  canCompleteInstance,
  checkStep,
  deleteOneOffTask,
  editOneOffTask,
  generateInstancesForDate,
  isActiveStaff,
  isValidAssignee,
  isValidCreator,
  moveStandaloneItem,
  nextStandaloneInstanceSortOrder,
  parseDueTime,
  setInstancePriority,
  sweepMissedInstances,
  TASK_PHOTO_BUCKET,
  uncheckStep,
  undoCompletion,
} from '@/lib/task-server'
import { requireRole } from '@/lib/session'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const view = searchParams.get('view') || 'today'
  const today = todayInTZ()
  const db = getServerSupabase()
  // view=missed is owner-only; every other view (today/badge/history) is the
  // To-Do board itself, which has no role requirement in the UI.
  const auth = await requireRole(db, request, view === 'missed' ? ['owner'] : ['owner', 'shift_lead', 'staff'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  // Nav badge: open tasks due today. Missed (past-due, never completed) tasks
  // are a separate bucket now and intentionally excluded from this count.
  // Patch 36: a turned-off list's open instances don't count either — filtered
  // in JS after the fetch (not a DB `not in (...)` filter) because a real list
  // name can contain a comma ("Time to Lean, Time to Clean"), which would
  // break PostgREST's in-list syntax; this table is tiny either way.
  if (view === 'badge') {
    const [{ data: rows, error }, { data: checklistsRaw, error: checklistsError }] = await Promise.all([
      db.from('task_instances').select('checklist_name').eq('status', 'open').eq('due_date', today),
      db.from('checklists').select('name, active'),
    ])
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (checklistsError) return NextResponse.json({ error: checklistsError.message }, { status: 500 })
    const inactiveNames = new Set((checklistsRaw ?? []).filter((c) => !c.active).map((c) => c.name))
    const count = (rows ?? []).filter((r) => !r.checklist_name || !inactiveNames.has(r.checklist_name)).length
    return NextResponse.json({ count })
  }

  // History is the full "done" record — missed tasks have their own dedicated
  // view below, so they're excluded here rather than needing a third badge state.
  if (view === 'history') {
    const start = searchParams.get('start') || ''
    const end = searchParams.get('end') || ''
    if (!DATE_RE.test(start) || !DATE_RE.test(end)) {
      return NextResponse.json({ error: 'start and end must be YYYY-MM-DD' }, { status: 400 })
    }
    const { data, error } = await db
      .from('task_instances')
      .select('*')
      .neq('status', 'missed')
      .gte('due_date', start)
      .lte('due_date', end)
      .order('due_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1000)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  // Owner-only (client-side gated, same trust model as History/Templates/Staff):
  // every task that aged out of Today's Tasks without being completed.
  if (view === 'missed') {
    const { data, error } = await db
      .from('task_instances')
      .select('*')
      .eq('status', 'missed')
      .order('due_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1000)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  // Today view. Best-effort self-heal: if the daily cron was late or missed,
  // opening the tab still sweeps yesterday's leftovers to 'missed' and creates
  // today's recurring tasks (both idempotent).
  try {
    await sweepMissedInstances(db, today)
  } catch (e) {
    console.error('missed sweep on load failed:', e)
  }
  try {
    await generateInstancesForDate(db, today)
  } catch (e) {
    console.error('task generation on load failed:', e)
  }

  const [openRes, doneRes, missedCountRes, checklistsRes] = await Promise.all([
    db
      .from('task_instances')
      .select('*')
      .eq('status', 'open')
      .eq('due_date', today)
      .order('due_date', { ascending: true })
      .order('created_at', { ascending: true }),
    db
      .from('task_instances')
      .select('*')
      .eq('status', 'done')
      .eq('due_date', today)
      .order('completed_at', { ascending: false }),
    db.from('task_instances').select('id', { count: 'exact', head: true }).eq('status', 'missed'),
    db.from('checklists').select('name, active'),
  ])
  if (openRes.error) return NextResponse.json({ error: openRes.error.message }, { status: 500 })
  if (doneRes.error) return NextResponse.json({ error: doneRes.error.message }, { status: 500 })
  if (missedCountRes.error) return NextResponse.json({ error: missedCountRes.error.message }, { status: 500 })
  if (checklistsRes.error) return NextResponse.json({ error: checklistsRes.error.message }, { status: 500 })

  // Patch 36: a turned-off list is excluded from today's shared To-Do view
  // entirely — both its open AND its already-completed-today instances —
  // rather than leaving a card with only "done" items and no "open" ones
  // mid-day. The templates themselves, and every day before today, are
  // untouched (Repeating tab, History); this only shapes what today's card
  // view shows right now. Filtered in JS, same reasoning as the badge count
  // above (a real list name can contain a comma).
  const inactiveNames = new Set((checklistsRes.data ?? []).filter((c) => !c.active).map((c) => c.name))
  const visible = <T extends { checklist_name: string | null }>(rows: T[]) =>
    rows.filter((r) => !r.checklist_name || !inactiveNames.has(r.checklist_name))

  // Steps are read live from each instance's template (not snapshotted) —
  // History/Missed don't call this, so they never carry step data.
  const [openWithSteps, doneWithSteps] = await Promise.all([
    attachStepsToInstances(db, visible(openRes.data ?? [])),
    attachStepsToInstances(db, visible(doneRes.data ?? [])),
  ])

  return NextResponse.json({
    today,
    open: openWithSteps,
    done: doneWithSteps,
    missedCount: missedCountRes.count ?? 0,
  })
}

// Create a one-off task (due today, no template). SL+ — gated by the todo
// page's canManage (owner/shift_lead, or staff who unlocked via the real
// owner PIN through PinModal, which now also grants a real owner session).
export async function POST(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner', 'shift_lead'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const body = await request.json()
  const { title, description, assigned_to, created_by, photo_setting, priority, due_time } = body

  if (typeof title !== 'string' || !title.trim()) {
    return NextResponse.json({ error: 'Missing title' }, { status: 400 })
  }
  const setting: PhotoSetting = ['off', 'optional', 'required'].includes(photo_setting) ? photo_setting : 'optional'
  const prio: Priority = priority === 'high' ? 'high' : 'normal'
  const dueTimeResult = parseDueTime(due_time)
  if (!dueTimeResult.ok) return NextResponse.json({ error: dueTimeResult.error }, { status: 400 })

  if (!(await isValidAssignee(db, assigned_to))) {
    return NextResponse.json({ error: 'Pick who this is assigned to' }, { status: 400 })
  }
  if (!isValidCreator(created_by)) {
    return NextResponse.json({ error: 'Pick who added this task' }, { status: 400 })
  }

  const row: Record<string, string | boolean | null | number> = {
    template_id: null,
    title: title.trim(),
    due_date: todayInTZ(),
    assigned_to,
    created_by,
    priority: prio,
    sort_order: await nextStandaloneInstanceSortOrder(db, prio),
    due_time: dueTimeResult.value,
    ...photoFlags(setting),
  }
  if (typeof description === 'string' && description.trim()) row.description = description.trim()

  const { data, error } = await db.from('task_instances').insert(row).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// action 'complete': { id, completed_by }   action 'photo': { id, photo_url }
// action 'undo': { id }  (same calendar day only)
// action 'move': { id, direction }           action 'priority': { id, priority }  (standalone tasks only)
// action 'edit': { id, title?, description?, assigned_to?, created_by?, photo_setting?, due_time?, priority? }
//   (standalone, still-open tasks only — owner-only in the UI, not gated by who created it)
// action 'check-step': { id, step_id }   action 'uncheck-step': { id, step_id }
//   (checklist-style tasks only; anonymous — no name required or stored;
//   'complete' is refused server-side until every step is checked)
export async function PATCH(request: NextRequest) {
  const db = getServerSupabase()
  // Baseline: any valid session can reach this route at all (complete/undo/
  // check-step/uncheck-step/photo are all open to plain staff in the UI
  // today). move/priority/edit are additionally gated to owner below, and
  // undo to owner-or-shift_lead — see route-access.md.
  const auth = await requireRole(db, request, ['owner', 'shift_lead', 'staff'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const body = await request.json()
  const { id, action } = body
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  if (['undo', 'move', 'priority', 'edit'].includes(action) && auth.session.role === 'staff') {
    return NextResponse.json({ error: 'Not allowed for your role' }, { status: 403 })
  }
  if (['move', 'priority', 'edit'].includes(action) && auth.session.role !== 'owner') {
    return NextResponse.json({ error: 'Not allowed for your role' }, { status: 403 })
  }

  const { data: task, error: fetchError } = await db.from('task_instances').select('*').eq('id', id).maybeSingle()
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 })
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  if (action === 'complete') {
    if (task.status === 'done') return NextResponse.json({ error: 'Already completed' }, { status: 409 })
    if (!(await isActiveStaff(db, body.completed_by))) {
      return NextResponse.json({ error: 'Pick your name from the list' }, { status: 400 })
    }
    if (task.photo_required && !task.photo_url) {
      return NextResponse.json({ error: 'A photo is required before this can be marked done' }, { status: 400 })
    }
    const completeCheck = await canCompleteInstance(db, task)
    if (!completeCheck.ok) return NextResponse.json({ error: completeCheck.error }, { status: 400 })
    const { data, error } = await db
      .from('task_instances')
      .update({ status: 'done', completed_by: body.completed_by, completed_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'open')
      .select()
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Already completed' }, { status: 409 })
    return NextResponse.json(data)
  }

  if (action === 'check-step') {
    if (typeof body.step_id !== 'string' || !body.step_id) {
      return NextResponse.json({ error: 'Missing step_id' }, { status: 400 })
    }
    const result = await checkStep(db, id, body.step_id)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ success: true })
  }

  if (action === 'uncheck-step') {
    if (typeof body.step_id !== 'string' || !body.step_id) {
      return NextResponse.json({ error: 'Missing step_id' }, { status: 400 })
    }
    const result = await uncheckStep(db, id, body.step_id)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ success: true })
  }

  if (action === 'undo') {
    const result = await undoCompletion(db, id)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ success: true })
  }

  if (action === 'move') {
    if (body.direction !== 'up' && body.direction !== 'down') {
      return NextResponse.json({ error: 'direction must be "up" or "down"' }, { status: 400 })
    }
    const result = await moveStandaloneItem(db, id, body.direction)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ success: true })
  }

  if (action === 'priority') {
    if (body.priority !== 'normal' && body.priority !== 'high') {
      return NextResponse.json({ error: 'priority must be "normal" or "high"' }, { status: 400 })
    }
    const result = await setInstancePriority(db, id, body.priority)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ success: true })
  }

  if (action === 'edit') {
    const result = await editOneOffTask(db, id, body)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json(result.task)
  }

  if (action === 'photo') {
    if (!task.photo_allowed) return NextResponse.json({ error: 'Photos are turned off for this task' }, { status: 400 })
    const prefix = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${TASK_PHOTO_BUCKET}/`
    if (typeof body.photo_url !== 'string' || !body.photo_url.startsWith(prefix)) {
      return NextResponse.json({ error: 'Invalid photo URL' }, { status: 400 })
    }
    const { data, error } = await db.from('task_instances').update({ photo_url: body.photo_url }).eq('id', id).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

// Permanently delete a one-off task (the UI only offers this to owners)
export async function DELETE(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { id } = await request.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  const result = await deleteOneOffTask(db, id)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ success: true })
}
