import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { todayInTZ, photoFlags, PhotoSetting } from '@/lib/tasks'
import { deleteOneOffTask, generateInstancesForDate, isActiveStaff, isValidAssignee, isValidCreator, TASK_PHOTO_BUCKET } from '@/lib/task-server'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const view = searchParams.get('view') || 'today'
  const today = todayInTZ()
  const db = getServerSupabase()

  // Nav badge: open tasks due today plus anything overdue
  if (view === 'badge') {
    const { count, error } = await db
      .from('task_instances')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open')
      .lte('due_date', today)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ count: count ?? 0 })
  }

  if (view === 'history') {
    const start = searchParams.get('start') || ''
    const end = searchParams.get('end') || ''
    if (!DATE_RE.test(start) || !DATE_RE.test(end)) {
      return NextResponse.json({ error: 'start and end must be YYYY-MM-DD' }, { status: 400 })
    }
    const { data, error } = await db
      .from('task_instances')
      .select('*')
      .gte('due_date', start)
      .lte('due_date', end)
      .order('due_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1000)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  // Today view. Best-effort self-heal: if the daily cron was late or missed,
  // opening the tab still creates today's recurring tasks (idempotent).
  try {
    await generateInstancesForDate(db, today)
  } catch (e) {
    console.error('task generation on load failed:', e)
  }

  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
  const [openRes, doneRes] = await Promise.all([
    db
      .from('task_instances')
      .select('*')
      .eq('status', 'open')
      .lte('due_date', today)
      .order('due_date', { ascending: true })
      .order('created_at', { ascending: true }),
    db
      .from('task_instances')
      .select('*')
      .eq('status', 'done')
      .gte('completed_at', cutoff)
      .order('completed_at', { ascending: false }),
  ])
  if (openRes.error) return NextResponse.json({ error: openRes.error.message }, { status: 500 })
  if (doneRes.error) return NextResponse.json({ error: doneRes.error.message }, { status: 500 })

  // "Completed today" = completed_at falls on today's Pacific date
  const doneToday = (doneRes.data ?? []).filter(
    (t: { completed_at: string }) => todayInTZ(new Date(t.completed_at)) === today
  )
  return NextResponse.json({ today, open: openRes.data ?? [], done: doneToday })
}

// Create a one-off task (due today, no template)
export async function POST(request: NextRequest) {
  const body = await request.json()
  const { title, description, assigned_to, created_by, photo_setting } = body

  if (typeof title !== 'string' || !title.trim()) {
    return NextResponse.json({ error: 'Missing title' }, { status: 400 })
  }
  const setting: PhotoSetting = ['off', 'optional', 'required'].includes(photo_setting) ? photo_setting : 'optional'

  const db = getServerSupabase()
  if (!(await isValidAssignee(db, assigned_to))) {
    return NextResponse.json({ error: 'Pick who this is assigned to' }, { status: 400 })
  }
  if (!isValidCreator(created_by)) {
    return NextResponse.json({ error: 'Pick who added this task' }, { status: 400 })
  }

  const row: Record<string, string | boolean | null> = {
    template_id: null,
    title: title.trim(),
    due_date: todayInTZ(),
    assigned_to,
    created_by,
    ...photoFlags(setting),
  }
  if (typeof description === 'string' && description.trim()) row.description = description.trim()

  const { data, error } = await db.from('task_instances').insert(row).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// action 'complete': { id, completed_by }   action 'photo': { id, photo_url }
export async function PATCH(request: NextRequest) {
  const body = await request.json()
  const { id, action } = body
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const db = getServerSupabase()
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
  const { id } = await request.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  const result = await deleteOneOffTask(getServerSupabase(), id)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ success: true })
}
