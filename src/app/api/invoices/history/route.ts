import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { requireRole } from '@/lib/session'
import {
  getInvoiceHistoryDetail,
  invoiceIdsForReceipts,
  listReceivedInvoices,
  listUnconfirmedInvoices,
} from '@/lib/invoice-history-server'

// Patch 70: invoice history, read-only. Owners and shift leads (server-enforced).
//   GET ?page=0&q=<invoice number>&vendor=bunzl|balford|other  -> one page of received invoices
//   GET ?id=<uuid>                                             -> one received invoice, lines, signed photo links
//   GET ?receipt_ids=<uuid>,<uuid>                             -> { links: { receipt_id: invoice_id } }
//   GET ?unconfirmed=1                                         -> read but not confirmed invoices (Scan Invoice nudge)
const ROLES: ('owner' | 'shift_lead')[] = ['owner', 'shift_lead']

export async function GET(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ROLES)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const sp = new URL(request.url).searchParams

  const id = sp.get('id')
  if (id !== null) {
    const out = await getInvoiceHistoryDetail(db, id)
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status })
    return NextResponse.json(out.detail)
  }

  const receiptIds = sp.get('receipt_ids')
  if (receiptIds !== null) {
    const out = await invoiceIdsForReceipts(db, receiptIds.split(',').map((s) => s.trim()).filter(Boolean))
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status })
    return NextResponse.json({ links: out.links })
  }

  if (sp.get('unconfirmed') === '1') {
    const out = await listUnconfirmedInvoices(db)
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status })
    return NextResponse.json({ invoices: out.invoices })
  }

  const pageRaw = sp.get('page')
  const page = pageRaw === null ? 0 : Number(pageRaw)
  if (!Number.isInteger(page) || page < 0 || page > 10000) return NextResponse.json({ error: 'Bad page' }, { status: 400 })
  const out = await listReceivedInvoices(db, { q: sp.get('q'), vendor: sp.get('vendor'), page })
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status })
  return NextResponse.json({ invoices: out.invoices, page: out.page, has_more: out.has_more })
}
