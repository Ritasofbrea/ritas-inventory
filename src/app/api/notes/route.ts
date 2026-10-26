import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { isActiveStaff } from '@/lib/task-server'
import { NoteReply, NoteAcknowledgment } from '@/lib/notes'

export async function GET() {
  const db = getServerSupabase()
  const [{ data, error }, { data: repliesRaw, error: repliesError }, { data: acksRaw, error: acksError }] = await Promise.all([
    db.from('notes').select('*').order('created_at', { ascending: false }),
    db.from('note_replies').select('*').order('created_at', { ascending: true }),
    db.from('note_acknowledgments').select('*').order('acknowledged_at', { ascending: true }),
  ])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (repliesError) return NextResponse.json({ error: repliesError.message }, { status: 500 })
  if (acksError) return NextResponse.json({ error: acksError.message }, { status: 500 })

  const repliesByNote = new Map<string, NoteReply[]>()
  for (const r of (repliesRaw ?? []) as NoteReply[]) {
    const list = repliesByNote.get(r.note_id) ?? []
    list.push(r)
    repliesByNote.set(r.note_id, list)
  }
  const acksByNote = new Map<string, NoteAcknowledgment[]>()
  for (const a of (acksRaw ?? []) as NoteAcknowledgment[]) {
    const list = acksByNote.get(a.note_id) ?? []
    list.push(a)
    acksByNote.set(a.note_id, list)
  }
  const notes = (data ?? []).map((n) => ({
    ...n,
    replies: repliesByNote.get(n.id) ?? [],
    acknowledgments: acksByNote.get(n.id) ?? [],
  }))
  return NextResponse.json(notes)
}

// No PIN gate — anyone viewing the To-Do screen (even an unauthenticated visitor)
// can add a note, same as completing a task. created_by must be an active staff
// name, same check as completing a task (isActiveStaff), not the owner-only
// TASK_CREATORS list used for a task's "Added by" field.
//
// requires_ack is gated client-side only (the toggle is hidden from regular
// staff in AddNoteModal, same canManage check used for "+ Add Task") — this
// route trusts whatever boolean it's given, same as every other owner-only
// flag in this app.
export async function POST(request: NextRequest) {
  const { content, created_by, requires_ack } = await request.json()
  if (typeof content !== 'string' || !content.trim()) {
    return NextResponse.json({ error: 'Write something first' }, { status: 400 })
  }
  const db = getServerSupabase()
  if (!(await isActiveStaff(db, created_by))) {
    return NextResponse.json({ error: 'Pick your name from the list' }, { status: 400 })
  }
  const { data, error } = await db
    .from('notes')
    .insert({ content: content.trim(), created_by, requires_ack: requires_ack === true })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// Toggling "handled" is open to everyone for a regular staffer's note, same
// no-PIN trust level as adding one — a plain visual signal. For a note an
// owner authored (isOwnerStaffName in staffColor.ts — created_by is always a
// staff-table name here, e.g. 'Josh D.', not the owners-table 'Josh'), only
// owner/shift-lead (canManage) can toggle it, same tier as Delete. Both
// gates are enforced client-side only (the checkbox is disabled otherwise),
// same as every other owner-only action in this app — there's no
// server-side role check anywhere in this codebase.
export async function PATCH(request: NextRequest) {
  const { id, handled } = await request.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  if (typeof handled !== 'boolean') return NextResponse.json({ error: 'handled must be a boolean' }, { status: 400 })
  const db = getServerSupabase()
  const { data, error } = await db.from('notes').update({ handled }).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// Owner/shift-lead gating is enforced client-side only (the Delete button is
// hidden otherwise) — same as every other owner-only action in this app (e.g.
// task delete), there's no server-side role check anywhere in this codebase.
export async function DELETE(request: NextRequest) {
  const { id } = await request.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  const db = getServerSupabase()
  const { error } = await db.from('notes').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
