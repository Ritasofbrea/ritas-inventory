import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { requireRole } from '@/lib/session'
import { isInvoiceScanRateLimited } from '@/lib/rate-limit'
import { INVOICE_PHOTO_BUCKET, MAX_INVOICE_PAGES, UUID_RE, invoicePagePath } from '@/lib/invoice-constants'

// Patch 63: one-time signed upload URL for one invoice page -- same idea
// as /api/notes/photo-upload (the browser uploads straight to Supabase,
// avoiding Vercel's ~4.5MB body limit), but:
//   - owners and shift leads only
//   - PRIVATE bucket: no public URL is ever returned
//   - the path is made here, "<invoice id>/<page>.jpg", for an existing
//     draft invoice only, page 1..MAX_INVOICE_PAGES
//   - only for a draft created in the last hour (a stale draft can't keep
//     collecting uploads), plus the shared invoice-scan rate limit
// upsert: true so retaking a page replaces it instead of failing.
const FRESH_DRAFT_MS = 60 * 60 * 1000

export async function POST(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner', 'shift_lead'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await request.json().catch(() => ({}))
  const invoiceId = typeof body.invoice_id === 'string' ? body.invoice_id : ''
  const page = Number(body.page)
  if (!UUID_RE.test(invoiceId)) return NextResponse.json({ error: 'Bad invoice id' }, { status: 400 })
  if (!Number.isInteger(page) || page < 1 || page > MAX_INVOICE_PAGES)
    return NextResponse.json({ error: `Page must be 1 to ${MAX_INVOICE_PAGES}` }, { status: 400 })

  if (await isInvoiceScanRateLimited(db))
    return NextResponse.json({ error: 'Too many invoice scans in a short time. Try again in a few minutes.' }, { status: 429 })

  const { data: invoice } = await db.from('invoices').select('id, status, created_at').eq('id', invoiceId).maybeSingle()
  if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  if (invoice.status !== 'draft') return NextResponse.json({ error: 'Pages can only be added to a draft' }, { status: 409 })
  if (Date.now() - new Date(invoice.created_at).getTime() > FRESH_DRAFT_MS)
    return NextResponse.json({ error: 'This draft is too old to add pages to. Start a new scan.' }, { status: 409 })

  const path = invoicePagePath(invoiceId, page)
  const { data, error } = await db.storage.from(INVOICE_PHOTO_BUCKET).createSignedUploadUrl(path, { upsert: true })
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Could not start upload' }, { status: 500 })
  return NextResponse.json({ path: data.path, token: data.token })
}
