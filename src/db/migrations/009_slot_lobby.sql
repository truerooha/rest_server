CREATE TABLE IF NOT EXISTS slot_lobby_reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  building_id INTEGER NOT NULL,
  restaurant_id INTEGER NOT NULL,
  delivery_slot TEXT NOT NULL,
  order_date TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(building_id, restaurant_id, delivery_slot, order_date, user_id)
);

CREATE INDEX IF NOT EXISTS idx_slot_lobby_slot ON slot_lobby_reservations(building_id, restaurant_id, delivery_slot, order_date);
CREATE INDEX IF NOT EXISTS idx_slot_lobby_user ON slot_lobby_reservations(user_id);
