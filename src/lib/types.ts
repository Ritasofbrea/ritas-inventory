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

export function getStockStatus(item: Item): StockStatus {
  const hasPrimaryPar = item.par_level > 0
  const hasSecondaryPar =
    item.secondary_unit !== '' && item.par_level_secondary != null && item.par_level_secondary > 0

  if (!hasPrimaryPar && !hasSecondaryPar) return 'ok'

  const primaryOut = hasPrimaryPar && item.current_count === 0
  const secondaryOut = hasSecondaryPar && item.secondary_count === 0
  if (primaryOut || secondaryOut) return 'out'

  const primaryLow = hasPrimaryPar && item.current_count < item.par_level
  const secondaryLow = hasSecondaryPar && item.secondary_count < item.par_level_secondary!
  if (primaryLow || secondaryLow) return 'low'

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
