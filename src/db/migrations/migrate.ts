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

/** Unambiguous charset for invite codes (no 0/O, 1/I/L confusion) */
const INVITE_CODE_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** Generate a random 6-char invite code */
export function generateInviteCode(): string {
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += INVITE_CODE_CHARSET[Math.floor(Math.random() * INVITE_CODE_CHARSET.length)]
  }
  return code
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
    if (!hasColumn(db, 'buildings', 'invite_code')) {
      logger.warn('Восстанавливаем колонку buildings.invite_code')
      db.exec('ALTER TABLE buildings ADD COLUMN invite_code TEXT')
      db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_buildings_invite_code ON buildings(invite_code)')
    }
    if (!hasColumn(db, 'buildings', 'invite_code_active')) {
      logger.warn('Восстанавливаем колонку buildings.invite_code_active')
      db.exec('ALTER TABLE buildings ADD COLUMN invite_code_active INTEGER DEFAULT 1')
    }
    if (!hasColumn(db, 'users', 'is_approved')) {
      logger.warn('Восстанавливаем колонку users.is_approved')
      db.exec('ALTER TABLE users ADD COLUMN is_approved INTEGER DEFAULT 0')
    }

    // Backfill invite codes for buildings that don't have one
    const buildingsWithoutCode = db
      .prepare('SELECT id FROM buildings WHERE invite_code IS NULL')
      .all() as Array<{ id: number }>
    if (buildingsWithoutCode.length > 0) {
      logger.info('Генерируем invite-коды для зданий', { count: buildingsWithoutCode.length })
      const stmt = db.prepare('UPDATE buildings SET invite_code = ? WHERE id = ?')
      for (const building of buildingsWithoutCode) {
        let code: string
        let attempts = 0
        do {
          code = generateInviteCode()
          attempts++
        } while (
          attempts < 100 &&
          db.prepare('SELECT 1 FROM buildings WHERE invite_code = ?').get(code)
        )
        stmt.run(code, building.id)
      }
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
