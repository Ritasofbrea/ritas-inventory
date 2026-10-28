// Server-only helpers for the Notes board (patch 17: archive + auto-archive).
import type { SupabaseClient } from '@supabase/supabase-js'
import { computeAckDenominator } from './staffColor'
import { Note, NoteReply, NoteAcknowledgment, NotePhoto } from './notes'

// Shared join logic for the live board (GET /api/notes, archived=false) and
// Notes History (GET /api/notes/history, archived=true) — same notes +
// note_replies + note_acknowledgments shape either way, just a different
// `archived` filter and sort column (created_at for the live board, newest
// first; archived_at for history, most-recently-archived first, since
// that's what Notes History groups by).
export async function fetchNotesWithJoins(
  db: SupabaseClient,
  opts: { archived: boolean; viewerIsOwner: boolean }
): Promise<Note[]> {
  const sortColumn = opts.archived ? 'archived_at' : 'created_at'
  const [
    { data, error },
    { data: repliesRaw, error: repliesError },
    { data: acksRaw, error: acksError },
    { data: photosRaw, error: photosError },
  ] = await Promise.all([
    db.from('notes').select('*').eq('archived', opts.archived).order(sortColumn, { ascending: false }),
    db.from('note_replies').select('*').order('created_at', { ascending: true }),
    db.from('note_acknowledgments').select('*').order('acknowledged_at', { ascending: true }),
    db.from('note_photos').select('*').order('sort_order', { ascending: true }),
  ])
  if (error) throw new Error(error.message)
  if (repliesError) throw new Error(repliesError.message)
  if (acksError) throw new Error(acksError.message)
  if (photosError) throw new Error(photosError.message)

  // Private ("owner_only," patch 21) notes are dropped here before any
  // joins are attached — not just hidden in the UI — so an unauthorized
  // viewer's response never contains them at all: not in the list, not in
  // counts, nothing. Owner-only, no exceptions, not even a note's own
  // author once they're off the owner role.
  //
  // Fix note: the original version of this also let through any note whose
  // created_by matched a name in a client-sent `authors` list, meant to let
  // an author keep seeing their own note after posting (there's no real
  // login for regular staff to check instead). That list lived in
  // localStorage, which this app's actual device — a single shared store
  // tablet everyone uses — doesn't scope per person. So it accumulated
  // every name that had EVER posted privately from that tablet, and the
  // server trusted whatever list the client sent, meaning anyone browsing
  // from that same tablet afterward — any role, any person — got every one
  // of those notes, regardless of who was actually asking. Confirmed
  // reproducing on both this route and GET /api/notes/history, since both
  // call this same function with the same flawed opts. Removed entirely;
  // `viewerIsOwner` is now the only check.
  const visibleNotes = (data ?? []).filter((n) => !n.owner_only || opts.viewerIsOwner)

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
  const photosByNote = new Map<string, NotePhoto[]>()
  for (const p of (photosRaw ?? []) as NotePhoto[]) {
    const list = photosByNote.get(p.note_id) ?? []
    list.push(p)
    photosByNote.set(p.note_id, list)
  }
  return visibleNotes.map((n) => ({
    ...n,
    replies: repliesByNote.get(n.id) ?? [],
    acknowledgments: acksByNote.get(n.id) ?? [],
    photos: photosByNote.get(n.id) ?? [],
  }))
}

// Called after every acknowledgment insert (including the no-op "already
// acknowledged" path, which is harmless to re-check). If the note requires
// acknowledgment, isn't archived yet, and the acknowledgment count has just
// reached the required total (same computeAckDenominator math the client
// uses for display — owners excluded, the author excluded only if they're a
// shift lead), archives it automatically. Regular (non-ack-required) notes
// never hit this — they only archive via manual Delete.
export async function maybeAutoArchiveNote(db: SupabaseClient, noteId: string): Promise<void> {
  const { data: note, error: noteError } = await db.from('notes').select('*').eq('id', noteId).maybeSingle()
  if (noteError || !note || !note.requires_ack || note.archived) return

  const [{ data: staffRows }, { data: shiftLeadRows }, { count: ackCount }] = await Promise.all([
    db.from('staff').select('name').eq('active', true),
    db.from('shift_leads').select('name').eq('active', true),
    db.from('note_acknowledgments').select('id', { count: 'exact', head: true }).eq('note_id', noteId),
  ])

  const staffNames = (staffRows ?? []).map((s: { name: string }) => s.name)
  const shiftLeadNames = (shiftLeadRows ?? []).map((s: { name: string }) => s.name)
  const denominator = computeAckDenominator(staffNames, shiftLeadNames, note.created_by)

  if (denominator > 0 && (ackCount ?? 0) >= denominator) {
    await db.from('notes').update({ archived: true, archived_at: new Date().toISOString() }).eq('id', noteId)
  }
}
