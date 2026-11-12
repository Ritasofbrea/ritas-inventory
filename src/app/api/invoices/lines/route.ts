import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { requireRole } from '@/lib/session'
import { UUID_RE, MAX_INVOICE_PAGES } from '@/lib/invoice-constants'
import { buildInvoiceLines, listInvoiceLines, updateInvoiceLines, type LineUpdate } from '@/lib/invoice-lines-server'

// Patch 68: invoice lines for the check-off screen. Owners and shift leads.
//   GET   ?invoice_id=<uuid>                         -> header, totals check, lines with match state
//   POST  { invoice_id, pages?, confirm_replace? }   -> (re)build lines from the reader results
//         409 { code: 'crew_entries', pages } if a page already has crew entries
//   PATCH { invoice_id, updates: [{ id, item_id? | skip? | reset_match?, qty_received?, checked?, units_per_invoice_unit? }] }
// No stock is touched here (patch 69 confirms).
const ROLES: ('owner' | 'shift_lead')[] = ['owner', 'shift_lead']

export async function GET(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ROLES)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const id = new URL(request.url).searchParams.get('invoice_id') ?? ''
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Bad invoice id' }, { status: 400 })
  const out = await listInvoiceLines(db, id)
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status })
  return NextResponse.json(out.view)
}

export async function POST(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ROLES)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const body = await request.json().catch(() => ({}))
  const id = typeof body.invoice_id === 'string' ? body.invoice_id : ''
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Bad invoice id' }, { status: 400 })
  let pages: number[] | undefined
  if (body.pages !== undefined) {
    if (!Array.isArray(body.pages) || !body.pages.every((p: unknown) => Number.isInteger(p) && (p as number) >= 1 && (p as number) <= MAX_INVOICE_PAGES))
      return NextResponse.json({ error: 'Bad pages' }, { status: 400 })
    pages = body.pages
  }
  const out = await buildInvoiceLines(db, id, { pages, confirmReplace: body.confirm_replace === true })
  if (!out.ok) return NextResponse.json({ error: out.error, code: out.code, pages: out.pages }, { status: out.status })
  return NextResponse.json(out)
}

export async function PATCH(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ROLES)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const body = await request.json().catch(() => ({}))
  const id = typeof body.invoice_id === 'string' ? body.invoice_id : ''
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Bad invoice id' }, { status: 400 })
  const out = await updateInvoiceLines(db, id, body.updates as LineUpdate[], auth.session.name ?? null)
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status })
  return NextResponse.json(out)
}
