// Patch 44: order-unit ("case") helpers for the Order List and Manage
// Items. Kept separate from units.ts's unitLabel (which this still uses)
// because these need the Item shape, not just a free-text unit string.
import { Item, getMainUnitTotal } from './types'
import { unitLabel } from './units'

// Patch 55: Ice Mix is received/ordered by the box (1 box = 4 gallons,
// the vendor's real case size -- "LEMON BASE (4/1GAL)") while counting,
// par, and every stock number stay in gallons, unchanged. This is the one
// shared check for "does this item get box wording/math," used by Order
// List, Receive Order, and Manage Items' pack-size editor -- never a
// bare `item.category === 'Ice Mix'` check on its own, so a future
// Ice Mix item with a different real case size (like the Sugar Free
// bottles, which are NOT pack_size=4/unit=gallons) is never swept in by
// accident. Checked live: this exact combination matches all 46 non-
// Sugar-Free Ice Mix items and zero items in any other category.
export function usesBoxOrdering(item: Pick<Item, 'category' | 'unit' | 'pack_size'>): boolean {
  return item.category === 'Ice Mix' && item.unit === 'gallons' && item.pack_size === 4
}

// The word used for an item's order unit. When pack_size is set, the order
// unit is "box" for Ice Mix's 4-gallon cases (patch 55) or plain "case"
// for every other item with a pack_size (Matcha Syrup, Chocolate Base,
// etc.) — this REPLACES the old units_per_sub_unit-based guess for those
// items. When pack_size is null, behavior is byte-for-byte the
// pre-patch-44 guess, unchanged (some items still rely on it until an
// owner sets a real pack size in Manage Items).
export function getOrderUnitLabel(item: Pick<Item, 'category' | 'unit' | 'units_per_sub_unit' | 'pack_size'>): string {
  // 'boxes' (plural, the dictionary key units.ts's unitLabel() actually
  // recognizes), not the singular 'box' -- unitLabel's generic "+s"
  // pluralizer would turn a singular 'box' into the wrong "boxs" for any
  // count other than 1. 'case' is spared this because "case"+"s" happens
  // to already be correct English.
  if (item.pack_size) return usesBoxOrdering(item) ? 'boxes' : 'case'
  if (!item.units_per_sub_unit) return item.unit
  return item.unit === 'boxes' ? 'boxes' : 'cases'
}

// Smallest whole number of order units that reaches par. Only takes over
// when pack_size is set; null pack_size keeps the exact pre-patch-44
// default-quantity formula (shortage in stock units, or shortage /
// units_per_sub_unit when that's set) so nothing already in use changes.
export function getDefaultOrderQty(item: Item): number {
  const shortage = Math.max(0, item.par_level - getMainUnitTotal(item))
  if (item.pack_size) return Math.ceil(shortage / item.pack_size)
  if (item.units_per_sub_unit) return Math.ceil(shortage / item.units_per_sub_unit)
  return shortage
}

// "1 case = 4 gallons" preview line for Manage Items' pack-size field and
// under an Order List line that has one. null when there's nothing to
// preview (no pack size set, or an invalid/non-positive one mid-edit).
// orderUnitWord defaults to 'case' (every pre-patch-55 call site/item);
// pass 'box' explicitly for an item usesBoxOrdering() is true for.
export function packSizePreview(unit: string, packSize: number | null | undefined, orderUnitWord: string = 'case'): string | null {
  if (!packSize || !Number.isFinite(packSize) || packSize <= 0) return null
  return `1 ${orderUnitWord} = ${packSize} ${unitLabel(unit, packSize)}`
}

// Patch 55: splits a gallon amount into whole boxes + a remainder, for
// Order List's "Have: 6 gal (1 box + 2 gal)" / "Par: 8 gal (2 boxes)"
// lines -- a zero part is hidden entirely rather than shown as "0 boxes"
// or "+ 0 gal". Only ever called for an item usesBoxOrdering() is true
// for, so packSize is always a real positive number (4) in practice, but
// this stays generic (not hardcoded to 4) the same way the rest of this
// file never hardcodes a specific pack size.
export function formatGallonsWithBoxes(totalGallons: number, packSize: number): string {
  const gallonsPart = `${totalGallons} ${unitLabel('gallons', totalGallons)}`
  if (!packSize || packSize <= 0) return gallonsPart
  // Tiny epsilon guards a float like 7.999999999 from flooring to 1 box
  // short of what it actually is.
  const boxes = Math.floor(totalGallons / packSize + 1e-9)
  const remainder = Math.round((totalGallons - boxes * packSize) * 100) / 100
  if (boxes <= 0) return gallonsPart
  const boxesPart = `${boxes} ${unitLabel('boxes', boxes)}`
  if (remainder <= 0) return `${gallonsPart} (${boxesPart})`
  return `${gallonsPart} (${boxesPart} + ${remainder} ${unitLabel('gallons', remainder)})`
}
