import { config } from './utils/config'
import { initDatabase } from './db/schema'
import { applyMigrations } from './db/migrations/migrate'
import { VisionService } from './services/vision'
import { createBot as createAdminBot, formatGroupOrderMessage } from './bot/admin'
import { createClientBot } from './bot/client'
import { createApiServer } from './api/server'
import { startDeadlineScheduler } from './services/deadline-scheduler'
import { UserRepository } from './db/repository'
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
  
  const server = apiServer.listen(port, host, () => {
    logger.info('API сервер запущен', { port, host })
  })
  server.on('error', (error) => {
    logger.error('Ошибка запуска HTTP сервера', { error })
    process.exit(1)
  })

  let stopDeadlineScheduler: (() => void) | null = null

  // Graceful shutdown
  let shuttingDown = false
  const shutdown = (signal: string) => {
    if (shuttingDown) {
      return
    }
    shuttingDown = true
    logger.warn('Получен сигнал завершения', { signal })
    stopDeadlineScheduler?.()
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

  // Создаём клиентского бота первым (нужен для уведомлений из админ-бота)
  let clientBot: ReturnType<typeof createClientBot> | null = null
  if (!config.disableBots && !config.disableClientBot && config.clientBotToken) {
    clientBot = createClientBot(config.clientBotToken, db, config.miniAppUrl)
  }

  // Создаём и запускаем админ-бота (если есть токен и Vision-сервис)
  if (config.disableBots || config.disableAdminBot) {
    logger.warn('Админ-бот отключён флагами конфигурации')
  } else if (config.botToken && visionService) {
    try {
      logger.info('Запуск админ-бота...')
      const notifyUser =
        clientBot &&
        (async (telegramUserId: number, text: string) => {
          await clientBot!.api.sendMessage(telegramUserId, text)
        })
      const adminBot = createAdminBot(config.botToken, db, visionService, {
        notifyUser: notifyUser ?? undefined,
      })
      const userRepo = new UserRepository(db)
      stopDeadlineScheduler = startDeadlineScheduler(db, async (params) => {
        const ordersWithNames = params.orders.map((o) => ({
          ...o,
          userName: userRepo.findById(o.userId)?.first_name ?? userRepo.findById(o.userId)?.username,
        }))
        const { text, keyboard } = formatGroupOrderMessage({
          ...params,
          orders: ordersWithNames,
        })
        await adminBot.api.sendMessage(params.restaurantChatId, text, {
          reply_markup: keyboard,
        })
      })
      adminBot.catch((err) => {
        logger.error('Ошибка в админ-боте', { error: err })
      })
      // Кнопка меню (рядом с полем ввода) — всегда видна, открывает список команд
      await adminBot.api.setChatMenuButton({ menu_button: { type: 'commands' } })
      await adminBot.api.setMyCommands([
        { command: 'start', description: 'Начать / приветствие' },
        { command: 'help', description: 'Справка по командам' },
        { command: 'orders', description: 'Список заказов' },
        { command: 'menu', description: 'Меню по категориям' },
        { command: 'add', description: 'Добавить блюдо' },
        { command: 'edit', description: 'Редактировать блюдо' },
        { command: 'delete', description: 'Удалить блюдо' },
      ])
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

  // Запускаем клиентского бота (если создан)
  if (clientBot) {
    try {
      logger.info('Запуск клиентского бота...')
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
  } else if (!config.disableBots && !config.disableClientBot) {
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
