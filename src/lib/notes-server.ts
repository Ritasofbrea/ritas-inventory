// Server-only helpers for the Notes board (patch 17: archive + auto-archive).
import type { SupabaseClient } from '@supabase/supabase-js'
import { computeAckDenominator } from './staffColor'
import { Note, NoteReply, NoteAcknowledgment, NotePhoto } from './notes'

// Pages through `table` with `build` applied to every page, so a table that
// grows past PostgREST's silent 1000-row cap is still read in full instead
// of silently truncated. Used for `notes` itself below (patch 41) --
// unlike inventory_counts etc, it's not expected to be large yet, but
// nothing guarantees that forever, and paging here costs nothing extra
// when it isn't.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAllPages<T>(db: SupabaseClient, table: string, build: (q: any) => any, pageSize = 1000): Promise<T[]> {
  const all: T[] = []
  let from = 0
  for (;;) {
    const { data, error } = await build(db.from(table)).range(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    const page = (data ?? []) as T[]
    all.push(...page)
    if (page.length < pageSize) break
    from += pageSize
  }
  return all
}

// Chunk size for `.in('note_id', ids)` below -- keeps the request URL and
// the IN clause a sane size even if hundreds of notes are in scope.
const ID_CHUNK_SIZE = 200

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

// Fetches `table` filtered to `.in('note_id', ids)` for each chunk of note
// ids, in parallel (there are only ever a handful of chunks -- notes in
// scope for one call, divided by ID_CHUNK_SIZE), instead of one unfiltered
// fetch-everything query.
async function fetchByNoteIdChunks<T>(
  db: SupabaseClient,
  table: string,
  idChunks: string[][],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  build: (q: any) => any
): Promise<T[]> {
  if (idChunks.length === 0) return []
  const chunks = await Promise.all(
    idChunks.map(async (ids) => {
      const { data, error } = await build(db.from(table).select('*').in('note_id', ids))
      if (error) throw new Error(error.message)
      return (data ?? []) as T[]
    })
  )
  return chunks.flat()
}

// Shared join logic for the live board (GET /api/notes, archived=false) and
// Notes History (GET /api/notes/history, archived=true) — same notes +
// note_replies + note_acknowledgments shape either way, just a different
// `archived` filter and sort column (created_at for the live board, newest
// first; archived_at for history, most-recently-archived first, since
// that's what Notes History groups by).
//
// Patch 41: note_replies/note_acknowledgments/note_photos used to be
// fetched in full on every call, unfiltered -- three more tables that would
// silently truncate past 1000 rows, and pure waste even before that (most
// of those rows belong to notes not even in scope for this call). Now
// they're scoped to exactly the note ids this call returned.
export async function fetchNotesWithJoins(
  db: SupabaseClient,
  opts: { archived: boolean; viewerIsOwner: boolean }
): Promise<Note[]> {
  const sortColumn = opts.archived ? 'archived_at' : 'created_at'
  const data = await fetchAllPages<Note>(db, 'notes', (q) =>
    q.select('*').eq('archived', opts.archived).order(sortColumn, { ascending: false })
  )

  const noteIds = data.map((n) => n.id)
  const idChunks = chunk(noteIds, ID_CHUNK_SIZE)

  const [repliesRaw, acksRaw, photosRaw] = await Promise.all([
    fetchByNoteIdChunks<NoteReply>(db, 'note_replies', idChunks, (q) => q.order('created_at', { ascending: true })),
    fetchByNoteIdChunks<NoteAcknowledgment>(db, 'note_acknowledgments', idChunks, (q) =>
      q.order('acknowledged_at', { ascending: true })
    ),
    fetchByNoteIdChunks<NotePhoto>(db, 'note_photos', idChunks, (q) => q.order('sort_order', { ascending: true })),
  ])

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
  const visibleNotes = data.filter((n) => !n.owner_only || opts.viewerIsOwner)

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
  // Patch 39 follow-up: ZZTEST Shift Lead is kept permanently active (no
  // more toggling for e2e tests), so it must never count toward a real
  // note's required acknowledgments -- it would be a phantom participant
  // that can never ack, blocking the note from ever auto-archiving.
  const shiftLeadNames = (shiftLeadRows ?? []).map((s: { name: string }) => s.name).filter((n) => !n.startsWith('ZZTEST'))
  const denominator = computeAckDenominator(staffNames, shiftLeadNames, note.created_by)

  if (denominator > 0 && (ackCount ?? 0) >= denominator) {
    await db.from('notes').update({ archived: true, archived_at: new Date().toISOString() }).eq('id', noteId)
  }
}
