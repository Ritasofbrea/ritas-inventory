import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { parseDueTime } from '@/lib/task-server'

export async function GET() {
  const db = getServerSupabase()
  const { data, error } = await db.from('checklists').select('*').order('name')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// Owner-only (enforced client-side, same trust model as the rest of this app):
// sets or clears a named checklist's default due time. Only updates an
// existing row — this never creates a new checklist.
export async function PATCH(request: NextRequest) {
  const { name, due_time } = await request.json()
  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'Missing checklist name' }, { status: 400 })
  }
  const dueTimeResult = parseDueTime(due_time)
  if (!dueTimeResult.ok) return NextResponse.json({ error: dueTimeResult.error }, { status: 400 })

  const db = getServerSupabase()
  const { data, error } = await db
    .from('checklists')
    .update({ due_time: dueTimeResult.value })
    .eq('name', name)
    .select()
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Checklist not found' }, { status: 404 })
  return NextResponse.json(data)
}
