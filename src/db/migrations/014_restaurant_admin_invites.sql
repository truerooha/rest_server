CREATE TABLE IF NOT EXISTS restaurant_admin_invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL,
  code TEXT NOT NULL UNIQUE,
  created_by_telegram_id INTEGER NOT NULL,
  used_by_telegram_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  used_at TEXT,
  FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
);
