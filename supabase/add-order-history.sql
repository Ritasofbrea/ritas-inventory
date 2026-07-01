-- Rita's Inventory – Add order history tables
-- Run this in the Supabase SQL Editor

CREATE TABLE IF NOT EXISTS order_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('ordered', 'received', 'will_call', 'short')),
  notes TEXT NOT NULL DEFAULT '',
  resolved BOOLEAN NOT NULL DEFAULT true,
  related_order_id UUID REFERENCES order_history(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_history_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES order_history(id) ON DELETE CASCADE,
  item_id UUID REFERENCES items(id) ON DELETE SET NULL,
  item_name TEXT NOT NULL,
  quantity DECIMAL(10,2) NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for fast unresolved-shorts lookup on dashboard
CREATE INDEX IF NOT EXISTS idx_order_history_type_resolved
  ON order_history(type, resolved);
