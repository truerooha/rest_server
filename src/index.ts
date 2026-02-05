import { config } from './utils/config'
import { initDatabase } from './db/schema'
import { VisionService } from './services/vision'
import { createBot } from './bot'

async function main() {
  console.log('🚀 Запуск бота "Обед в Офис"...')

  // Инициализируем базу данных
  const db = initDatabase(config.databasePath)

  // Создаём сервис GPT-4 Vision
  const visionService = new VisionService(config.openaiApiKey!)

  // Создаём и запускаем бота
  const bot = createBot(config.botToken!, db, visionService)

  // Обработка ошибок
  bot.catch((err) => {
    console.error('❌ Ошибка в боте:', err)
  })

  // Запускаем бота
  await bot.start()

  console.log('✅ Бот запущен и готов к работе!')
}

main().catch((error) => {
  console.error('💥 Критическая ошибка:', error)
  process.exit(1)
})
