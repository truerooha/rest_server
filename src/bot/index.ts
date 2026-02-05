import { Bot, Context } from 'grammy'
import { RestaurantRepository, MenuRepository } from '../db/repository'
import { DeepSeekService } from '../services/deepseek'
import Database from 'better-sqlite3'

export function createBot(
  token: string,
  db: Database.Database,
  deepseekService: DeepSeekService
) {
  const bot = new Bot(token)
  const restaurantRepo = new RestaurantRepository(db)
  const menuRepo = new MenuRepository(db)

  // Команда /start
  bot.command('start', async (ctx: Context) => {
    await ctx.reply(
      `👋 Привет! Я помогу тебе создать цифровое меню для твоего ресторана.

📸 Просто отправь мне фото своего меню, и я распознаю все блюда и цены автоматически!

После распознавания ты сможешь просмотреть результат.`
    )
  })

  // Обработка фото
  bot.on('message:photo', async (ctx: Context) => {
    try {
      const chatId = ctx.chat?.id
      if (!chatId) {
        await ctx.reply('❌ Не удалось определить chat ID')
        return
      }

      await ctx.reply('⏳ Распознаю меню... Это займёт 10-20 секунд.')

      // Получаем файл с наибольшим разрешением
      const photos = ctx.message?.photo
      if (!photos || photos.length === 0) {
        await ctx.reply('❌ Фото не найдено')
        return
      }

      const photo = photos[photos.length - 1]
      const file = await ctx.api.getFile(photo.file_id)
      const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`

      // Распознаём меню через DeepSeek
      const result = await deepseekService.recognizeMenuFromImage(fileUrl)

      if (result.items.length === 0) {
        await ctx.reply(
          '😕 Не удалось распознать ни одного блюда. Убедитесь что на фото чётко видны названия и цены.'
        )
        return
      }

      // Сохраняем или находим ресторан
      const restaurant = restaurantRepo.findOrCreateByChatId(
        chatId,
        ctx.chat.title || 'Мой ресторан'
      )

      // Удаляем старое меню (если есть) и сохраняем новое
      menuRepo.deleteAllByRestaurantId(restaurant.id)

      for (const item of result.items) {
        menuRepo.createItem({
          restaurant_id: restaurant.id,
          name: item.name,
          price: item.price,
          description: item.description,
          is_available: true,
        })
      }

      // Формируем сообщение с результатом
      let message = `✅ Распознано блюд: ${result.items.length}\n\n📋 Ваше меню:\n\n`
      
      for (const item of result.items) {
        message += `• ${item.name} — ${item.price}₽\n`
        if (item.description) {
          message += `  ${item.description}\n`
        }
        message += '\n'
      }

      message += '\nМеню сохранено в базу данных! 🎉'

      await ctx.reply(message)
    } catch (error) {
      console.error('Ошибка обработки фото:', error)
      await ctx.reply(
        `❌ Ошибка: ${error instanceof Error ? error.message : 'Неизвестная ошибка'}`
      )
    }
  })

  // Команда /menu - показать текущее меню
  bot.command('menu', async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) {
      await ctx.reply('❌ Не удалось определить chat ID')
      return
    }

    const restaurant = restaurantRepo.findByChatId(chatId)
    if (!restaurant) {
      await ctx.reply('У вас ещё нет меню. Отправьте фото меню для распознавания!')
      return
    }

    const items = menuRepo.findByRestaurantId(restaurant.id)
    if (items.length === 0) {
      await ctx.reply('Меню пусто. Отправьте фото меню!')
      return
    }

    let message = '📋 Ваше текущее меню:\n\n'
    for (const item of items) {
      message += `• ${item.name} — ${item.price}₽\n`
      if (item.description) {
        message += `  ${item.description}\n`
      }
      message += '\n'
    }

    await ctx.reply(message)
  })

  return bot
}
