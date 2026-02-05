import dotenv from 'dotenv'

// Загружаем переменные окружения из .env
dotenv.config()

export const config = {
  botToken: process.env.BOT_TOKEN,
  clientBotToken: process.env.CLIENT_BOT_TOKEN,
  openaiApiKey: process.env.OPENAI_API_KEY,
  databasePath: process.env.DATABASE_PATH || './database.db',
  nodeEnv: process.env.NODE_ENV || 'development',
  apiPort: parseInt(process.env.API_PORT || '3000'),
  miniAppUrl: process.env.MINI_APP_URL || 'https://localhost:3001',
}

// Проверяем обязательные переменные
if (!config.botToken) {
  throw new Error('BOT_TOKEN не найден в .env файле')
}

if (!config.openaiApiKey) {
  throw new Error('OPENAI_API_KEY не найден в .env файле')
}
