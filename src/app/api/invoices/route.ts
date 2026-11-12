import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { requireRole } from '@/lib/session'
import { isInvoiceScanRateLimited } from '@/lib/rate-limit'
import {
  INVOICE_PHOTO_BUCKET,
  INVOICE_VENDORS,
  INVOICE_SIGNED_URL_SECONDS,
  MAX_INVOICE_PAGES,
  UUID_RE,
} from '@/lib/invoice-constants'

// Patch 63: invoice scanning, storage only. No reading, no stock.
// Owners and shift leads only, on every method.
//
// Flow from the Scan Invoice screen:
//   POST   { vendor }              -> new draft row
//   POST   /api/invoices/photo-upload { invoice_id, page } per page -> signed upload URL
//   PATCH  { id }                  -> server lists what was actually uploaded and saves photo_paths
//   DELETE { id }                  -> removes a draft and its photos (failed save / cleanup)
//   GET                            -> recent invoices
//   GET    ?id=<uuid>              -> one invoice + short-lived signed view links

const ROLES: ('owner' | 'shift_lead')[] = ['owner', 'shift_lead']

function pageNumberFromName(name: string): number | null {
  const m = /^(\d+)\.jpg$/.exec(name)
  if (!m) return null
  const n = Number(m[1])
  return n >= 1 && n <= MAX_INVOICE_PAGES ? n : null
}

export async function GET(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ROLES)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const id = new URL(request.url).searchParams.get('id')
  if (id) {
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 })
    const { data: row, error } = await db
      .from('invoices')
      .select('id, vendor, status, invoice_number, invoice_date, photo_paths, created_by, created_at, raw_extraction')
      .eq('id', id)
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!row) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    // Patch 68: which pages have a reader result and how many reads each
    // page has used (busy attempts don't count), so the Scan Invoice screen
    // can resume reading. raw_extraction itself is never returned here.
    const { raw_extraction, ...invoice } = row
    const raw = (raw_extraction ?? {}) as { pages?: Record<string, unknown>; attempts?: { page: number; outcome: string }[] }
    const pages_read = Object.keys(raw.pages ?? {}).map(Number).filter(Number.isInteger).sort((a, b) => a - b)
    const reads_used: Record<string, number> = {}
    for (const a of raw.attempts ?? []) if (a.outcome !== 'busy') reads_used[String(a.page)] = (reads_used[String(a.page)] ?? 0) + 1

    const paths: string[] = invoice.photo_paths ?? []
    let pages: { page: number; url: string | null }[] = []
    if (paths.length > 0) {
      const { data: signed, error: signError } = await db.storage
        .from(INVOICE_PHOTO_BUCKET)
        .createSignedUrls(paths, INVOICE_SIGNED_URL_SECONDS)
      if (signError) return NextResponse.json({ error: signError.message }, { status: 500 })
      pages = paths.map((p, i) => ({ page: i + 1, url: signed?.[i]?.signedUrl ?? null }))
    }
    return NextResponse.json({ ...invoice, pages, pages_read, reads_used, expires_in: INVOICE_SIGNED_URL_SECONDS })
  }

  const { data, error } = await db
    .from('invoices')
    .select('id, vendor, status, invoice_number, invoice_date, photo_paths, created_by, created_at')
    .neq('status', 'discarded')
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ROLES)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await request.json().catch(() => ({}))
  const vendor = typeof body.vendor === 'string' ? body.vendor.trim().toLowerCase() : ''
  if (!(INVOICE_VENDORS as readonly string[]).includes(vendor))
    return NextResponse.json({ error: 'Pick a vendor' }, { status: 400 })

  if (await isInvoiceScanRateLimited(db))
    return NextResponse.json({ error: 'Too many invoice scans in a short time. Try again in a few minutes.' }, { status: 429 })

  const { data, error } = await db
    .from('invoices')
    .insert({ vendor, status: 'draft', created_by: auth.session.name })
    .select('id, vendor, status, invoice_number, invoice_date, photo_paths, created_by, created_at')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// Saves photo_paths from what is ACTUALLY in storage under "<id>/", never
// from a list the browser sends, so the row can't point at files that
// don't exist or belong to another invoice.
export async function PATCH(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ROLES)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await request.json().catch(() => ({}))
  const id = typeof body.id === 'string' ? body.id : ''
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 })

  const { data: invoice } = await db.from('invoices').select('id, status').eq('id', id).maybeSingle()
  if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  if (invoice.status !== 'draft') return NextResponse.json({ error: 'Only a draft can be changed here' }, { status: 409 })

  const { data: files, error: listError } = await db.storage.from(INVOICE_PHOTO_BUCKET).list(id, { limit: 100 })
  if (listError) return NextResponse.json({ error: listError.message }, { status: 500 })
  const pages = (files ?? [])
    .map((f) => pageNumberFromName(f.name))
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b)
  if (pages.length === 0) return NextResponse.json({ error: 'No pages were uploaded' }, { status: 400 })

  const photo_paths = pages.map((n) => `${id}/${n}.jpg`)
  const { data, error } = await db
    .from('invoices')
    .update({ photo_paths })
    .eq('id', id)
    .eq('status', 'draft')
    .select('id, vendor, status, invoice_number, invoice_date, photo_paths, created_by, created_at')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// Discard / delete.
//   draft never read  -> photos removed, row deleted (patch 63)
//   draft with reads,
//   or a read invoice -> photos removed, its invoice_lines removed, row kept
//                        as 'discarded' (patch 65/68): the row holds the read
//                        attempts that count toward the app-wide read caps.
//                        GET's list hides 'discarded'.
//   received          -> never (409): it has already added stock (patch 69).
// Owners and shift leads.
export async function DELETE(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ROLES)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await request.json().catch(() => ({}))
  const id = typeof body.id === 'string' ? body.id : ''
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 })

  const { data: invoice } = await db.from('invoices').select('id, status, raw_extraction').eq('id', id).maybeSingle()
  if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  if (invoice.status === 'received') return NextResponse.json({ error: "A received invoice can't be discarded." }, { status: 409 })
  if (invoice.status !== 'draft' && invoice.status !== 'read')
    return NextResponse.json({ error: 'This invoice was already discarded.' }, { status: 409 })

  const { data: files, error: listError } = await db.storage.from(INVOICE_PHOTO_BUCKET).list(id, { limit: 100 })
  if (listError) return NextResponse.json({ error: listError.message }, { status: 500 })
  const paths = (files ?? []).map((f) => `${id}/${f.name}`)
  if (paths.length > 0) {
    const { error: removeError } = await db.storage.from(INVOICE_PHOTO_BUCKET).remove(paths)
    if (removeError) return NextResponse.json({ error: removeError.message }, { status: 500 })
  }

  const attempts = (invoice.raw_extraction as { attempts?: unknown[] } | null)?.attempts
  const keepRow = invoice.status === 'read' || (Array.isArray(attempts) && attempts.length > 0)
  if (keepRow) {
    const { error: linesError } = await db.from('invoice_lines').delete().eq('invoice_id', id)
    if (linesError) return NextResponse.json({ error: linesError.message }, { status: 500 })
    const { data: done, error } = await db
      .from('invoices')
      .update({ status: 'discarded', photo_paths: [] })
      .eq('id', id)
      .in('status', ['draft', 'read'])
      .select('id')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!done || done.length === 0) return NextResponse.json({ error: 'This invoice changed while discarding. Try again.' }, { status: 409 })
    return NextResponse.json({ ok: true, removed_photos: paths.length, discarded: true })
  }

  const { error } = await db.from('invoices').delete().eq('id', id).eq('status', 'draft')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, removed_photos: paths.length })
}
