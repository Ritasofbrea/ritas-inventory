import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { isActiveStaff } from '@/lib/task-server'
import { fetchNotesWithJoins } from '@/lib/notes-server'
import { requireRole } from '@/lib/session'

// Live board only — archived notes (manually "deleted" or auto-archived on
// full acknowledgment, see DELETE below and notes-server.ts) live in Notes
// History instead; see GET /api/notes/history.
//
// Patch 29 B5: used to trust a client-sent ?role=owner query param to decide
// whether to include private notes — anyone could fake that. Now sourced
// from the session cookie only; a staff or shift_lead session, or no
// session, never sees owner_only notes, no exceptions.
export async function GET(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner', 'shift_lead', 'staff'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  try {
    return NextResponse.json(await fetchNotesWithJoins(db, { archived: false, viewerIsOwner: auth.session.role === 'owner' }))
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not load notes' }, { status: 500 })
  }
}

// No PIN gate — anyone viewing the To-Do screen (even an unauthenticated visitor)
// can add a note, same as completing a task. created_by must be an active staff
// name, same check as completing a task (isActiveStaff), not the owner-only
// TASK_CREATORS list used for a task's "Added by" field. Patch 29: "anyone
// viewing the To-Do screen" now means any valid session (staff/shift_lead/
// owner) rather than literally anyone, consistent with every other ANY-tier
// route — see route-access.md.
//
// requires_ack is gated client-side only (the toggle is hidden from regular
// staff in AddNoteModal, same canManage check used for "+ Add Task") — this
// route trusts whatever boolean it's given, same as every other owner-only
// flag in this app. owner_only (patch 21) is NOT gated at all — anyone can
// send a private note to ownership, same as a regular one; it's who can
// later *see* it (fetchNotesWithJoins) that's restricted.
export async function POST(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner', 'shift_lead', 'staff'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { content, created_by, requires_ack, photo_urls, owner_only } = await request.json()
  if (typeof content !== 'string' || !content.trim()) {
    return NextResponse.json({ error: 'Write something first' }, { status: 400 })
  }
  if (!(await isActiveStaff(db, created_by))) {
    return NextResponse.json({ error: 'Pick your name from the list' }, { status: 400 })
  }
  const { data, error } = await db
    .from('notes')
    .insert({ content: content.trim(), created_by, requires_ack: requires_ack === true, owner_only: owner_only === true })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Up to 3 photos (patch 23), already uploaded client-side before this call
  // (see AddNoteModal) — the note has to exist first, so attaching them is a
  // second insert keyed off the id we just got back. sort_order just
  // preserves upload order, capped here too in case a client ever sends more.
  const urls: string[] = Array.isArray(photo_urls) ? photo_urls.filter((u): u is string => typeof u === 'string' && !!u).slice(0, 3) : []
  let photos = []
  if (urls.length > 0) {
    const { data: photoRows, error: photoError } = await db
      .from('note_photos')
      .insert(urls.map((photo_url, i) => ({ note_id: data.id, photo_url, sort_order: i })))
      .select()
    if (photoError) return NextResponse.json({ error: photoError.message }, { status: 500 })
    photos = photoRows ?? []
  }
  return NextResponse.json({ ...data, photos })
}

// Toggling "handled" is open to everyone for a regular staffer's note, same
// no-PIN trust level as adding one — a plain visual signal. For a note an
// owner authored, only owner/shift-lead (canManage) can toggle it, same
// tier as Delete — that owner-authored sub-case stays client-side gated
// only this patch (not split server-side); the route-level gate below is
// ANY, matching the common case.
export async function PATCH(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner', 'shift_lead', 'staff'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { id, handled } = await request.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  if (typeof handled !== 'boolean') return NextResponse.json({ error: 'handled must be a boolean' }, { status: 400 })
  const { data, error } = await db.from('notes').update({ handled }).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// "Delete" archives, it no longer destroys the row (patch 17) — so
// acknowledgment record-keeping survives it. Sets archived/archived_at and
// leaves everything else (content, replies, acknowledgments) untouched; it
// just disappears from the live board (GET above) and shows up in Notes
// History (GET /api/notes/history) instead. Patch 29: now server-enforced
// at owner-or-shift_lead.
export async function DELETE(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner', 'shift_lead'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { id } = await request.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  const { error } = await db.from('notes').update({ archived: true, archived_at: new Date().toISOString() }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
