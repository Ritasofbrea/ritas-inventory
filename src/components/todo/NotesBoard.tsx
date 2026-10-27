'use client'

import { useCallback, useEffect, useState } from 'react'
import type { RealtimePostgresInsertPayload, RealtimePostgresUpdatePayload, RealtimePostgresDeletePayload } from '@supabase/realtime-js'
import AddNoteModal from './AddNoteModal'
import AddReplyModal from './AddReplyModal'
import AckModal from './AckModal'
import ConfirmModal from './ConfirmModal'
import NotesHistoryModal from './NotesHistoryModal'
import TruncatedNoteContent from './TruncatedNoteContent'
import PhotoLightbox from './PhotoLightbox'
import StaffName from '@/components/StaffName'
import { staffColorFor, pastelTint, isOwnerStaffName, namesLikelyMatch, computeAckDenominator } from '@/lib/staffColor'
import { supabase } from '@/lib/supabase'
import { Staff, formatDateTime } from '@/lib/tasks'
import { Note, NoteReply, NoteAcknowledgment, formatRelativeTime } from '@/lib/notes'

// Shared sticky-notes board on the To-Do screen, above Today's Tasks. Anyone
// can add a note (no PIN); only owners/shift leads (canManage, same gate as
// + Add Task) can delete one. "Handled" is open to everyone too, UNLESS the
// note was authored by an owner (Josh/Gina) — then it's canManage-only, same
// tier as Delete (see handledLocked below).
//
// A note can also be flagged "Needs Acknowledgment" (owner/shift-lead only,
// set at creation in AddNoteModal) — this is a compliance record, not a
// notification system: no reminders, no hard gate on anything else in the
// app, just a one-tap "I Understand" per person logged in
// note_acknowledgments (see AckModal), shown as a count/list against the
// active staff roster.
//
// Live updates come from Supabase Realtime (postgres_changes on `notes`,
// `note_replies`, `note_acknowledgments`), not polling — separate from
// Today's Tasks' own 5-minute poll, which stays untouched. Requires each
// table added to the supabase_realtime publication; see
// supabase/enable-notes-realtime.sql, enable-note-replies-realtime.sql,
// enable-note-acknowledgments-realtime.sql.
//
// Acknowledgment exemptions (patch 16): an owner never needs to acknowledge
// any note (`isOwner` — the logged-in session's role, not the generic
// canManage tier, since this is identity-specific); a shift lead is exempt
// only from a note they personally authored (`shiftLeadName`, matched
// against the note's created_by via namesLikelyMatch — shift leads aren't
// in the same name-space as the staff table, same gap isOwnerStaffName
// solves for owners). The "Acknowledged by (n of X)" denominator mirrors
// this (computeAckDenominator in staffColor.ts, shared with the server so
// the two can't drift — see notes-server.ts's auto-archive check below).
//
// Archiving (patch 17): "Delete" no longer destroys a note — it archives it
// (content/replies/acknowledgments all preserved), which just means it
// disappears from this live board; see Notes History for the full record.
// An ack-required note also auto-archives the moment its acknowledgment
// count reaches the required denominator (handled server-side, right after
// the triggering insert in POST /api/notes/acknowledgments) — either path
// shows up here as a Realtime UPDATE with archived: true, which this board
// treats as "remove from the live list," not a field to merge in.
export default function NotesBoard({
  staff,
  canManage,
  isOwner,
  shiftLeadName,
  showAdd,
  setShowAdd,
}: {
  staff: Staff[]
  canManage: boolean
  isOwner: boolean
  shiftLeadName: string | null
  showAdd: boolean
  setShowAdd: (show: boolean) => void
}) {
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<Note | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [handledBusyId, setHandledBusyId] = useState<string | null>(null)
  const [replyingTo, setReplyingTo] = useState<Note | null>(null)
  const [acking, setAcking] = useState<Note | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [shiftLeads, setShiftLeads] = useState<{ name: string; active: boolean }[]>([])
  // Tap a note's timestamp to flip it to the full date/time (hover does the
  // same via the title attribute, but this is a touch-first PWA).
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/notes')
      if (res.ok) setNotes(await res.json())
    } catch {
      // board just stays empty/stale on a transient error — not worth
      // surfacing an error banner for a low-stakes notes board
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Only needed for the ack-exemption math above — /api/shift-leads returns
  // everyone (it's the owner-only management screen's list), so filter to
  // active here same as /api/staff does server-side.
  useEffect(() => {
    fetch('/api/shift-leads')
      .then((res) => (res.ok ? res.json() : []))
      .then((data: { name: string; active: boolean }[]) => setShiftLeads((data ?? []).filter((s) => s.active)))
      .catch(() => {
        // ack denominator just falls back to the full staff roster (no
        // shift-lead exclusions) — not worth an error banner for this
      })
  }, [])

  // Push, not poll: every connected client (including an anonymous visitor
  // who added no note themselves) sees an add/delete the instant it happens.
  // Own adds/deletes already update local state via load()/filter below, so
  // these handlers de-dupe by id rather than assuming they're the only source.
  useEffect(() => {
    const channel = supabase
      .channel('notes-board')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notes' }, (payload: RealtimePostgresInsertPayload<Note>) => {
        // The raw `notes` row has no `replies`/`acknowledgments` columns —
        // they're joins this app adds in the GET /api/notes route — so a
        // freshly-inserted note always starts with none of either rather
        // than an undefined field.
        setNotes((prev) =>
          prev.some((n) => n.id === payload.new.id) ? prev : [{ ...payload.new, replies: [], acknowledgments: [] }, ...prev]
        )
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notes' }, (payload: RealtimePostgresUpdatePayload<Note>) => {
        // An archive (manual Delete, or auto-archive on full acknowledgment —
        // both are UPDATEs now, never a DELETE) means "remove from this live
        // list," same visual result as the old hard-delete. Any other field
        // update (e.g. someone else's "handled" toggle) merges rather than
        // replaces, so it doesn't wipe this note's already-loaded replies.
        if (payload.new.archived) {
          setNotes((prev) => prev.filter((n) => n.id !== payload.new.id))
        } else {
          setNotes((prev) => prev.map((n) => (n.id === payload.new.id ? { ...n, ...payload.new } : n)))
        }
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'notes' }, (payload: RealtimePostgresDeletePayload<Note>) => {
        const deletedId = payload.old.id
        if (deletedId) setNotes((prev) => prev.filter((n) => n.id !== deletedId))
      })
      // A parent note's own cascade-delete removes its replies in the
      // database, but there's no separate DELETE event to listen for here —
      // the note's DELETE handler above already drops the whole card.
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'note_replies' }, (payload: RealtimePostgresInsertPayload<NoteReply>) => {
        const reply = payload.new
        setNotes((prev) =>
          prev.map((n) =>
            n.id === reply.note_id && !n.replies.some((r) => r.id === reply.id)
              ? { ...n, replies: [...n.replies, reply] }
              : n
          )
        )
      })
      // Dedupe by (note_id, staff_name), not id — the unique constraint
      // means staff_name alone is unique per note, and the no-op
      // "already acknowledged" API response (see acknowledgments/route.ts)
      // has no id to key off of.
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'note_acknowledgments' }, (payload: RealtimePostgresInsertPayload<NoteAcknowledgment>) => {
        const ack = payload.new
        setNotes((prev) =>
          prev.map((n) =>
            n.id === ack.note_id && !n.acknowledgments.some((a) => a.staff_name === ack.staff_name)
              ? { ...n, acknowledgments: [...n.acknowledgments, ack] }
              : n
          )
        )
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const afterSaved = () => {
    setShowAdd(false)
    load()
  }

  const afterReplySaved = () => {
    setReplyingTo(null)
    load()
  }

  const afterAckSaved = () => {
    setAcking(null)
    load()
  }

  // Gating (handledLocked, in the render below) keeps this from ever firing
  // on an owner's note for a non-canManage visitor — the checkbox is
  // disabled in that case, so this function itself stays ungated.
  const toggleHandled = async (note: Note) => {
    setHandledBusyId(note.id)
    const next = !note.handled
    setNotes((prev) => prev.map((n) => (n.id === note.id ? { ...n, handled: next } : n)))
    try {
      const res = await fetch('/api/notes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: note.id, handled: next }),
      })
      if (!res.ok) throw new Error()
    } catch {
      // revert the optimistic flip on failure
      setNotes((prev) => prev.map((n) => (n.id === note.id ? { ...n, handled: note.handled } : n)))
    } finally {
      setHandledBusyId(null)
    }
  }

  const handleDelete = async () => {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      const res = await fetch('/api/notes', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: deleting.id }),
      })
      if (!res.ok) throw new Error()
      setDeleting(null)
      load()
    } catch {
      setDeleting(null)
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <div className="mb-6">
      {/* The page's own combined "Store Communication/To-Do" <h1> covers
          this section now — "Add Note" lives up there too (combined-header
          patch); this row just keeps the small "Notes" label + History link. */}
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs font-bold uppercase tracking-widest text-gray-500">Notes</h2>
        <button onClick={() => setShowHistory(true)} className="text-xs font-semibold text-gray-500 hover:text-gray-700 px-2 py-1">
          Notes History
        </button>
      </div>

      {!loading && notes.length === 0 && <p className="text-gray-400 text-sm text-center py-3">No notes yet.</p>}

      {notes.length > 0 && (
        <div className="flex flex-col gap-2">
          {notes.map((n) => {
            // Subtle pastel tint from the author's color, not a bold/solid
            // fill — falls back to the default yellow sticky-note styling
            // when they have no color set. Layout/shadow/etc. unchanged.
            const authorColor = staffColorFor(n.created_by, staff)
            // An owner's own note can only be marked handled by someone
            // authenticated as owner/shift-lead (canManage, same tier as
            // Delete) — everyone else's notes keep the open-to-anyone toggle.
            const handledLocked = isOwnerStaffName(n.created_by) && !canManage
            // Ack-required notes are called out with a thicker dashed border
            // plus a badge, both in hot pink/fuchsia — the one color in this
            // palette not already spoken for (amber/orange = overdue,
            // blue/red/purple = person-colors) — specifically so it grabs
            // attention at a glance (patch 14; the original neutral-gray
            // treatment from patch 13 didn't stand out enough). When
            // requires_ack, this pink border wins over the author's own
            // color tint (the tint still colors the card background).
            const borderStyle = n.requires_ack ? 'border-2 border-dashed border-fuchsia-600' : 'border'
            const ackedNames = n.acknowledgments.map((a) => a.staff_name)

            // Exemptions (patch 16): an owner is exempt from every
            // ack-required note; a shift lead is exempt only from a note
            // they personally authored.
            const viewerIsAuthoringShiftLead = !!shiftLeadName && namesLikelyMatch(shiftLeadName, n.created_by)
            const ackExempt = isOwner || viewerIsAuthoringShiftLead
            const ackDenominator = computeAckDenominator(
              staff.map((s) => s.name),
              shiftLeads.map((sl) => sl.name),
              n.created_by
            )

            return (
              <div
                key={n.id}
                className={`rounded-2xl shadow-sm ${borderStyle} px-4 py-3 ${authorColor ? '' : 'bg-yellow-50'} ${
                  !authorColor && !n.requires_ack ? 'border-yellow-200' : ''
                }`}
                style={
                  authorColor
                    ? {
                        backgroundColor: pastelTint(authorColor, 0.88),
                        ...(n.requires_ack ? {} : { borderColor: pastelTint(authorColor, 0.7) }),
                      }
                    : undefined
                }
              >
                {n.requires_ack && (
                  <div className="mb-2">
                    <span className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-white bg-fuchsia-600 px-2 py-0.5 rounded-full">
                      ⚠ Action Needed
                    </span>
                  </div>
                )}
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={n.handled}
                    onChange={() => toggleHandled(n)}
                    disabled={handledBusyId === n.id || handledLocked}
                    title={handledLocked ? 'Only an owner or shift lead can mark this handled' : undefined}
                    aria-label={n.handled ? 'Mark not handled' : 'Mark handled'}
                    className="mt-1 w-4 h-4 flex-shrink-0 accent-[#1a7a3c] disabled:opacity-50"
                  />
                  <TruncatedNoteContent content={n.content} handled={n.handled} />
                </div>
                {n.photo_url && (
                  <button
                    type="button"
                    onClick={() => setLightboxUrl(n.photo_url)}
                    className="mt-2 block"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={n.photo_url} alt="Note photo" className="w-20 h-20 rounded-lg object-cover border border-gray-200" />
                  </button>
                )}
                <div className="flex items-center justify-between gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => toggleExpanded(n.id)}
                    title={formatDateTime(n.created_at)}
                    className="text-xs text-gray-500 text-left"
                  >
                    <StaffName name={n.created_by} staff={staff} /> · {expanded.has(n.id) ? formatDateTime(n.created_at) : formatRelativeTime(n.created_at)}
                  </button>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {n.requires_ack && !ackExempt && (
                      <button
                        onClick={() => setAcking(n)}
                        className="text-xs font-semibold text-white bg-fuchsia-600 hover:bg-fuchsia-700 px-2.5 py-1 rounded-full"
                      >
                        I Understand
                      </button>
                    )}
                    <button
                      onClick={() => setReplyingTo(n)}
                      className="text-xs font-semibold text-blue-600 hover:text-blue-700 px-2 py-1"
                    >
                      Reply
                    </button>
                    {canManage && (
                      <button
                        onClick={() => setDeleting(n)}
                        className="text-xs font-semibold text-red-600 hover:text-red-700 px-2 py-1"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>

                {n.replies.length > 0 && (
                  <div className="mt-2 pl-3 border-l-2 border-gray-200 flex flex-col gap-1.5">
                    {n.replies.map((r) => (
                      <div key={r.id}>
                        <p className="text-sm text-gray-700 whitespace-pre-wrap">{r.content}</p>
                        <p className="text-xs text-gray-400">
                          <StaffName name={r.created_by} staff={staff} /> · {formatRelativeTime(r.created_at)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {n.requires_ack && (
                  <p className="text-xs text-gray-500 mt-2">
                    {ackedNames.length === 0
                      ? `Acknowledged by: none yet (0 of ${ackDenominator})`
                      : `Acknowledged by: ${ackedNames.join(', ')} (${ackedNames.length} of ${ackDenominator})`}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}

      {showAdd && <AddNoteModal staff={staff} canManage={canManage} onClose={() => setShowAdd(false)} onSaved={afterSaved} />}

      {replyingTo && (
        <AddReplyModal
          staff={staff}
          noteId={replyingTo.id}
          onClose={() => setReplyingTo(null)}
          onSaved={afterReplySaved}
        />
      )}

      {acking && (
        <AckModal
          staff={staff}
          noteId={acking.id}
          alreadyAcknowledged={acking.acknowledgments.map((a) => a.staff_name)}
          onClose={() => setAcking(null)}
          onSaved={afterAckSaved}
        />
      )}

      {deleting && (
        <ConfirmModal
          message="Archive this note? It'll disappear from the board here, but stays saved — with its replies and any acknowledgments — in Notes History."
          busy={deleteBusy}
          onConfirm={handleDelete}
          onCancel={() => setDeleting(null)}
        />
      )}

      {showHistory && <NotesHistoryModal staff={staff} shiftLeads={shiftLeads} onClose={() => setShowHistory(false)} />}

      {lightboxUrl && <PhotoLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
    </div>
  )
}
