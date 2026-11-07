export type Category =
  | 'Containers & Cups'
  | 'Lids'
  | 'Spoons & Straws'
  | 'Topping Containers'
  | 'Toppings - Dry'
  | 'Toppings - Wet'
  | 'Syrups'
  | 'Ice Mix'
  | 'Custard'
  | 'Things to Make Ice'
  | 'Cones'
  | 'Cookies'
  | 'Drink Items'
  | 'Bags & Carriers'
  | 'Napkins & Paper'
  | 'Cleaning Supplies'
  | 'Bathroom Supplies'
  | 'Trash Bags'
  | 'Stickers & Receipts'

export type Role = 'shift_lead' | 'owner'

export interface Item {
  id: string
  name: string
  category: Category
  unit: string
  current_count: number
  par_level: number
  par_level_secondary: number | null
  sort_order: number
  supplier_order: number | null
  distributor: string | null
  item_number: string | null
  distributor_item_name: string | null
  secondary_count: number
  secondary_unit: string
  units_per_sub_unit: number | null
  is_off: boolean
  has_storage: boolean
  storage_count: number
  storage_updated_at: string | null
  created_at: string
  updated_at: string
}

export interface InventoryCount {
  id: string
  item_id: string
  count: number
  entered_by: string
  notes: string | null
  type: 'count' | 'adjustment'
  is_test_data: boolean
  created_at: string
  items?: Item
}

export type StockStatus = 'out' | 'low' | 'ok'

// Combines full-unit and sub-unit counts into one main-unit total, e.g.
// 0 boxes + 8 sleeves at 20 sleeves/box = 0.4 boxes. Patch 38: for a
// has_storage item, storage_count is added in on top -- it's always in the
// same (primary) unit as current_count, no sub-unit conversion of its own.
// Items without has_storage are untouched (storage_count defaults to 0
// anyway, but the explicit check keeps this correct even if that ever
// isn't true).
export function getMainUnitTotal(item: Item): number {
  let total = item.units_per_sub_unit && item.units_per_sub_unit > 0
    ? item.current_count + item.secondary_count / item.units_per_sub_unit
    : item.current_count
  if (item.has_storage) total += item.storage_count
  return total
}

export function getStockStatus(item: Item): StockStatus {
  if (item.par_level <= 0) return 'ok'

  const total = getMainUnitTotal(item)
  if (total === 0) return 'out'
  if (total < item.par_level) return 'low'
  return 'ok'
}

export const CATEGORIES: Category[] = [
  'Containers & Cups',
  'Lids',
  'Spoons & Straws',
  'Topping Containers',
  'Toppings - Dry',
  'Toppings - Wet',
  'Syrups',
  'Ice Mix',
  'Custard',
  'Things to Make Ice',
  'Cones',
  'Cookies',
  'Drink Items',
  'Bags & Carriers',
  'Napkins & Paper',
  'Cleaning Supplies',
  'Bathroom Supplies',
  'Trash Bags',
  'Stickers & Receipts',
]
