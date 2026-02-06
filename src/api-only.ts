import { config } from './utils/config'
import { initDatabase } from './db/schema'
import { applyMigrations } from './db/migrations/migrate'
import { createApiServer } from './api/server'
import { logger } from './utils/logger'

async function main() {
  logger.info('Запуск API сервера (без ботов)...', {
    nodeEnv: config.nodeEnv,
    apiPort: config.apiPort,
    databasePath: config.databasePath,
    logLevel: config.logLevel ?? logger.level,
    railwayEnvironment: process.env.RAILWAY_ENVIRONMENT,
    railwayService: process.env.RAILWAY_SERVICE_NAME,
  })

  // Инициализируем базу данных
  const db = initDatabase(config.databasePath)
  
  // Применяем миграции
  applyMigrations(config.databasePath)

  // Запускаем API сервер для Mini App
  const apiServer = createApiServer(db)
  const server = apiServer.listen(config.apiPort, '0.0.0.0', () => {
    logger.info('API сервер запущен', { port: config.apiPort, host: '0.0.0.0' })
    logger.info('API сервер доступен локально', { url: `http://localhost:${config.apiPort}` })
  })
  server.on('error', (error) => {
    logger.error('Ошибка запуска HTTP сервера', { error })
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

  logger.info('API сервер готов к работе')
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
