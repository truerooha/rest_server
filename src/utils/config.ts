import dotenv from 'dotenv'

// Загружаем переменные окружения из .env
dotenv.config()

export const config = {
  botToken: process.env.BOT_TOKEN,
  clientBotToken: process.env.CLIENT_BOT_TOKEN,
  openaiApiKey: process.env.OPENAI_API_KEY,
  databasePath: process.env.DATABASE_PATH || './database.db',
  nodeEnv: process.env.NODE_ENV || 'development',
  apiPort: parseInt(process.env.API_PORT || '3002'),
  miniAppUrl: process.env.MINI_APP_URL || 'https://localhost:3001',
}

// Внимание:
// - Для API сервера на Railway BOT_TOKEN и OPENAI_API_KEY не обязательны.
// - Если их нет — боты и Vision-сервис просто не будут запущены.
if (!config.botToken) {
  console.warn('⚠️ BOT_TOKEN не найден: админ-бот не будет запущен')
}

if (!config.openaiApiKey) {
  console.warn('⚠️ OPENAI_API_KEY не найден: Vision-сервис не будет доступен')
}
