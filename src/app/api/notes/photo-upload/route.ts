import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { NOTE_PHOTO_BUCKET } from '@/lib/note-photo-constants'
import { requireRole } from '@/lib/session'

// Issues a one-time signed upload URL so the browser uploads straight to
// Supabase Storage (avoids Vercel's ~4.5MB request body limit) — same
// pattern as /api/tasks/photo-upload. No note_id to tie the path to here:
// a note photo is picked before the note itself is created (AddNoteModal
// uploads it first, then posts the resulting URL along with the note).
//
// Patch 49: prefixed with a fresh crypto.randomUUID() (same unguessable
// idea as task photos' task_id-prefixed path) instead of Date.now() +
// Math.random() -- the bucket is public-read, so a note's photo URL is as
// private as it's hard to guess. Existing photos already uploaded under
// the old path keep working untouched; this only changes new uploads.
export async function POST(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner', 'shift_lead', 'staff'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const path = `${randomUUID()}/${Date.now()}.jpg`
  const { data, error } = await db.storage.from(NOTE_PHOTO_BUCKET).createSignedUploadUrl(path)
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Could not start upload' }, { status: 500 })

  const publicUrl = db.storage.from(NOTE_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl
  return NextResponse.json({ path: data.path, token: data.token, publicUrl })
}
