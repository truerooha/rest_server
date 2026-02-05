import { Bot, Context } from 'grammy'
import { RestaurantRepository, MenuRepository } from '../db/repository'
import { VisionService } from '../services/vision'
import Database from 'better-sqlite3'

export function createBot(
  token: string,
  db: Database.Database,
  visionService: VisionService
) {
  const bot = new Bot(token)
  const restaurantRepo = new RestaurantRepository(db)
  const menuRepo = new MenuRepository(db)

  // Команда /start
  bot.command('start', async (ctx: Context) => {
    await ctx.reply(
      `👋 Привет! Я помогу тебе создать цифровое меню для твоего ресторана.

📸 Просто отправь мне фото своего меню, и я распознаю все блюда, цены и категории автоматически!

**Возможности:**
• Автоматическое распознавание категорий
• Определение завтраков
• Группировка по категориям
• Умное определение категорий через AI

**Команды:**
/menu - показать меню по категориям
/categories - статистика по категориям
/breakfasts - показать только завтраки`,
      { parse_mode: 'Markdown' }
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

      await ctx.reply('⏳ Распознаю меню через GPT-4 Vision... Это займёт 10-20 секунд.')

      // Получаем файл с наибольшим разрешением
      const photos = ctx.message?.photo
      if (!photos || photos.length === 0) {
        await ctx.reply('❌ Фото не найдено')
        return
      }

      const photo = photos[photos.length - 1]
      const file = await ctx.api.getFile(photo.file_id)
      const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`

      // Распознаём меню через GPT-4 Vision
      const result = await visionService.recognizeMenuFromImage(fileUrl)

      if (result.items.length === 0) {
        await ctx.reply(
          '😕 Не удалось распознать ни одного блюда. Убедитесь что на фото чётко видны названия и цены.'
        )
        return
      }

      // Обогащаем данные категориями и признаком завтрака
      const enrichedItems = visionService.enrichMenuItems(result.items)

      // Сохраняем или находим ресторан
      const restaurant = restaurantRepo.findOrCreateByChatId(
        chatId,
        ctx.chat.title || 'Мой ресторан'
      )

      // Удаляем старое меню (если есть) и сохраняем новое
      menuRepo.deleteAllByRestaurantId(restaurant.id)

      for (const item of enrichedItems) {
        menuRepo.createItem({
          restaurant_id: restaurant.id,
          name: item.name,
          price: item.price,
          description: item.description,
          category: item.category,
          is_breakfast: item.is_breakfast,
          is_available: true,
        })
      }

      // Группируем блюда по категориям для красивого вывода
      const itemsByCategory = enrichedItems.reduce((acc, item) => {
        const category = item.category || 'Другое'
        if (!acc[category]) {
          acc[category] = []
        }
        acc[category].push(item)
        return acc
      }, {} as Record<string, typeof enrichedItems>)

      // Формируем сообщение с результатом
      let message = `✅ Распознано блюд: ${enrichedItems.length}\n\n📋 Ваше меню:\n\n`
      
      // Выводим блюда по категориям
      for (const [category, items] of Object.entries(itemsByCategory)) {
        message += `**${category}**\n`
        for (const item of items) {
          const breakfastEmoji = item.is_breakfast ? '🌅 ' : ''
          message += `${breakfastEmoji}• ${item.name} — ${item.price}₽\n`
          if (item.description) {
            message += `  _${item.description}_\n`
          }
        }
        message += '\n'
      }

      message += 'Меню сохранено в базу данных! 🎉\n\n'
      message += '💡 Используйте /menu для просмотра меню по категориям'

      await ctx.reply(message, { parse_mode: 'Markdown' })
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

    // Группируем по категориям
    const itemsByCategory = items.reduce((acc, item) => {
      const category = item.category || 'Другое'
      if (!acc[category]) {
        acc[category] = []
      }
      acc[category].push(item)
      return acc
    }, {} as Record<string, typeof items>)

    // Формируем красивое меню с категориями
    let message = '📋 **Ваше меню**\n\n'
    
    const categoryEmojis: Record<string, string> = {
      'Завтраки': '🌅',
      'Закуски': '🍞',
      'Салаты': '🥗',
      'Супы': '🍲',
      'Пицца': '🍕',
      'Паста': '🍝',
      'Ризотто': '🍚',
      'Горячие блюда': '🥩',
      'Десерты': '🍰'
    }

    for (const [category, categoryItems] of Object.entries(itemsByCategory)) {
      const emoji = categoryEmojis[category] || '🍽️'
      message += `${emoji} **${category}** (${categoryItems.length})\n`
      
      for (const item of categoryItems) {
        const breakfastMark = item.is_breakfast ? ' 🌅' : ''
        message += `• ${item.name}${breakfastMark} — ${item.price}₽\n`
        if (item.description) {
          message += `  _${item.description}_\n`
        }
      }
      message += '\n'
    }

    message += `_Всего блюд: ${items.length}_\n`
    message += `_Завтраков: ${items.filter(i => i.is_breakfast).length}_`

    await ctx.reply(message, { parse_mode: 'Markdown' })
  })

  // Команда /categories - статистика по категориям
  bot.command('categories', async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) {
      await ctx.reply('❌ Не удалось определить chat ID')
      return
    }

    const restaurant = restaurantRepo.findByChatId(chatId)
    if (!restaurant) {
      await ctx.reply('У вас ещё нет меню. Отправьте фото меню!')
      return
    }

    const categories = menuRepo.getAllCategories(restaurant.id)
    if (categories.length === 0) {
      await ctx.reply('Меню пусто!')
      return
    }

    let message = '📊 **Статистика по категориям**\n\n'

    const categoryEmojis: Record<string, string> = {
      'Завтраки': '🌅',
      'Закуски': '🍞',
      'Салаты': '🥗',
      'Супы': '🍲',
      'Пицца': '🍕',
      'Паста': '🍝',
      'Ризотто': '🍚',
      'Горячие блюда': '🥩',
      'Десерты': '🍰'
    }

    for (const category of categories) {
      const items = menuRepo.findByCategoryAndRestaurantId(category, restaurant.id)
      const avgPrice = Math.round(items.reduce((sum, item) => sum + item.price, 0) / items.length)
      const emoji = categoryEmojis[category] || '🍽️'
      
      message += `${emoji} **${category}**\n`
      message += `   Блюд: ${items.length}\n`
      message += `   Средняя цена: ${avgPrice}₽\n\n`
    }

    const allItems = menuRepo.findByRestaurantId(restaurant.id)
    message += `_Всего категорий: ${categories.length}_\n`
    message += `_Всего блюд: ${allItems.length}_`

    await ctx.reply(message, { parse_mode: 'Markdown' })
  })

  // Команда /breakfasts - показать только завтраки
  bot.command('breakfasts', async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) {
      await ctx.reply('❌ Не удалось определить chat ID')
      return
    }

    const restaurant = restaurantRepo.findByChatId(chatId)
    if (!restaurant) {
      await ctx.reply('У вас ещё нет меню. Отправьте фото меню!')
      return
    }

    const breakfasts = menuRepo.findBreakfastsByRestaurantId(restaurant.id)
    
    if (breakfasts.length === 0) {
      await ctx.reply('В меню нет завтраков 🤷')
      return
    }

    let message = '🌅 **Завтраки**\n\n'
    
    for (const item of breakfasts) {
      message += `• ${item.name} — ${item.price}₽\n`
      if (item.description) {
        message += `  _${item.description}_\n`
      }
      if (item.category) {
        message += `  📂 ${item.category}\n`
      }
      message += '\n'
    }

    const avgPrice = Math.round(breakfasts.reduce((sum, item) => sum + item.price, 0) / breakfasts.length)
    message += `_Всего завтраков: ${breakfasts.length}_\n`
    message += `_Средняя цена: ${avgPrice}₽_\n\n`
    message += '⏰ Рекомендуется доступность до 11:00'

    await ctx.reply(message, { parse_mode: 'Markdown' })
  })

  return bot
}
