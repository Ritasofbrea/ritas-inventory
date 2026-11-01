import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { fetchNotesWithJoins } from '@/lib/notes-server'
import { requireRole } from '@/lib/session'

// Read-only — archived notes (manual Delete or auto-archive on full
// acknowledgment), newest-archived first, with their full reply thread and
// acknowledgment list intact. Open to any valid session, same as the live
// board — no restore/un-archive, no hard-delete.
//
// Patch 29 B5: same fix as GET /api/notes — private-note visibility now
// comes from the session cookie, never a client-sent ?role= param.
export async function GET(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner', 'shift_lead', 'staff'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  try {
    return NextResponse.json(await fetchNotesWithJoins(db, { archived: true, viewerIsOwner: auth.session.role === 'owner' }))
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not load notes history' }, { status: 500 })
  }
}
