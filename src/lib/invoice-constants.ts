// Patch 63: invoice scanning (storage only). Shared by the /api/invoices
// routes and the Scan Invoice screen.

// PRIVATE bucket (supabase/patch-63-invoices.sql). Never call getPublicUrl
// on it -- photos are only ever shown through short-lived signed links.
export const INVOICE_PHOTO_BUCKET = 'invoice-photos'

// vendorKeyForItem keys. 'other' covers anything that isn't Bunzl/Balford.
export const INVOICE_VENDORS = ['bunzl', 'balford', 'other'] as const
export type InvoiceVendor = (typeof INVOICE_VENDORS)[number]

export const INVOICE_STATUSES = ['draft', 'read', 'received', 'discarded'] as const
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]

// A Bunzl/Balford invoice is usually 1-2 pages; 10 leaves room without
// letting one draft collect an unbounded number of uploads.
export const MAX_INVOICE_PAGES = 10

// Long edge for invoice photos -- bigger than notes/tasks' 1600px so small
// print stays readable for the reader in patch 65.
export const INVOICE_PHOTO_MAX_EDGE = 2400

// Signed view links last 10 minutes.
export const INVOICE_SIGNED_URL_SECONDS = 600

// Server-made storage path for one page: "<invoice id>/<page>.jpg".
export function invoicePagePath(invoiceId: string, page: number): string {
  return `${invoiceId}/${page}.jpg`
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
