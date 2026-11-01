import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { parseDueTime } from '@/lib/task-server'
import { requireRole } from '@/lib/session'

export async function GET(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner', 'shift_lead', 'staff'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { data, error } = await db.from('checklists').select('*').order('name')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// Owner-only (patch 29: now server-enforced): sets or clears a named
// checklist's default due time. Only updates an existing row — this never
// creates a new checklist.
export async function PATCH(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { name, due_time } = await request.json()
  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'Missing checklist name' }, { status: 400 })
  }
  const dueTimeResult = parseDueTime(due_time)
  if (!dueTimeResult.ok) return NextResponse.json({ error: dueTimeResult.error }, { status: 400 })

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
