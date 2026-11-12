// Invoice fixtures for invoice-read-checks.mjs and invoice-read-live.mjs.
// Test invoices are created through the real routes as ZZTEST Owner /
// ZZTEST Shift Lead (created_by is the session name), so they are easy to
// find and can never be confused with a real scan. Cleanup is always by
// id: storage photos first, then the row. The service-role key is read
// from process.env only and never printed.
import { apiFetch } from './auth.mjs'
import { rest } from './rest.mjs'
import { requiredEnv } from './config.mjs'

const BUCKET = 'invoice-photos'
const ZZTEST_CREATORS = ['ZZTEST Owner', 'ZZTEST Shift Lead']

// A tiny valid 1x1 JPEG. The bucket only checks the content type; the
// mocked reader never looks at the pixels.
export const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AR//Z',
  'base64'
)

function storageHeaders(extra = {}) {
  const key = requiredEnv('SUPABASE_SERVICE_ROLE_KEY')
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra }
}

// POST /api/invoices -> signed upload per page -> PUT the bytes -> PATCH to save photo_paths.
export async function createDraftWithPages(cookie, vendor, pages) {
  const res = await apiFetch('/api/invoices', cookie, { method: 'POST', body: JSON.stringify({ vendor }) })
  if (!res.ok) throw new Error(`create draft -> ${res.status} ${await res.text()}`)
  const invoice = await res.json()
  for (let i = 0; i < pages.length; i++) {
    const up = await apiFetch('/api/invoices/photo-upload', cookie, {
      method: 'POST',
      body: JSON.stringify({ invoice_id: invoice.id, page: i + 1 }),
    })
    if (!up.ok) throw new Error(`photo-upload -> ${up.status} ${await up.text()}`)
    const { path, token } = await up.json()
    const put = await fetch(
      `${requiredEnv('NEXT_PUBLIC_SUPABASE_URL')}/storage/v1/object/upload/sign/${BUCKET}/${path}?token=${encodeURIComponent(token)}`,
      { method: 'PUT', headers: { 'Content-Type': 'image/jpeg', 'x-upsert': 'true' }, body: pages[i] }
    )
    if (!put.ok) throw new Error(`signed upload -> ${put.status} ${await put.text()}`)
  }
  const fin = await apiFetch('/api/invoices', cookie, { method: 'PATCH', body: JSON.stringify({ id: invoice.id }) })
  if (!fin.ok) throw new Error(`save pages -> ${fin.status} ${await fin.text()}`)
  return fin.json()
}

export async function listInvoicePhotos(id) {
  const res = await fetch(`${requiredEnv('NEXT_PUBLIC_SUPABASE_URL')}/storage/v1/object/list/${BUCKET}`, {
    method: 'POST',
    headers: storageHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ prefix: id, limit: 100 }),
  })
  if (!res.ok) throw new Error(`list photos -> ${res.status}`)
  const files = await res.json()
  return files.map((f) => `${id}/${f.name}`)
}

export async function getInvoice(id) {
  const rows = await rest(`invoices?id=eq.${id}&select=*`)
  return rows[0] ?? null
}

// Deletes photos then the row, by id. Returns what's left (should be nothing).
export async function deleteInvoiceById(id) {
  const paths = await listInvoicePhotos(id)
  if (paths.length > 0) {
    const res = await fetch(`${requiredEnv('NEXT_PUBLIC_SUPABASE_URL')}/storage/v1/object/${BUCKET}`, {
      method: 'DELETE',
      headers: storageHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ prefixes: paths }),
    })
    if (!res.ok) throw new Error(`remove photos -> ${res.status}`)
  }
  await rest(`invoices?id=eq.${id}`, { method: 'DELETE' })
  return { photosLeft: (await listInvoicePhotos(id)).length, rowLeft: !!(await getInvoice(id)) }
}

// Leftovers from a crashed run: every invoice created by a ZZTEST account.
export async function sweepZztestInvoices() {
  const list = ZZTEST_CREATORS.map((n) => `"${n}"`).join(',')
  const rows = await rest(`invoices?created_by=in.(${encodeURIComponent(list)})&select=id`)
  for (const r of rows) await deleteInvoiceById(r.id)
  return rows.length
}
