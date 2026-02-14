import Database from 'better-sqlite3'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { logger } from '../../utils/logger'

/**
 * Создаёт таблицу для отслеживания миграций
 */
function initMigrationsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      applied_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `)
}

/**
 * Проверяет, применена ли миграция
 */
function isMigrationApplied(db: Database.Database, migrationName: string): boolean {
  const result = db.prepare('SELECT COUNT(*) as count FROM migrations WHERE name = ?')
    .get(migrationName) as { count: number }
  return result.count > 0
}

/**
 * Отмечает миграцию как применённую
 */
function markMigrationApplied(db: Database.Database, migrationName: string): void {
  db.prepare('INSERT INTO migrations (name) VALUES (?)').run(migrationName)
}

/**
 * Применяет миграцию к базе данных
 */
export function runMigration(db: Database.Database, migrationFile: string): void {
  const migrationPath = join(__dirname, migrationFile)
  const migrationSQL = readFileSync(migrationPath, 'utf-8')
  
  // Разбиваем на отдельные SQL команды
  const statements = migrationSQL
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'))
  
  logger.info('Применяем миграцию', { migrationFile })
  
  db.transaction(() => {
    for (const statement of statements) {
      if (statement.trim()) {
        db.exec(statement)
      }
    }
    markMigrationApplied(db, migrationFile)
  })()
  
  logger.info('Миграция применена успешно', { migrationFile })
}

/**
 * Основная функция для применения всех миграций
 * @param dbOrPath - объект Database или путь к файлу БД
 */
export function applyMigrations(dbOrPath: Database.Database | string): void {
  const shouldClose = typeof dbOrPath === 'string'
  const db = shouldClose ? new Database(dbOrPath as string) : (dbOrPath as Database.Database)
  
  logger.info('Проверяем необходимость миграций...')
  
  // Инициализируем таблицу миграций
  initMigrationsTable(db)
  
  // Получаем список всех файлов миграций
  const migrationsDir = __dirname
  const migrationFiles = readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort() // Сортируем по имени (001_, 002_, и т.д.)
  
  let appliedCount = 0
  
  for (const migrationFile of migrationFiles) {
    if (!isMigrationApplied(db, migrationFile)) {
      logger.warn('Обнаружена неприменённая миграция', { migrationFile })
      runMigration(db, migrationFile)
      appliedCount++
    }
  }
  
  if (appliedCount === 0) {
    logger.info('Все миграции уже применены')
  } else {
    logger.info('Применено миграций', { appliedCount })
  }
 
  if (shouldClose) {
    db.close()
  }
}

/**
 * Проверяет наличие колонки в таблице
 */
function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return rows.some((r) => r.name === column)
}

/**
 * Восстанавливает отсутствующие колонки (если миграция была помечена как применённая,
 * но ALTER TABLE не выполнился — например, на Railway).
 */
export function ensureSchemaColumns(dbOrPath: Database.Database | string): void {
  const shouldClose = typeof dbOrPath === 'string'
  const db = shouldClose ? new Database(dbOrPath as string) : (dbOrPath as Database.Database)

  try {
    if (!hasColumn(db, 'menu_items', 'image_url')) {
      logger.warn('Восстанавливаем колонку menu_items.image_url')
      db.exec('ALTER TABLE menu_items ADD COLUMN image_url TEXT')
    }
    if (!hasColumn(db, 'restaurants', 'min_order_amount')) {
      logger.warn('Восстанавливаем колонку restaurants.min_order_amount')
      db.exec('ALTER TABLE restaurants ADD COLUMN min_order_amount REAL DEFAULT 0')
    }
    if (!hasColumn(db, 'restaurants', 'sbp_link')) {
      logger.warn('Восстанавливаем колонку restaurants.sbp_link')
      db.exec('ALTER TABLE restaurants ADD COLUMN sbp_link TEXT')
    }
  } finally {
    if (shouldClose) {
      db.close()
    }
  }
}

// Если запускается напрямую
if (require.main === module) {
  const dbPath = process.argv[2] || './database.db'
  applyMigrations(dbPath)
}
