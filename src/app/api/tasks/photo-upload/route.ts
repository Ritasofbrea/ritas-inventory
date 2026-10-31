import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { TASK_PHOTO_BUCKET } from '@/lib/task-server'
import { requireRole } from '@/lib/session'

// Issues a one-time signed upload URL so the browser uploads straight to
// Supabase Storage (avoids Vercel's ~4.5MB request body limit).
export async function POST(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner', 'shift_lead', 'staff'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { task_id } = await request.json()
  if (!task_id) return NextResponse.json({ error: 'Missing task_id' }, { status: 400 })
  const { data: task } = await db.from('task_instances').select('id, photo_allowed').eq('id', task_id).maybeSingle()
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  if (!task.photo_allowed) return NextResponse.json({ error: 'Photos are turned off for this task' }, { status: 400 })

  const path = `${task_id}/${Date.now()}.jpg`
  const { data, error } = await db.storage.from(TASK_PHOTO_BUCKET).createSignedUploadUrl(path)
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Could not start upload' }, { status: 500 })

  const publicUrl = db.storage.from(TASK_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl
  return NextResponse.json({ path: data.path, token: data.token, publicUrl })
}
