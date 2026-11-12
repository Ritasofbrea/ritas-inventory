// Patch 68: matching one invoice line to one of OUR items. Pure functions,
// no database, so the rules are easy to test and to read.
//
// Order (first rule that applies wins):
//   a. only items whose vendor (vendorKeyForItem) is the invoice's vendor
//   b. exact vendor code match (capitals, spaces removed)        -> 'vendor_code'
//   c. else the 4-digit item number printed under a Bunzl code    -> 'item_number'
//   d. else suggestions only (never auto-matched): Balford "last 4
//      digits of the part = item_number", and a fuzzy description match.
//      The crew taps one to accept it                             -> 'manual'
//   e. a code (or item number) on MORE than one item: no pick, a human
//      chooses                                                     -> review 'shared_code'
//   f. SAFETY NET: the code points to one item but the printed item
//      number points to a DIFFERENT item: a human chooses          -> review 'code_number_conflict'
//      (the reader sometimes misreads a character, e.g. 8 as B or 4 as 9;
//      this check caught every such misread in the patch 65 experiment)
//   g. nothing matched: stays unmatched ('none'); adds no stock later.
import { vendorKeyForItem } from './vendor-schedule'

export type MatchItem = {
  id: string
  name: string
  distributor: string | null
  item_number: string | null
  vendor_item_code: string | null
  distributor_item_name?: string | null
  unit?: string | null
  invoice_units_per_case?: number | null
  is_off?: boolean | null
}

export type MatchMethod = 'vendor_code' | 'item_number' | 'manual' | 'skipped' | 'none'
export type ReviewReason = 'shared_code' | 'code_number_conflict'

export type AutoMatch = {
  item_id: string | null
  match_method: MatchMethod
  review_reason: ReviewReason | null
}

// Same cleaning as normalizeVendorCode's comparison form (capitals, no
// spaces), but never rejects: a code read off an invoice is compared as-is.
export function cleanCode(code: string | null | undefined): string {
  return (code ?? '').replace(/\s+/g, '').toUpperCase()
}

function cleanNumber(n: string | null | undefined): string {
  return (n ?? '').replace(/\s+/g, '')
}

export function itemsForVendor(items: MatchItem[], vendor: string): MatchItem[] {
  return items.filter((i) => vendorKeyForItem(i.distributor) === vendor)
}

export function autoMatch(
  line: { vendor_code: string | null; printed_item_number: string | null },
  vendor: string,
  allItems: MatchItem[]
): AutoMatch {
  const items = itemsForVendor(allItems, vendor)
  const code = cleanCode(line.vendor_code)
  const num = cleanNumber(line.printed_item_number)

  const byCode = code ? items.filter((i) => cleanCode(i.vendor_item_code) === code) : []
  const byNum = num ? items.filter((i) => cleanNumber(i.item_number) === num) : []

  if (byCode.length > 1) return { item_id: null, match_method: 'none', review_reason: 'shared_code' }
  if (byCode.length === 1) {
    const codeItem = byCode[0]
    if (byNum.length > 0 && !byNum.some((i) => i.id === codeItem.id))
      return { item_id: null, match_method: 'none', review_reason: 'code_number_conflict' }
    return { item_id: codeItem.id, match_method: 'vendor_code', review_reason: null }
  }
  if (byNum.length > 1) return { item_id: null, match_method: 'none', review_reason: 'shared_code' }
  if (byNum.length === 1) return { item_id: byNum[0].id, match_method: 'item_number', review_reason: null }
  return { item_id: null, match_method: 'none', review_reason: null }
}

// The items a human must choose between for a forced-pick line.
export function reviewCandidates(
  line: { vendor_code: string | null; printed_item_number: string | null; review_reason: ReviewReason | null },
  vendor: string,
  allItems: MatchItem[]
): MatchItem[] {
  if (!line.review_reason) return []
  const items = itemsForVendor(allItems, vendor)
  const code = cleanCode(line.vendor_code)
  const num = cleanNumber(line.printed_item_number)
  const out = new Map<string, MatchItem>()
  for (const i of items) {
    if (code && cleanCode(i.vendor_item_code) === code) out.set(i.id, i)
    if (num && cleanNumber(i.item_number) === num) out.set(i.id, i)
  }
  return [...out.values()]
}

export type Suggestion = { item: MatchItem; why: 'balford_part' | 'description'; score: number }

const STOP = new Set(['THE', 'AND', 'OF', 'FOR', 'WITH', 'RITA', 'RITAS', "RITA'S", 'BALFORD', 'CS', 'EA', 'MIX', 'GAL', 'OZ', 'LB', 'LBS'])

function words(s: string | null | undefined): string[] {
  return (s ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w))
}

// Share of the item's name words that appear in the invoice description,
// plus a little credit for the catalog name. 0..1.
function descriptionScore(desc: string | null, item: MatchItem): number {
  const d = new Set(words(desc))
  if (d.size === 0) return 0
  const score = (name: string | null | undefined) => {
    const w = words(name)
    if (w.length === 0) return 0
    const hits = w.filter((x) => d.has(x) || [...d].some((y) => y.startsWith(x) || x.startsWith(y))).length
    return hits / w.length
  }
  return Math.max(score(item.name), score(item.distributor_item_name))
}

// Suggestions for an unmatched line. Never auto-applied.
export function suggestionsFor(
  line: { vendor_code: string | null; description: string | null },
  vendor: string,
  allItems: MatchItem[],
  limit = 3
): Suggestion[] {
  const items = itemsForVendor(allItems, vendor)
  const out: Suggestion[] = []
  const code = cleanCode(line.vendor_code)
  if (vendor === 'balford' && /^\d{5,6}$/.test(code)) {
    const last4 = code.slice(-4)
    for (const i of items) if (cleanNumber(i.item_number) === last4) out.push({ item: i, why: 'balford_part', score: 1 })
  }
  const scored = items
    .filter((i) => !out.some((s) => s.item.id === i.id))
    .map((i) => ({ item: i, why: 'description' as const, score: descriptionScore(line.description, i) }))
    .filter((s) => s.score >= 0.5)
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name))
  return [...out, ...scored].slice(0, limit)
}

// How many of the item's stock units one invoice unit (usually one CS)
// holds, for this line. A size typed on the line wins; otherwise the
// item's invoice_units_per_case; otherwise an item counted in cases/boxes
// is 1 per CS (patch 63's rule for NULL). Unknown -> null (crew types it).
export type CaseSize = { size: number | null; source: 'line' | 'item' | 'box_counted' | 'unknown' }

export function caseSizeFor(lineSize: number | null, item: MatchItem | null): CaseSize {
  if (lineSize != null && lineSize > 0) return { size: lineSize, source: 'line' }
  if (!item) return { size: null, source: 'unknown' }
  if (item.invoice_units_per_case != null && Number(item.invoice_units_per_case) > 0)
    return { size: Number(item.invoice_units_per_case), source: 'item' }
  if (/^(cases?|box(es)?|cs)$/i.test((item.unit ?? '').trim())) return { size: 1, source: 'box_counted' }
  return { size: null, source: 'unknown' }
}
