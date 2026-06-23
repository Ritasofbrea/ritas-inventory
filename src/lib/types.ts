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
  sort_order: number
  supplier_order: number | null
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
  created_at: string
  items?: Item
}

export type StockStatus = 'out' | 'low' | 'ok'

export function getStockStatus(item: Item): StockStatus {
  if (item.par_level === 0) return 'ok'
  if (item.current_count === 0) return 'out'
  if (item.current_count < item.par_level) return 'low'
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
