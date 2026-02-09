-- Черновик заказа (корзина + слот) до оплаты, по одному на пользователя по telegram_user_id
CREATE TABLE IF NOT EXISTS user_drafts (
  telegram_user_id INTEGER PRIMARY KEY,
  delivery_slot TEXT,
  restaurant_id INTEGER,
  building_id INTEGER,
  items TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE SET NULL,
  FOREIGN KEY (building_id) REFERENCES buildings(id) ON DELETE SET NULL
);
