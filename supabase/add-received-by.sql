-- Add received_by field to order_history for tracking who received each delivery
ALTER TABLE order_history ADD COLUMN IF NOT EXISTS received_by TEXT;
