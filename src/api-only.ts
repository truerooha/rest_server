import { config } from './utils/config'
import { initDatabase } from './db/schema'
import { applyMigrations } from './db/migrations/migrate'
import { createApiServer } from './api/server'

async function main() {
  console.log('🚀 Запуск API сервера (без ботов)...')

  // Инициализируем базу данных
  const db = initDatabase(config.databasePath)
  
  // Применяем миграции
  applyMigrations(config.databasePath)

  // Запускаем API сервер для Mini App
  const apiServer = createApiServer(db)
  const server = apiServer.listen(config.apiPort, '0.0.0.0', () => {
    console.log(`✅ API сервер запущен на порту ${config.apiPort}`)
    console.log(`📡 Доступен по адресу: http://localhost:${config.apiPort}`)
  })

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n⏹️  Остановка сервера...')
    server.close(() => {
      db.close()
      console.log('✅ Сервер остановлен')
      process.exit(0)
    })
  })

  console.log('✅ API сервер готов к работе!')
}

main().catch((error) => {
  console.error('💥 Критическая ошибка:', error)
  process.exit(1)
})
