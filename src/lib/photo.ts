import { supabase } from './supabase'
import { TASK_PHOTO_BUCKET } from './task-constants'
import { NOTE_PHOTO_BUCKET } from './note-photo-constants'

const MAX_EDGE = 1600

// Patch 50: both buckets now enforce a 5MB size limit and an allowed-
// image-types list server-side (via Storage's own bucket config, set
// once with the admin API — see the patch 50 report, not a route in this
// app). The upload itself goes straight from the browser to Supabase
// Storage, so a rejection surfaces here as a StorageApiError with one of
// Storage's own technical messages — translated to something a
// non-technical person can act on. Everything else (any other storage
// error) falls back to its original message unchanged.
export function friendlyUploadError(message: string): string {
  if (message.includes('exceeded the maximum allowed size')) return 'That photo is too big — try a smaller one.'
  if (message.includes('mime type') && message.includes('not supported')) return "That file isn't a supported photo type."
  return message
}

// Downscales to a JPEG so iPhone photos (often 3–6MB) upload quickly on cell data.
async function resizeToJpeg(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('Could not read that photo'))
      el.src = url
    })
    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.naturalWidth * scale)
    canvas.height = Math.round(img.naturalHeight * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not process that photo')
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not process that photo'))), 'image/jpeg', 0.8)
    )
  } finally {
    URL.revokeObjectURL(url)
  }
}

// Uploads a photo for a task instance and returns its public URL.
export async function uploadTaskPhoto(taskId: string, file: File): Promise<string> {
  const blob = await resizeToJpeg(file)

  const res = await fetch('/api/tasks/photo-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task_id: taskId }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(body.error || 'Could not start upload')

  const { error } = await supabase.storage
    .from(TASK_PHOTO_BUCKET)
    .uploadToSignedUrl(body.path, body.token, blob, { contentType: 'image/jpeg' })
  if (error) throw new Error(friendlyUploadError(error.message))

  return body.publicUrl as string
}

// Uploads an optional reference photo for a note (patch 22) and returns its
// public URL — picked before the note exists, so unlike uploadTaskPhoto this
// isn't tied to an id; /api/notes/photo-upload just hands back a random path.
export async function uploadNotePhoto(file: File): Promise<string> {
  const blob = await resizeToJpeg(file)

  const res = await fetch('/api/notes/photo-upload', { method: 'POST' })
  const body = await res.json()
  if (!res.ok) throw new Error(body.error || 'Could not start upload')

  const { error } = await supabase.storage
    .from(NOTE_PHOTO_BUCKET)
    .uploadToSignedUrl(body.path, body.token, blob, { contentType: 'image/jpeg' })
  if (error) throw new Error(friendlyUploadError(error.message))

  return body.publicUrl as string
}
