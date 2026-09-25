import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { todayInTZ, photoFlags, PhotoSetting } from '@/lib/tasks'
import { generateInstancesForDate, isValidAssignee, isValidCreator, normalizeRecurrence } from '@/lib/task-server'

export async function GET() {
  const db = getServerSupabase()
  const { data, error } = await db
    .from('task_templates')
    .select('*')
    .order('active', { ascending: false })
    .order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { title, description, assigned_to, created_by, photo_setting } = body

  if (typeof title !== 'string' || !title.trim()) {
    return NextResponse.json({ error: 'Missing title' }, { status: 400 })
  }
  const recurrence = normalizeRecurrence(body)
  if ('error' in recurrence) return NextResponse.json({ error: recurrence.error }, { status: 400 })
  const setting: PhotoSetting = ['off', 'optional', 'required'].includes(photo_setting) ? photo_setting : 'optional'

  const db = getServerSupabase()
  if (!(await isValidAssignee(db, assigned_to))) {
    return NextResponse.json({ error: 'Pick who this is assigned to' }, { status: 400 })
  }
  if (!isValidCreator(created_by)) {
    return NextResponse.json({ error: 'Pick who added this task' }, { status: 400 })
  }

  const { data: template, error } = await db
    .from('task_templates')
    .insert({
      title: title.trim(),
      description: typeof description === 'string' && description.trim() ? description.trim() : null,
      ...recurrence,
      ...photoFlags(setting),
      assigned_to,
      created_by,
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // If it recurs today, create today's task right away instead of waiting for tomorrow's cron
  let generated = 0
  try {
    generated = (await generateInstancesForDate(db, todayInTZ(), template.id)).created
  } catch (e) {
    console.error('immediate task generation failed:', e)
  }
  return NextResponse.json({ template, generated })
}

export async function PATCH(request: NextRequest) {
  const body = await request.json()
  const { id } = body
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const updates: Record<string, string | boolean | number | number[] | null> = {}
  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || !body.title.trim()) {
      return NextResponse.json({ error: 'Title cannot be empty' }, { status: 400 })
    }
    updates.title = body.title.trim()
  }
  if (body.description !== undefined) {
    updates.description = typeof body.description === 'string' && body.description.trim() ? body.description.trim() : null
  }
  if (typeof body.active === 'boolean') updates.active = body.active
  if (body.photo_setting !== undefined) {
    if (!['off', 'optional', 'required'].includes(body.photo_setting)) {
      return NextResponse.json({ error: 'Invalid photo setting' }, { status: 400 })
    }
    Object.assign(updates, photoFlags(body.photo_setting))
  }
  if (body.recurrence !== undefined) {
    const recurrence = normalizeRecurrence(body)
    if ('error' in recurrence) return NextResponse.json({ error: recurrence.error }, { status: 400 })
    Object.assign(updates, recurrence)
  }
  if (Object.keys(updates).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  const db = getServerSupabase()
  const { data: template, error } = await db.from('task_templates').update(updates).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Reactivated or rescheduled to today? Make sure today's task exists (idempotent).
  let generated = 0
  if (template.active) {
    try {
      generated = (await generateInstancesForDate(db, todayInTZ(), template.id)).created
    } catch (e) {
      console.error('task generation after template edit failed:', e)
    }
  }
  return NextResponse.json({ template, generated })
}
