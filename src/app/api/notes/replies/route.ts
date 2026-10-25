import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { isActiveStaff } from '@/lib/task-server'

// Add-only follow-up on an existing note — no edit/delete for this pass, same
// no-PIN trust level as adding a note itself (isActiveStaff, not the
// owner-only TASK_CREATORS list). Deleting the parent note cascade-deletes
// its replies (see add-note-replies.sql); there's no delete route here.
export async function POST(request: NextRequest) {
  const { note_id, content, created_by } = await request.json()
  if (typeof note_id !== 'string' || !note_id) {
    return NextResponse.json({ error: 'Missing note' }, { status: 400 })
  }
  if (typeof content !== 'string' || !content.trim()) {
    return NextResponse.json({ error: 'Write something first' }, { status: 400 })
  }
  const db = getServerSupabase()
  if (!(await isActiveStaff(db, created_by))) {
    return NextResponse.json({ error: 'Pick your name from the list' }, { status: 400 })
  }
  const { data, error } = await db
    .from('note_replies')
    .insert({ note_id, content: content.trim(), created_by })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
