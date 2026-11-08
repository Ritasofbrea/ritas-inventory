-- Supports the planned redesign of the velocity/par-suggestions/
-- last-per-item queries: per-item targeted lookups ("latest count on/
-- before X", "first/last count in a window") instead of today's single
-- unbounded-or-fixed-limit fetch across every item at once. An index never
-- changes what a query returns, only how fast it runs -- safe to run any
-- time, independently of that code change, and before or after it.
--
-- inventory_counts has no index today beyond its primary key, so every
-- per-item "WHERE item_id = X ORDER BY created_at DESC LIMIT 1" style
-- lookup would otherwise be a sequential scan over the whole table.
CREATE INDEX IF NOT EXISTS idx_inventory_counts_item_created
  ON inventory_counts(item_id, created_at DESC);

-- order_history_items has no index on item_id (a foreign key column does
-- NOT get an automatic index in Postgres -- only the referenced side,
-- items.id, does), and order_history has no index on created_at beyond
-- the existing (type, resolved) one. Both are needed for the delivery
-- side of the same lookup (src/lib/usage-server.ts's
-- fetchStoreFlowHistory) once it's changed to filter per item instead of
-- pulling every receipt/will_call order.
CREATE INDEX IF NOT EXISTS idx_order_history_items_item_id
  ON order_history_items(item_id);
CREATE INDEX IF NOT EXISTS idx_order_history_created_at
  ON order_history(created_at);
