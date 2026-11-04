import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { createChecklist, deleteChecklistList, moveChecklistList, parseDueTime, renameChecklistList } from '@/lib/task-server'
import { requireRole } from '@/lib/session'

// Open to every role — this is a small table (a handful of lists, never
// anywhere near flavors'/items' scale), so it's simplest for every list
// (including turned-off ones) to go to every role and let each screen decide
// what to do with `active`: the owner-only manage UI shows everything, the
// Add Task List picker and the To-Do tab's cards only use the active ones.
export async function GET(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner', 'shift_lead', 'staff'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { data, error } = await db.from('checklists').select('*').order('sort_order')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// Owner-only (patch 29: server-enforced). Creates a new list: no SQL, no
// schema change needed beyond what Phase 1 already added — task_templates/
// task_instances already support filing a task under any checklist_name.
export async function POST(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { name } = await request.json()
  const result = await createChecklist(db, name)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result.checklist)
}

// Owner-only (patch 29: server-enforced). `name` identifies which list.
// `rename_to` and `direction` are their own multi-step operations (rename
// cascades to templates/open instances; direction swaps sort_order with a
// neighbor) — handled first and exclusively; anything else is a plain field
// update (due_time, active).
export async function PATCH(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const body = await request.json()
  const { name } = body
  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'Missing checklist name' }, { status: 400 })
  }

  if (typeof body.rename_to === 'string') {
    const result = await renameChecklistList(db, name, body.rename_to)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json(result.checklist)
  }

  if (body.direction === 'up' || body.direction === 'down') {
    const result = await moveChecklistList(db, name, body.direction)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ success: true })
  }

  const updates: Record<string, string | boolean | null> = {}
  if (body.due_time !== undefined) {
    const dueTimeResult = parseDueTime(body.due_time)
    if (!dueTimeResult.ok) return NextResponse.json({ error: dueTimeResult.error }, { status: 400 })
    updates.due_time = dueTimeResult.value
  }
  if (typeof body.active === 'boolean') updates.active = body.active
  if (Object.keys(updates).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  const { data, error } = await db.from('checklists').update(updates).eq('name', name).select().maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Checklist not found' }, { status: 404 })
  return NextResponse.json(data)
}

// Owner-only (patch 29: server-enforced). Permanently deletes a list AND
// every one of its templates (cascade) -- see deleteChecklistList for the
// exact per-template rule (same as a single task's existing hard delete).
export async function DELETE(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { name } = await request.json()
  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'Missing checklist name' }, { status: 400 })
  }
  const result = await deleteChecklistList(db, name)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ success: true, deletedTemplates: result.deletedTemplates, deletedOpen: result.deletedOpen })
}
