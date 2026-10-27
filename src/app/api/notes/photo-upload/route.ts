import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { NOTE_PHOTO_BUCKET } from '@/lib/note-photo-constants'

// Issues a one-time signed upload URL so the browser uploads straight to
// Supabase Storage (avoids Vercel's ~4.5MB request body limit) — same
// pattern as /api/tasks/photo-upload. No note_id to tie the path to here:
// a note photo is picked before the note itself is created (AddNoteModal
// uploads it first, then posts the resulting URL along with the note), so
// the path is just a random, unguessable filename.
export async function POST() {
  const db = getServerSupabase()
  const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`
  const { data, error } = await db.storage.from(NOTE_PHOTO_BUCKET).createSignedUploadUrl(path)
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Could not start upload' }, { status: 500 })

  const publicUrl = db.storage.from(NOTE_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl
  return NextResponse.json({ path: data.path, token: data.token, publicUrl })
}
