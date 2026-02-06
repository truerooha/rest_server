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

  // Запускаем API сервер для Mini App сразу, чтобы Railway видел порт
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

  // Создаём сервис GPT-4 Vision (если есть ключ)
  const visionService = config.openaiApiKey
    ? new VisionService(config.openaiApiKey)
    : null

  // Создаём и запускаем админ-бота (если есть токен и Vision-сервис)
  if (config.botToken && visionService) {
    try {
      const adminBot = createAdminBot(config.botToken, db, visionService)
      adminBot.catch((err) => {
        console.error('❌ Ошибка в админ-боте:', err)
      })
      adminBot.start()
        .then(() => {
          console.log('✅ Админ-бот запущен')
        })
        .catch((err) => {
          console.error('❌ Ошибка старта админ-бота:', err)
        })
    } catch (error) {
      console.error('⚠️  Не удалось запустить админ-бота:', error)
      console.log('⚠️  Продолжаем работу без админ-бота')
    }
  } else {
    console.log('⚠️  BOT_TOKEN или OPENAI_API_KEY не указаны, админ-бот не запущен')
  }

  // Создаём и запускаем клиентского бота (если токен указан)
  if (config.clientBotToken) {
    try {
      const clientBot = createClientBot(config.clientBotToken, db, config.miniAppUrl)
      clientBot.catch((err) => {
        console.error('❌ Ошибка в клиентском боте:', err)
      })
      clientBot.start()
        .then(() => {
          console.log('✅ Клиентский бот запущен')
        })
        .catch((err) => {
          console.error('❌ Ошибка старта клиентского бота:', err)
        })
    } catch (error) {
      console.error('⚠️  Не удалось запустить клиентского бота:', error)
      console.log('⚠️  Продолжаем работу без клиентского бота')
    }
  } else {
    console.log('⚠️  CLIENT_BOT_TOKEN не указан, клиентский бот не запущен')
  }
  console.log('✅ Все сервисы инициализированы и готовы к работе!')
}

main().catch((error) => {
  console.error('💥 Критическая ошибка:', error)
  process.exit(1)
})
