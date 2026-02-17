CREATE TABLE IF NOT EXISTS restaurant_admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL,
  telegram_user_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  added_by_telegram_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE,
  UNIQUE(restaurant_id, telegram_user_id)
);

CREATE INDEX IF NOT EXISTS idx_restaurant_admins_telegram_id ON restaurant_admins(telegram_user_id);
CREATE INDEX IF NOT EXISTS idx_restaurant_admins_restaurant_id ON restaurant_admins(restaurant_id);

INSERT OR IGNORE INTO restaurant_admins (restaurant_id, telegram_user_id, role)
SELECT id, chat_id, 'owner' FROM restaurants
