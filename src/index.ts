import { config } from './utils/config'
import { initDatabase } from './db/schema'
import { applyMigrations } from './db/migrations/migrate'
import { VisionService } from './services/vision'
import { createBot as createAdminBot } from './bot/admin'
import { createClientBot } from './bot/client'
import { createApiServer } from './api/server'
import { logger } from './utils/logger'

async function main() {
  logger.info('Запуск сервера "Обед в Офис"', {
    nodeEnv: config.nodeEnv,
    apiPort: config.apiPort,
    databasePath: config.databasePath,
    miniAppUrl: config.miniAppUrl,
    hasBotToken: Boolean(config.botToken),
    hasClientBotToken: Boolean(config.clientBotToken),
    hasOpenaiApiKey: Boolean(config.openaiApiKey),
    logLevel: config.logLevel ?? logger.level,
    railwayEnvironment: process.env.RAILWAY_ENVIRONMENT,
    railwayService: process.env.RAILWAY_SERVICE_NAME,
    corsAllowedOrigins: config.corsAllowedOrigins,
    disableBots: config.disableBots,
    disableAdminBot: config.disableAdminBot,
    disableClientBot: config.disableClientBot,
    disableMigrations: config.disableMigrations,
  })

  // Инициализируем базу данных
  const db = initDatabase(config.databasePath)
  
  // Применяем миграции
  if (config.disableMigrations) {
    logger.warn('Миграции отключены флагом DISABLE_MIGRATIONS')
  } else {
    applyMigrations(config.databasePath)
  }

  // Запускаем API сервер для Mini App сразу, чтобы Railway видел порт
  const apiServer = createApiServer(db)
  const port = config.apiPort
  const host = '0.0.0.0'
  
  console.log(`Attempting to listen on ${host}:${port}`)
  
  const server = apiServer.listen(port, host, () => {
    console.log(`Server is definitely listening on ${host}:${port}`)
    logger.info('API сервер запущен', { port, host })
  })
  server.on('error', (error) => {
    console.error('SERVER FAILED TO START:', error)
    logger.error('Ошибка запуска HTTP сервера', { error })
    process.exit(1)
  })

  // Graceful shutdown
  let shuttingDown = false
  const shutdown = (signal: string) => {
    if (shuttingDown) {
      return
    }
    shuttingDown = true
    logger.warn('Получен сигнал завершения', { signal })
    server.close(() => {
      db.close()
      logger.info('Сервер остановлен')
      process.exit(0)
    })
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  // Создаём сервис GPT-4 Vision (если есть ключ)
  const visionService = config.openaiApiKey
    ? new VisionService(config.openaiApiKey)
    : null
  if (!visionService) {
    logger.warn('Vision-сервис не создан: OPENAI_API_KEY отсутствует')
  }

  // Создаём и запускаем админ-бота (если есть токен и Vision-сервис)
  if (config.disableBots || config.disableAdminBot) {
    logger.warn('Админ-бот отключён флагами конфигурации')
  } else if (config.botToken && visionService) {
    try {
      logger.info('Запуск админ-бота...')
      const adminBot = createAdminBot(config.botToken, db, visionService)
      adminBot.catch((err) => {
        logger.error('Ошибка в админ-боте', { error: err })
      })
      adminBot.start()
        .then(() => {
          logger.info('Админ-бот запущен')
        })
        .catch((err) => {
          logger.error('Ошибка старта админ-бота', { error: err })
        })
    } catch (error) {
      logger.error('Не удалось запустить админ-бота', { error })
      logger.warn('Продолжаем работу без админ-бота')
    }
  } else {
    logger.warn('BOT_TOKEN или OPENAI_API_KEY не указаны, админ-бот не запущен')
  }

  // Создаём и запускаем клиентского бота (если токен указан)
  if (config.disableBots || config.disableClientBot) {
    logger.warn('Клиентский бот отключён флагами конфигурации')
  } else if (config.clientBotToken) {
    try {
      logger.info('Запуск клиентского бота...')
      const clientBot = createClientBot(config.clientBotToken, db, config.miniAppUrl)
      clientBot.catch((err) => {
        logger.error('Ошибка в клиентском боте', { error: err })
      })
      clientBot.start()
        .then(() => {
          logger.info('Клиентский бот запущен')
        })
        .catch((err) => {
          logger.error('Ошибка старта клиентского бота', { error: err })
        })
    } catch (error) {
      logger.error('Не удалось запустить клиентского бота', { error })
      logger.warn('Продолжаем работу без клиентского бота')
    }
  } else {
    logger.warn('CLIENT_BOT_TOKEN не указан, клиентский бот не запущен')
  }
  logger.info('Все сервисы инициализированы и готовы к работе')
}

main().catch((error) => {
  logger.error('Критическая ошибка', { error })
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  logger.error('UnhandledPromiseRejection', { error: reason })
})

process.on('uncaughtException', (error) => {
  logger.error('UncaughtException', { error })
  process.exit(1)
})
