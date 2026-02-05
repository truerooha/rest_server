import { config } from './utils/config'
import { initDatabase } from './db/schema'
import { DeepSeekService } from './services/deepseek'
import { createBot } from './bot'

async function main() {
  console.log('🚀 Запуск бота "Обед в Офис"...')

  // Инициализируем базу данных
  const db = initDatabase(config.databasePath)

  // Создаём сервис DeepSeek
  const deepseekService = new DeepSeekService(config.deepseekApiKey!)

  // Создаём и запускаем бота
  const bot = createBot(config.botToken!, db, deepseekService)

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
