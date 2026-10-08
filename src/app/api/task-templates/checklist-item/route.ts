import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { todayInTZ, photoFlags, PhotoSetting } from '@/lib/tasks'
import { addChecklistItem, generateInstancesForDate, isValidAssignee, isValidCreator, moveChecklistItem, parseDueTime } from '@/lib/task-server'

// Adds a new line item to an existing named checklist + section (e.g. a new
// row under "Opening Checklist / Shop Readiness"). Does not create brand-new
// checklists or sections — only existing (checklist_name, section) pairs.
export async function POST(request: NextRequest) {
  const body = await request.json()
  const { checklist_name, section, title, description, assigned_to, created_by, photo_setting, due_time } = body

  if (typeof checklist_name !== 'string' || !checklist_name.trim()) {
    return NextResponse.json({ error: 'Missing checklist' }, { status: 400 })
  }
  if (typeof section !== 'string' || !section.trim()) {
    return NextResponse.json({ error: 'Missing section' }, { status: 400 })
  }
  if (typeof title !== 'string' || !title.trim()) {
    return NextResponse.json({ error: 'Missing title' }, { status: 400 })
  }
  const setting: PhotoSetting = ['off', 'optional', 'required'].includes(photo_setting) ? photo_setting : 'optional'
  const dueTimeResult = parseDueTime(due_time)
  if (!dueTimeResult.ok) return NextResponse.json({ error: dueTimeResult.error }, { status: 400 })

  const db = getServerSupabase()
  if (!(await isValidAssignee(db, assigned_to))) {
    return NextResponse.json({ error: 'Pick who this is assigned to' }, { status: 400 })
  }
  if (!isValidCreator(created_by)) {
    return NextResponse.json({ error: 'Pick who added this task' }, { status: 400 })
  }

  const result = await addChecklistItem(db, {
    checklist_name,
    section,
    title: title.trim(),
    description: typeof description === 'string' && description.trim() ? description.trim() : null,
    assigned_to,
    created_by,
    due_time: dueTimeResult.value,
    ...photoFlags(setting),
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  // Same as creating any other recurring task: if it matches today, generate
  // today's instance right away instead of waiting for tomorrow's cron.
  let generated = 0
  try {
    generated = (await generateInstancesForDate(db, todayInTZ(), result.template.id)).created
  } catch (e) {
    console.error('immediate task generation after checklist item add failed:', e)
  }
  return NextResponse.json({ template: result.template, generated })
}

// Reorders a checklist item within its own section (swap with the item above/below).
export async function PATCH(request: NextRequest) {
  const { id, direction } = await request.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  if (direction !== 'up' && direction !== 'down') {
    return NextResponse.json({ error: 'direction must be "up" or "down"' }, { status: 400 })
  }
  const result = await moveChecklistItem(getServerSupabase(), id, direction)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ success: true })
}
