CREATE TABLE IF NOT EXISTS group_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL,
  building_id INTEGER NOT NULL,
  delivery_slot TEXT NOT NULL,
  order_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_restaurant' CHECK(status IN ('pending_restaurant', 'accepted', 'rejected')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE,
  FOREIGN KEY (building_id) REFERENCES buildings(id) ON DELETE CASCADE,
  UNIQUE(restaurant_id, building_id, delivery_slot, order_date)
);

CREATE INDEX IF NOT EXISTS idx_group_orders_restaurant ON group_orders(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_group_orders_status ON group_orders(status);
