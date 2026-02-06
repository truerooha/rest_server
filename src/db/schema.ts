import Database from 'better-sqlite3'
import { logger } from '../utils/logger'

export function initDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath)
  
  // Включаем WAL режим для лучшей производительности и конкурентности
  db.pragma('journal_mode = WAL')
  
  // Создаём таблицу ресторанов
  db.exec(`
    CREATE TABLE IF NOT EXISTS restaurants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      chat_id INTEGER UNIQUE NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `)
  
  // Создаём таблицу блюд меню
  db.exec(`
    CREATE TABLE IF NOT EXISTS menu_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      restaurant_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      description TEXT,
      category TEXT,
      is_breakfast INTEGER DEFAULT 0,
      is_available INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
    )
  `)
  
  logger.info('База данных инициализирована')
  
  return db
}
