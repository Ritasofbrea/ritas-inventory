// Patch 49: note photos used to be saved under a path built only from
// Date.now() + Math.random() in a public-read bucket -- guessable in a way
// task photos (prefixed by the task's UUID) weren't. POST /api/notes/
// photo-upload now prefixes new uploads with crypto.randomUUID() instead.
// Old photos, already uploaded under the old path, must keep loading
// unchanged -- this suite checks a REAL existing one (read-only, never
// printing its URL) alongside a freshly-created ZZTEST one.
//
// Also covers patch 49's route deletions (push-debug, migrate-counts,
// migrate-distributor, seed): each should now 404, nothing else should
// break.
import { apiFetch, loginAsOwner } from './helpers/auth.mjs'
import { rest } from './helpers/rest.mjs'
import { requiredEnv } from './helpers/config.mjs'
import { getServerSupabase } from '../../src/lib/supabase.ts'
import { NOTE_PHOTO_BUCKET } from '../../src/lib/note-photo-constants.ts'

let failures = 0
const check = (name, cond) => {
  if (cond) console.log(`ok - ${name}`)
  else {
    console.log(`FAIL - ${name}`)
    failures++
  }
}

const UUID_PREFIXED_PATH_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/\d+\.jpg$/i

async function run() {
  const db = getServerSupabase()
  const owner = await loginAsOwner()
  let notePhotoId = null
  let noteId = null
  let uploadedStoragePath = null
  let staffId = null

  try {
    // notes require created_by to be an active `staff` row (isActiveStaff) --
    // ZZTEST Owner (an `owners` row) doesn't qualify, so a disposable
    // ZZTEST staff fixture is needed just to post a note at all.
    const staffRes = await apiFetch('/api/staff', owner.cookie, { method: 'POST', body: JSON.stringify({ name: 'ZZTEST Notes Staff' }) })
    const staffBody = await staffRes.json()
    check('setup: ZZTEST staff fixture created', staffRes.status === 200 && !!staffBody.id)
    staffId = staffBody.id

    // --- role rules unchanged: no session -> 401 ---
    const noSessionRes = await apiFetch('/api/notes/photo-upload', null, { method: 'POST' })
    check('POST /api/notes/photo-upload with no session -> 401', noSessionRes.status === 401)

    // --- new upload gets a signed URL under a UUID-prefixed path ---
    const startRes = await apiFetch('/api/notes/photo-upload', owner.cookie, { method: 'POST' })
    const startBody = await startRes.json()
    check('POST /api/notes/photo-upload (owner) -> 200', startRes.status === 200)
    check('issued path is UUID-prefixed (crypto.randomUUID()/<timestamp>.jpg)', UUID_PREFIXED_PATH_RE.test(startBody.path))
    uploadedStoragePath = startBody.path

    // Actually upload a tiny real file to the signed URL, same call shape
    // uploadNotePhoto() uses client-side.
    const tinyJpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]) // minimal valid-enough JPEG SOI+EOI marker pair
    const { error: uploadError } = await db.storage
      .from(NOTE_PHOTO_BUCKET)
      .uploadToSignedUrl(startBody.path, startBody.token, tinyJpegBytes, { contentType: 'image/jpeg' })
    check('upload to the signed URL succeeded', !uploadError)

    // --- attach it to a real ZZTEST note, exactly like AddNoteModal does ---
    const createNoteRes = await apiFetch('/api/notes', owner.cookie, {
      method: 'POST',
      body: JSON.stringify({ content: 'ZZTEST note photo path fixture', created_by: 'ZZTEST Notes Staff', photo_urls: [startBody.publicUrl] }),
    })
    const createNoteBody = await createNoteRes.json()
    check('POST /api/notes with the new photo attached -> 200', createNoteRes.status === 200)
    noteId = createNoteBody.id
    notePhotoId = createNoteBody.photos?.[0]?.id ?? null
    check('note response includes the attached photo with the UUID-prefixed URL', createNoteBody.photos?.[0]?.photo_url === startBody.publicUrl)

    // --- it shows up on a fresh GET, same as any other note's photo ---
    const listRes = await apiFetch('/api/notes', owner.cookie)
    const listBody = await listRes.json()
    const found = Array.isArray(listBody) ? listBody.find((n) => n.id === noteId) : null
    check('the note (with its photo) shows up on GET /api/notes', !!found && found.photos?.[0]?.photo_url === startBody.publicUrl)

    // --- an EXISTING real photo (old path style) still loads -- read-only,
    // real data, never printing the URL itself ---
    const realPhotos = await rest('note_photos?select=photo_url&limit=1&order=created_at.asc')
    if (realPhotos.length > 0) {
      const realUrl = realPhotos[0].photo_url
      const realRes = await fetch(realUrl)
      check('an existing (pre-change) real note photo URL still loads -> 200', realRes.status === 200)
    } else {
      console.log('info - no existing real note photos found to check (nothing to verify, not a failure)')
    }
  } finally {
    // Cleanup: hard-delete the ZZTEST note (cascades note_photos), and the
    // uploaded storage object -- a normal DELETE /api/notes only archives,
    // so cleanup goes straight to REST/Storage, same convention as the
    // rest of this test suite's fixtures.
    if (noteId) {
      await rest(`notes?id=eq.${noteId}`, { method: 'DELETE' })
    }
    if (uploadedStoragePath) {
      const url = requiredEnv('NEXT_PUBLIC_SUPABASE_URL')
      const key = requiredEnv('SUPABASE_SERVICE_ROLE_KEY')
      await fetch(`${url}/storage/v1/object/${NOTE_PHOTO_BUCKET}/${uploadedStoragePath}`, {
        method: 'DELETE',
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      })
    }
    if (staffId) {
      await rest(`staff?id=eq.${staffId}`, { method: 'DELETE' })
    }
    console.log(`cleanup - removed ZZTEST note${notePhotoId ? ' + its photo row (cascaded)' : ''}, its uploaded test file, and the ZZTEST staff fixture`)
  }

  // --- deleted routes now 404, nothing else broke ---
  const deletedRouteChecks = [
    ['GET', '/api/push-debug'],
    ['POST', '/api/migrate-counts'],
    ['POST', '/api/migrate-distributor'],
    ['POST', '/api/seed'],
  ]
  for (const [method, path] of deletedRouteChecks) {
    const res = await apiFetch(path, null, { method })
    check(`${method} ${path} -> 404 (route deleted)`, res.status === 404)
  }

  // Sanity: a real, still-existing route still works fine (nothing else broke).
  const sanityRes = await apiFetch('/api/version')
  check('sanity: GET /api/version (unrelated route) still works -> 200', sanityRes.status === 200)

  console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`)
  process.exit(failures === 0 ? 0 : 1)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
