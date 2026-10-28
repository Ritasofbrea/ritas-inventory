// Shared sticky-notes types + display helpers for the To-Do screen's Notes board.

import { todayInTZ } from './tasks'

export interface NoteReply {
  id: string
  note_id: string
  content: string
  created_by: string
  created_at: string
}

// Up to 3 per note (enforced client-side in AddNoteModal), ordered by
// sort_order — the order they were attached in, no reordering supported.
export interface NotePhoto {
  id?: string
  note_id: string
  photo_url: string
  sort_order: number
}

// One row per person who tapped "I Understand" on an ack-required note.
// `id` is absent when the API's response is the no-op "already acknowledged"
// path (nothing was inserted) — callers merging this into local state should
// dedupe by (note_id, staff_name), not by id.
export interface NoteAcknowledgment {
  id?: string
  note_id: string
  staff_name: string
  acknowledged_at: string
}

export interface Note {
  id: string
  content: string
  created_by: string
  created_at: string
  handled: boolean
  requires_ack: boolean
  archived: boolean
  archived_at: string | null
  owner_only: boolean
  photos: NotePhoto[]
  replies: NoteReply[]
  acknowledgments: NoteAcknowledgment[]
}

// Shared by the live board and Notes History fetches — tells the server
// which owner_only ("private," patch 21) notes this viewer is allowed to
// see: all of them if they're an owner, otherwise only ones authored under
// a name this browser has used before (see auth.ts's
// getKnownPrivateNoteAuthors — there's no persistent login for regular
// staff to match against, so this is the closest equivalent, same
// client-asserted trust model as every other role check in this app).
export function notesVisibilityParams(isOwner: boolean, knownPrivateAuthors: string[]): string {
  const params = new URLSearchParams()
  if (isOwner) params.set('role', 'owner')
  if (knownPrivateAuthors.length > 0) params.set('authors', knownPrivateAuthors.join(','))
  return params.toString()
}

export interface ArchivedNoteDayGroup {
  date: string
  notes: Note[]
}

// Groups already-sorted (newest first) archived notes by their Pacific
// calendar day (archived_at), same grouping shape as tasks'
// groupHistoryByDay — but keyed off a timestamp rather than an existing
// due_date string, so the day has to be computed here via todayInTZ.
export function groupArchivedNotesByDay(notes: Note[]): ArchivedNoteDayGroup[] {
  const groups: ArchivedNoteDayGroup[] = []
  for (const note of notes) {
    if (!note.archived_at) continue
    const date = todayInTZ(new Date(note.archived_at))
    const last = groups[groups.length - 1]
    if (last && last.date === date) last.notes.push(note)
    else groups.push({ date, notes: [note] })
  }
  return groups
}

// "just now" / "5 min ago" / "3 hr ago" / "2 days ago" / "3 weeks ago" / "4 months ago" —
// the full timestamp (formatDateTime from lib/tasks) is shown on hover/tap instead.
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks} week${weeks === 1 ? '' : 's'} ago`
  const months = Math.floor(days / 30)
  return `${months} month${months === 1 ? '' : 's'} ago`
}
