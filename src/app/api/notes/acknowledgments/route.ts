import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { isActiveStaff } from '@/lib/task-server'

// One-tap "I Understand" — no text entry, same no-PIN trust level as adding
// a note or reply (isActiveStaff). Logging twice for the same person is a
// no-op (unique constraint on note_id+staff_name in
// add-note-acknowledgments.sql), not an error, since someone might tap their
// name again without realizing they already acknowledged.
export async function POST(request: NextRequest) {
  const { note_id, staff_name } = await request.json()
  if (typeof note_id !== 'string' || !note_id) {
    return NextResponse.json({ error: 'Missing note' }, { status: 400 })
  }
  const db = getServerSupabase()
  if (!(await isActiveStaff(db, staff_name))) {
    return NextResponse.json({ error: 'Pick your name from the list' }, { status: 400 })
  }
  const { data, error } = await db
    .from('note_acknowledgments')
    .insert({ note_id, staff_name })
    .select()
    .single()
  if (error) {
    if (error.code === '23505') return NextResponse.json({ note_id, staff_name, already_acknowledged: true })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data)
}
