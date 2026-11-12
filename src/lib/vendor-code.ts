// Patch 67: one way to clean a vendor code (items.vendor_item_code), shared
// by the Vendor Code popup (live message), the owner-only route (the rule
// that actually counts), and later invoice matching, so a code typed by
// hand and a code read off an invoice compare the same way.
//   - capital letters
//   - all spaces removed
//   - only letters, numbers and hyphens
//   - at most 20 characters
//   - blank means "no code" (null)
export const VENDOR_CODE_MAX = 20

export type VendorCodeResult = { ok: true; code: string | null } | { ok: false; error: string }

export function normalizeVendorCode(raw: unknown): VendorCodeResult {
  if (raw === null || raw === undefined) return { ok: true, code: null }
  if (typeof raw !== 'string') return { ok: false, error: 'The code must be text.' }
  const code = raw.replace(/\s+/g, '').toUpperCase()
  if (code === '') return { ok: true, code: null }
  if (!/^[A-Z0-9-]+$/.test(code)) return { ok: false, error: 'Use only letters, numbers and hyphens.' }
  if (code.length > VENDOR_CODE_MAX) return { ok: false, error: `Codes can be at most ${VENDOR_CODE_MAX} characters.` }
  return { ok: true, code }
}
