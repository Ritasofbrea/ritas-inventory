// Patch 44: order-unit ("case") helpers for the Order List and Manage
// Items. Kept separate from units.ts's unitLabel (which this still uses)
// because these need the Item shape, not just a free-text unit string.
import { Item, getMainUnitTotal } from './types'
import { unitLabel } from './units'

// The word used for an item's order unit. When pack_size is set, the order
// unit is always "case" (plain word, per the patch) — this REPLACES the old
// units_per_sub_unit-based guess for those items. When pack_size is null,
// behavior is byte-for-byte the pre-patch-44 guess, unchanged (some items
// still rely on it until an owner sets a real pack size in Manage Items).
export function getOrderUnitLabel(item: Pick<Item, 'unit' | 'units_per_sub_unit' | 'pack_size'>): string {
  if (item.pack_size) return 'case'
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
export function packSizePreview(unit: string, packSize: number | null | undefined): string | null {
  if (!packSize || !Number.isFinite(packSize) || packSize <= 0) return null
  return `1 case = ${packSize} ${unitLabel(unit, packSize)}`
}
