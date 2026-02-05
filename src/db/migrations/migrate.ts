import Database from 'better-sqlite3'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

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
  
  console.log(`📦 Применяем миграцию: ${migrationFile}`)
  
  db.transaction(() => {
    for (const statement of statements) {
      if (statement.trim()) {
        db.exec(statement)
      }
    }
    markMigrationApplied(db, migrationFile)
  })()
  
  console.log(`✅ Миграция ${migrationFile} применена успешно`)
}

/**
 * Основная функция для применения всех миграций
 * @param dbOrPath - объект Database или путь к файлу БД
 */
export function applyMigrations(dbOrPath: Database.Database | string): void {
  const shouldClose = typeof dbOrPath === 'string'
  const db = shouldClose ? new Database(dbOrPath as string) : (dbOrPath as Database.Database)
  
  console.log('🔄 Проверяем необходимость миграций...')
  
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
      console.log(`⚠️  Обнаружена неприменённая миграция: ${migrationFile}`)
      runMigration(db, migrationFile)
      appliedCount++
    }
  }
  
  if (appliedCount === 0) {
    console.log('✅ Все миграции уже применены')
  } else {
    console.log(`✅ Применено миграций: ${appliedCount}`)
  }
  
  if (shouldClose) {
    db.close()
  }
}

// Если запускается напрямую
if (require.main === module) {
  const dbPath = process.argv[2] || './database.db'
  applyMigrations(dbPath)
}
