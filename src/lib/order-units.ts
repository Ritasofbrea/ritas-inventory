// Patch 44: order-unit ("case") helpers for the Order List and Manage
// Items. Kept separate from units.ts's unitLabel (which this still uses)
// because these need the Item shape, not just a free-text unit string.
import { Item, getMainUnitTotal } from './types'
import { unitLabel } from './units'

// Patch 56: the ONE gate for box/case math everywhere (Order List, Receive
// Order, Manage Items' pack-size editor) -- any item with a positive
// whole-number pack_size. Patch 55 originally scoped this to Ice Mix +
// gallons + pack_size===4 only, specifically so Sugar Free Ice Mix (then
// pack_size=null) wasn't swept in by accident. Patch 56 gives Sugar Free
// (pack_size=6) and Syrups (pack_size=2) the same box treatment on
// purpose, and fixes a real latent bug along the way: Receive Order never
// converted a typed quantity for any OTHER pre-existing pack_size item
// (Matcha Syrup, Chocolate Base, Caramel, Peanut Butter Topping, etc.) --
// only Ice Mix's narrow gate got the conversion, so those items' short/
// full comparisons were already silently comparing case-counts against
// stock-unit counts. Broadening the gate to "any pack_size" fixes that
// for every such item, not just the three named in this patch.
export function usesBoxOrdering(item: Pick<Item, 'pack_size'>): boolean {
  return typeof item.pack_size === 'number' && Number.isInteger(item.pack_size) && item.pack_size > 0
}

// Patch 56: the word choice is now independent of the math gate above --
// "box" for Ice Mix and Syrups (the two categories patches 55/56 actually
// ship box-denominated ordering for), "case" for every other pack_size
// item (Matcha Syrup, Chocolate Base, Caramel, Peanut Butter Topping,
// etc. -- unchanged wording from before this patch).
export function getPackWord(item: Pick<Item, 'category'>): 'box' | 'case' {
  return item.category === 'Ice Mix' || item.category === 'Syrups' ? 'box' : 'case'
}

// The word used for an item's order unit. When pack_size is set, the order
// unit is "box" or "case" per getPackWord() above -- this REPLACES the old
// units_per_sub_unit-based guess for those items. When pack_size is null,
// behavior is byte-for-byte the pre-patch-44 guess, unchanged (some items
// still rely on it until an owner sets a real pack size in Manage Items).
export function getOrderUnitLabel(item: Pick<Item, 'category' | 'unit' | 'units_per_sub_unit' | 'pack_size'>): string {
  // 'boxes' (plural, the dictionary key units.ts's unitLabel() actually
  // recognizes), not the singular 'box' -- unitLabel's generic "+s"
  // pluralizer would turn a singular 'box' into the wrong "boxs" for any
  // count other than 1. 'case' is spared this because "case"+"s" happens
  // to already be correct English.
  if (usesBoxOrdering(item)) return getPackWord(item) === 'box' ? 'boxes' : 'case'
  if (!item.units_per_sub_unit) return item.unit
  return item.unit === 'boxes' ? 'boxes' : 'cases'
}

// Smallest whole number of order units that reaches par. Only takes over
// when pack_size is set; null pack_size keeps the exact pre-patch-44
// default-quantity formula (shortage in stock units, or shortage /
// units_per_sub_unit when that's set) so nothing already in use changes.
export function getDefaultOrderQty(item: Item): number {
  const shortage = Math.max(0, item.par_level - getMainUnitTotal(item))
  if (usesBoxOrdering(item)) return Math.ceil(shortage / (item.pack_size as number))
  if (item.units_per_sub_unit) return Math.ceil(shortage / item.units_per_sub_unit)
  return shortage
}

// "1 case = 4 gallons" preview line for Manage Items' pack-size field and
// under an Order List line that has one. null when there's nothing to
// preview (no pack size set, or an invalid/non-positive one mid-edit).
// orderUnitWord defaults to 'case' (every pre-patch-55 call site/item);
// pass 'box' explicitly for an item getPackWord() returns 'box' for.
export function packSizePreview(unit: string, packSize: number | null | undefined, orderUnitWord: string = 'case'): string | null {
  if (!packSize || !Number.isFinite(packSize) || packSize <= 0) return null
  return `1 ${orderUnitWord} = ${packSize} ${unitLabel(unit, packSize)}`
}

// Patch 55/56: splits a stock-unit total into whole boxes/cases + a
// remainder, for Order List's "Have: 6 gallons (1 box + 2 gallons)" /
// "Par: 8 gallons (2 boxes)" lines -- a zero part is hidden entirely
// rather than shown as "0 boxes" or "+ 0 bottles". Only ever called for
// an item usesBoxOrdering() is true for, so packSize is always a real
// positive whole number in practice, but this stays generic (not
// hardcoded to any one pack size). Patch 56: generalized off gallons --
// takes the item's real unit and the box/case word (plural-storage form,
// e.g. 'boxes' or 'case', same convention getOrderUnitLabel uses) instead
// of hardcoding "gallons"/"boxes", so this reads correctly for bottles,
// bags, containers, or any other stock unit.
export function formatUnitsWithBoxes(totalUnits: number, packSize: number, unit: string, boxUnitWord: string): string {
  const unitsPart = `${totalUnits} ${unitLabel(unit, totalUnits)}`
  if (!packSize || packSize <= 0) return unitsPart
  // Tiny epsilon guards a float like 7.999999999 from flooring to 1 box
  // short of what it actually is.
  const boxes = Math.floor(totalUnits / packSize + 1e-9)
  const remainder = Math.round((totalUnits - boxes * packSize) * 100) / 100
  if (boxes <= 0) return unitsPart
  const boxesPart = `${boxes} ${unitLabel(boxUnitWord, boxes)}`
  if (remainder <= 0) return `${unitsPart} (${boxesPart})`
  return `${unitsPart} (${boxesPart} + ${remainder} ${unitLabel(unit, remainder)})`
}
