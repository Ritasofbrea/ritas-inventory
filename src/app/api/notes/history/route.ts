import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { fetchNotesWithJoins } from '@/lib/notes-server'

// Read-only — archived notes (manual Delete or auto-archive on full
// acknowledgment), newest-archived first, with their full reply thread and
// acknowledgment list intact. Open to anyone who can see the To-Do screen,
// same as the live board — no restore/un-archive, no hard-delete.
export async function GET() {
  const db = getServerSupabase()
  try {
    return NextResponse.json(await fetchNotesWithJoins(db, { archived: true }))
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not load notes history' }, { status: 500 })
  }
}
