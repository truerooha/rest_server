import { config } from './utils/config'
import { initDatabase } from './db/schema'
import { applyMigrations } from './db/migrations/migrate'
import { VisionService } from './services/vision'
import { createBot as createAdminBot } from './bot/admin'
import { createClientBot } from './bot/client'
import { createApiServer } from './api/server'

async function main() {
  console.log('🚀 Запуск "Обед в Офис"...')

  // Инициализируем базу данных
  const db = initDatabase(config.databasePath)
  
  // Применяем миграции
  applyMigrations(config.databasePath)

  // Создаём сервис GPT-4 Vision
  const visionService = new VisionService(config.openaiApiKey!)

  // Создаём и запускаем админ-бота
  const adminBot = createAdminBot(config.botToken!, db, visionService)
  adminBot.catch((err) => {
    console.error('❌ Ошибка в админ-боте:', err)
  })
  await adminBot.start()
  console.log('✅ Админ-бот запущен')

  // Создаём и запускаем клиентского бота (если токен указан)
  if (config.clientBotToken) {
    const clientBot = createClientBot(config.clientBotToken, db, config.miniAppUrl)
    clientBot.catch((err) => {
      console.error('❌ Ошибка в клиентском боте:', err)
    })
    await clientBot.start()
    console.log('✅ Клиентский бот запущен')
  } else {
    console.log('⚠️  CLIENT_BOT_TOKEN не указан, клиентский бот не запущен')
  }

  // Запускаем API сервер для Mini App
  const apiServer = createApiServer(db)
  const server = apiServer.listen(config.apiPort, () => {
    console.log(`✅ API сервер запущен на порту ${config.apiPort}`)
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

  console.log('✅ Все сервисы запущены и готовы к работе!')
}

main().catch((error) => {
  console.error('💥 Критическая ошибка:', error)
  process.exit(1)
})
