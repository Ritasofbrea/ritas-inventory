import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'

const SEED_ITEMS = [
  { name: '4 oz Cups',            category: 'Containers & Cups', unit: 'sleeves',     par_level: 3, sort_order: 10 },
  { name: '6 oz Cups',            category: 'Containers & Cups', unit: 'sleeves',     par_level: 3, sort_order: 20 },
  { name: '8 oz Cups',            category: 'Containers & Cups', unit: 'sleeves',     par_level: 4, sort_order: 30 },
  { name: '12 oz Cups',           category: 'Containers & Cups', unit: 'sleeves',     par_level: 4, sort_order: 40 },
  { name: '16 oz Cups',           category: 'Containers & Cups', unit: 'sleeves',     par_level: 3, sort_order: 50 },
  { name: 'Quart Containers',     category: 'Containers & Cups', unit: 'boxes',       par_level: 2, sort_order: 60 },
  { name: 'Small Lids (4/6 oz)',  category: 'Lids',              unit: 'sleeves',     par_level: 3, sort_order: 10 },
  { name: 'Medium Lids (8/12 oz)',category: 'Lids',              unit: 'sleeves',     par_level: 3, sort_order: 20 },
  { name: 'Large Lids (16 oz)',   category: 'Lids',              unit: 'sleeves',     par_level: 2, sort_order: 30 },
  { name: 'Italian Ice Spoons',   category: 'Spoons & Straws',   unit: 'boxes',       par_level: 2, sort_order: 10 },
  { name: 'Straws',               category: 'Spoons & Straws',   unit: 'boxes',       par_level: 1, sort_order: 20 },
  { name: '2 oz Condiment Cups',  category: 'Topping Containers',unit: 'bags',        par_level: 2, sort_order: 10 },
  { name: '4 oz Condiment Cups',  category: 'Topping Containers',unit: 'bags',        par_level: 2, sort_order: 20 },
  { name: 'Rainbow Sprinkles',    category: 'Toppings - Dry',    unit: 'containers',  par_level: 2, sort_order: 10 },
  { name: 'Chocolate Sprinkles',  category: 'Toppings - Dry',    unit: 'containers',  par_level: 2, sort_order: 20 },
  { name: 'Gummy Bears',          category: 'Toppings - Dry',    unit: 'bags',        par_level: 2, sort_order: 30 },
  { name: 'Mango Chili Powder',   category: 'Toppings - Dry',    unit: 'containers',  par_level: 1, sort_order: 40 },
  { name: 'Coconut Flakes',       category: 'Toppings - Dry',    unit: 'bags',        par_level: 1, sort_order: 50 },
  { name: 'Graham Cracker Crumbles', category: 'Toppings - Dry', unit: 'bags',        par_level: 1, sort_order: 60 },
]

export async function POST() {
  const db = getServerSupabase()

  // Check if items already exist
  const { count } = await db.from('items').select('*', { count: 'exact', head: true })
  if (count && count > 0) {
    return NextResponse.json({ ok: true, message: 'Already seeded', count })
  }

  const { error } = await db.from('items').insert(SEED_ITEMS)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, message: 'Seeded successfully' })
}
