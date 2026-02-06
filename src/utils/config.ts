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
})

const parsedEnv = envSchema.safeParse(process.env)

if (!parsedEnv.success) {
  logger.warn('Некорректные переменные окружения, применены значения по умолчанию', {
    error: parsedEnv.error,
  })
}

const env = parsedEnv.success ? parsedEnv.data : process.env

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
