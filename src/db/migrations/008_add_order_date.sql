ALTER TABLE orders ADD COLUMN order_date TEXT;
UPDATE orders SET order_date = date(created_at) WHERE order_date IS NULL;
