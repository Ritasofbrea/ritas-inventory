import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { isActiveStaff } from '@/lib/task-server'

export async function GET() {
  const db = getServerSupabase()
  const { data, error } = await db.from('notes').select('*').order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// No PIN gate — anyone viewing the To-Do screen (even an unauthenticated visitor)
// can add a note, same as completing a task. created_by must be an active staff
// name, same check as completing a task (isActiveStaff), not the owner-only
// TASK_CREATORS list used for a task's "Added by" field.
export async function POST(request: NextRequest) {
  const { content, created_by } = await request.json()
  if (typeof content !== 'string' || !content.trim()) {
    return NextResponse.json({ error: 'Write something first' }, { status: 400 })
  }
  const db = getServerSupabase()
  if (!(await isActiveStaff(db, created_by))) {
    return NextResponse.json({ error: 'Pick your name from the list' }, { status: 400 })
  }
  const { data, error } = await db
    .from('notes')
    .insert({ content: content.trim(), created_by })
    .select()
    .single()
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
