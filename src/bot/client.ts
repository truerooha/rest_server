import { Bot, Context, InlineKeyboard } from 'grammy'
import Database from 'better-sqlite3'
import { UserRepository } from '../db/repository'

/**
 * Создаёт клиентского бота для заказа обедов
 * Минималистичный - только запуск Mini App
 */
export function createClientBot(token: string, db: Database.Database, miniAppUrl: string): Bot {
  const bot = new Bot(token)
  const userRepo = new UserRepository(db)

  // Команда /start
  bot.command('start', async (ctx: Context) => {
    const telegramUser = ctx.from

    if (!telegramUser) {
      await ctx.reply('❌ Не удалось определить пользователя')
      return
    }

    // Создаём или находим пользователя в БД
    userRepo.findOrCreate({
      telegram_user_id: telegramUser.id,
      username: telegramUser.username,
      first_name: telegramUser.first_name,
      last_name: telegramUser.last_name,
    })

    // Создаём клавиатуру с кнопкой для запуска Mini App
    const keyboard = new InlineKeyboard().webApp('🍽️ Открыть меню', miniAppUrl)

    await ctx.reply(
      `👋 Привет, ${telegramUser.first_name}!

Добро пожаловать в "Обед в Офис" - сервис предзаказа корпоративных обедов.

Нажмите кнопку ниже, чтобы открыть меню и сделать заказ:`,
      { reply_markup: keyboard }
    )
  })

  // Команда /help
  bot.command('help', async (ctx: Context) => {
    await ctx.reply(
      `ℹ️ **Как пользоваться ботом**

1. Нажмите "🍽️ Открыть меню"
2. Выберите ваше здание/офис
3. Выберите ресторан
4. Добавьте блюда в корзину
5. Оформите заказ

**Доступные команды:**
/start - начать работу
/help - показать эту справку
/menu - открыть меню`,
      { parse_mode: 'Markdown' }
    )
  })

  // Команда /menu - альтернативный способ открыть меню
  bot.command('menu', async (ctx: Context) => {
    const keyboard = new InlineKeyboard().webApp('🍽️ Открыть меню', miniAppUrl)

    await ctx.reply('Нажмите кнопку, чтобы открыть меню:', {
      reply_markup: keyboard,
    })
  })

  // Обработка любых других сообщений
  bot.on('message', async (ctx: Context) => {
    const keyboard = new InlineKeyboard().webApp('🍽️ Открыть меню', miniAppUrl)

    await ctx.reply(
      'Используйте кнопку ниже, чтобы открыть меню и сделать заказ:',
      { reply_markup: keyboard }
    )
  })

  return bot
}
