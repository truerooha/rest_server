import Database from 'better-sqlite3'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Применяет миграцию к базе данных
 */
export function runMigration(db: Database.Database, migrationFile: string): void {
  const migrationPath = join(__dirname, migrationFile)
  const migrationSQL = readFileSync(migrationPath, 'utf-8')
  
  // Разбиваем на отдельные SQL команды и выполняем их
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
  })()
  
  console.log(`✅ Миграция ${migrationFile} применена успешно`)
}

/**
 * Проверяет, применена ли миграция
 */
export function checkMigrationApplied(db: Database.Database): boolean {
  try {
    const result = db.prepare(`
      SELECT COUNT(*) as count 
      FROM pragma_table_info('menu_items') 
      WHERE name = 'is_breakfast'
    `).get() as { count: number }
    
    return result.count > 0
  } catch (error) {
    return false
  }
}

/**
 * Основная функция для применения всех миграций
 */
export function applyMigrations(dbPath: string): void {
  const db = new Database(dbPath)
  
  console.log('🔄 Проверяем необходимость миграций...')
  
  if (!checkMigrationApplied(db)) {
    console.log('⚠️  Обнаружена неприменённая миграция')
    runMigration(db, '001_add_breakfast_and_categories.sql')
  } else {
    console.log('✅ Все миграции уже применены')
  }
  
  db.close()
}

// Если запускается напрямую
if (require.main === module) {
  const dbPath = process.argv[2] || './database.db'
  applyMigrations(dbPath)
}
