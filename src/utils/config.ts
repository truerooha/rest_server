import dotenv from 'dotenv'
import { z } from 'zod'
import { logger } from './logger'

// Загружаем переменные окружения из .env
dotenv.config()

const envSchema = z.object({
  BOT_TOKEN: z.string().optional(),
  CLIENT_BOT_TOKEN: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  DATABASE_PATH: z.string().optional(),
  NODE_ENV: z.string().optional(),
  PORT: z.string().optional(),
  API_PORT: z.string().optional(),
  MINI_APP_URL: z.string().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).optional(),
  CORS_ALLOWED_ORIGINS: z.string().optional(),
  DISABLE_BOTS: z.string().optional(),
  DISABLE_ADMIN_BOT: z.string().optional(),
  DISABLE_CLIENT_BOT: z.string().optional(),
  DISABLE_MIGRATIONS: z.string().optional(),
  MIN_LOBBY_PARTICIPANTS: z.string().optional(),
  UPLOADS_PATH: z.string().optional(),
  PLATFORM_BOT_TOKEN: z.string().optional(),
  PLATFORM_ADMIN_IDS: z.string().optional(),
  DISABLE_PLATFORM_BOT: z.string().optional(),
  /** Username клиентского бота (без @) для генерации ссылок с invite-кодом в Platform Bot */
  CLIENT_BOT_USERNAME: z.string().optional(),
  /** Short name Web App из BotFather для ссылки t.me/bot/app?startapp=CODE */
  WEB_APP_SHORT_NAME: z.string().optional(),
})

const parsedEnv = envSchema.safeParse(process.env)

if (!parsedEnv.success) {
  logger.warn('Некорректные переменные окружения, применены значения по умолчанию', {
    error: parsedEnv.error,
  })
}

const env = parsedEnv.success ? parsedEnv.data : process.env

const parseBooleanFlag = (value?: string): boolean => {
  if (!value) {
    return false
  }

  const normalized = value.trim().toLowerCase()
  return ['1', 'true', 'yes', 'on'].includes(normalized)
}

export const config = {
  botToken: env.BOT_TOKEN,
  clientBotToken: env.CLIENT_BOT_TOKEN,
  openaiApiKey: env.OPENAI_API_KEY,
  databasePath: env.DATABASE_PATH || './database.db',
  nodeEnv: env.NODE_ENV || 'development',
  // На проде (Railway) Railway выставляет PORT, его и используем в приоритете.
  apiPort: parseInt(env.PORT || env.API_PORT || '3002'),
  miniAppUrl: env.MINI_APP_URL || 'https://localhost:3001',
  logLevel: env.LOG_LEVEL,
  corsAllowedOrigins: env.CORS_ALLOWED_ORIGINS
    ? env.CORS_ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
    : [],
  disableBots: parseBooleanFlag(env.DISABLE_BOTS),
  disableAdminBot: parseBooleanFlag(env.DISABLE_ADMIN_BOT),
  disableClientBot: parseBooleanFlag(env.DISABLE_CLIENT_BOT),
  disableMigrations: parseBooleanFlag(env.DISABLE_MIGRATIONS),
  /** Минимум участников для активации слота и бесплатной доставки. По умолчанию 1 для тестирования. */
  minLobbyParticipants: Math.max(
    1,
    parseInt(env.MIN_LOBBY_PARTICIPANTS || '1', 10) || 1,
  ),
  /** Путь к директории загруженных изображений. Railway: /data/uploads, локально: ./uploads */
  uploadsPath: env.UPLOADS_PATH || './uploads',
  platformBotToken: env.PLATFORM_BOT_TOKEN,
  platformAdminIds: env.PLATFORM_ADMIN_IDS
    ? env.PLATFORM_ADMIN_IDS.split(',').map((id) => parseInt(id.trim(), 10)).filter(Number.isFinite)
    : [],
  disablePlatformBot: parseBooleanFlag(env.DISABLE_PLATFORM_BOT),
  clientBotUsername: env.CLIENT_BOT_USERNAME?.trim() || null,
  webAppShortName: env.WEB_APP_SHORT_NAME?.trim() || null,
}

// Внимание:
// - Для API сервера на Railway BOT_TOKEN и OPENAI_API_KEY не обязательны.
// - Если их нет — боты и Vision-сервис просто не будут запущены.
if (!config.botToken) {
  logger.warn('BOT_TOKEN не найден: админ-бот не будет запущен')
}

if (!config.openaiApiKey) {
  logger.warn('OPENAI_API_KEY не найден: Vision-сервис не будет доступен')
}
