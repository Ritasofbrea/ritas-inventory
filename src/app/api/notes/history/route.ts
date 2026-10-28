import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { fetchNotesWithJoins } from '@/lib/notes-server'

// Read-only — archived notes (manual Delete or auto-archive on full
// acknowledgment), newest-archived first, with their full reply thread and
// acknowledgment list intact. Open to anyone who can see the To-Do screen,
// same as the live board — no restore/un-archive, no hard-delete.
//
// Same ?role=owner private-note visibility filter as GET /api/notes
// (patch 21) — an archived private note is just as hidden from an
// unauthorized viewer here as it is on the live board.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const viewerIsOwner = searchParams.get('role') === 'owner'
  const db = getServerSupabase()
  try {
    return NextResponse.json(await fetchNotesWithJoins(db, { archived: true, viewerIsOwner }))
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not load notes history' }, { status: 500 })
  }
}
