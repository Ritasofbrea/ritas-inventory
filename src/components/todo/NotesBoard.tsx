'use client'

import { useCallback, useEffect, useState } from 'react'
import type { RealtimePostgresInsertPayload, RealtimePostgresUpdatePayload, RealtimePostgresDeletePayload } from '@supabase/realtime-js'
import AddNoteModal from './AddNoteModal'
import ConfirmModal from './ConfirmModal'
import { supabase } from '@/lib/supabase'
import { Staff, formatDateTime } from '@/lib/tasks'
import { Note, formatRelativeTime } from '@/lib/notes'

// Shared sticky-notes board on the To-Do screen, above Today's Tasks. Anyone
// can add a note (no PIN); only owners/shift leads (canManage, same gate as
// + Add Task) can delete one.
//
// Live updates come from Supabase Realtime (postgres_changes on `notes`),
// not polling — separate from Today's Tasks' own 5-minute poll, which stays
// untouched. Requires `notes` to be added to the supabase_realtime
// publication; see supabase/enable-notes-realtime.sql.
export default function NotesBoard({ staff, canManage }: { staff: Staff[]; canManage: boolean }) {
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [deleting, setDeleting] = useState<Note | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [handledBusyId, setHandledBusyId] = useState<string | null>(null)
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

  // Push, not poll: every connected client (including an anonymous visitor
  // who added no note themselves) sees an add/delete the instant it happens.
  // Own adds/deletes already update local state via load()/filter below, so
  // these handlers de-dupe by id rather than assuming they're the only source.
  useEffect(() => {
    const channel = supabase
      .channel('notes-board')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notes' }, (payload: RealtimePostgresInsertPayload<Note>) => {
        setNotes((prev) => (prev.some((n) => n.id === payload.new.id) ? prev : [payload.new, ...prev]))
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notes' }, (payload: RealtimePostgresUpdatePayload<Note>) => {
        setNotes((prev) => prev.map((n) => (n.id === payload.new.id ? payload.new : n)))
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'notes' }, (payload: RealtimePostgresDeletePayload<Note>) => {
        const deletedId = payload.old.id
        if (deletedId) setNotes((prev) => prev.filter((n) => n.id !== deletedId))
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

  // No PIN gate, same as adding a note — a plain visual signal anyone can
  // flip, not a gate on anything (Delete stays owner/shift-lead-only, below).
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
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs font-bold uppercase tracking-widest text-gray-500">Notes</h2>
        <button onClick={() => setShowAdd(true)} className="text-xs font-semibold text-blue-600 hover:text-blue-700 px-2 py-1">
          + Add Note
        </button>
      </div>

      {!loading && notes.length === 0 && <p className="text-gray-400 text-sm text-center py-3">No notes yet.</p>}

      {notes.length > 0 && (
        <div className="flex flex-col gap-2">
          {notes.map((n) => (
            <div key={n.id} className="bg-yellow-50 border border-yellow-200 rounded-2xl shadow-sm px-4 py-3">
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={n.handled}
                  onChange={() => toggleHandled(n)}
                  disabled={handledBusyId === n.id}
                  aria-label={n.handled ? 'Mark not handled' : 'Mark handled'}
                  className="mt-1 w-4 h-4 flex-shrink-0 accent-[#1a7a3c] disabled:opacity-50"
                />
                <p className={`text-gray-900 whitespace-pre-wrap ${n.handled ? 'line-through text-gray-400' : ''}`}>
                  {n.content}
                </p>
              </div>
              <div className="flex items-center justify-between gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => toggleExpanded(n.id)}
                  title={formatDateTime(n.created_at)}
                  className="text-xs text-gray-500 text-left"
                >
                  {n.created_by} · {expanded.has(n.id) ? formatDateTime(n.created_at) : formatRelativeTime(n.created_at)}
                </button>
                {canManage && (
                  <button
                    onClick={() => setDeleting(n)}
                    className="text-xs font-semibold text-red-600 hover:text-red-700 px-2 py-1 flex-shrink-0"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && <AddNoteModal staff={staff} onClose={() => setShowAdd(false)} onSaved={afterSaved} />}

      {deleting && (
        <ConfirmModal
          message="Permanently delete this note? This can't be undone."
          busy={deleteBusy}
          onConfirm={handleDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  )
}
