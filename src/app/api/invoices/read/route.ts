import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { requireRole } from '@/lib/session'
import { UUID_RE } from '@/lib/invoice-constants'
import { runInvoicePageRead } from '@/lib/invoice-read-server'

// Patch 65: read ONE page of a scanned invoice with the Anthropic API.
// POST { invoice_id, page } -> { result, totals_check, reads_left, status, ... }
// Owners and shift leads only. All the rules (draft/read only, page must be
// in photo_paths, per-page and app-wide read caps, retry once when the API
// is busy, saving into raw_extraction) live in runInvoicePageRead.
// The photo and the API key never leave the server.

// 60s fits Vercel Hobby either way: 60s is the Hobby cap without Fluid
// compute, 300s with it. The reader stops by READ_DEADLINE_MS (50s) so
// there's time left to save. Opus 5.5 took up to 35s on a page in testing.
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner', 'shift_lead'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await request.json().catch(() => ({}))
  const invoiceId = typeof body.invoice_id === 'string' ? body.invoice_id : ''
  const page = Number(body.page)
  if (!UUID_RE.test(invoiceId)) return NextResponse.json({ error: 'Bad invoice id' }, { status: 400 })

  const out = await runInvoicePageRead(db, { invoiceId, page })
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status })
  return NextResponse.json(out)
}
