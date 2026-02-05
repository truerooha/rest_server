import { Bot, Context, InlineKeyboard } from 'grammy'
import { RestaurantRepository, MenuRepository } from '../db/repository'
import { VisionService } from '../services/vision'
import { MENU_CATEGORIES_ORDER, detectCategory, isBreakfastDish } from '../db/constants'
import Database from 'better-sqlite3'

// Типы для управления состоянием диалогов
type ConversationStep = 'name' | 'price' | 'description' | 'category'
type EditField = 'name' | 'price' | 'description' | 'category'

interface UserState {
  action: 'add' | 'edit'
  step: ConversationStep
  data: {
    name?: string
    price?: number
    description?: string
    category?: string
  }
  restaurantId: number
  editItemId?: number
  editField?: EditField
}

export function createBot(
  token: string,
  db: Database.Database,
  visionService: VisionService
) {
  const bot = new Bot(token)
  const restaurantRepo = new RestaurantRepository(db)
  const menuRepo = new MenuRepository(db)
  
  // Хранилище состояний пользователей для диалогов
  const userStates = new Map<number, UserState>()

  // Команда /start
  bot.command('start', async (ctx: Context) => {
    await ctx.reply(
      `👋 Привет! Я помогу тебе создать цифровое меню для твоего ресторана.

📸 Просто отправь мне фото своего меню, и я распознаю все блюда, цены и категории автоматически!

**Просмотр меню:**
/menu - показать меню по категориям
/categories - статистика по категориям
/breakfasts - показать только завтраки

**Управление меню:**
/add - добавить блюдо вручную
/delete - удалить блюдо
/stoplist - управление доступностью блюд
/edit - редактировать блюдо`,
      { parse_mode: 'Markdown' }
    )
  })

  // Команда /add - добавить блюдо вручную
  bot.command('add', async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) {
      await ctx.reply('❌ Не удалось определить chat ID')
      return
    }

    const restaurant = restaurantRepo.findOrCreateByChatId(
      chatId,
      ctx.chat.title || 'Мой ресторан'
    )

    // Сохраняем состояние диалога
    userStates.set(chatId, {
      action: 'add',
      step: 'name',
      data: {},
      restaurantId: restaurant.id,
    })

    await ctx.reply(
      '➕ **Добавление нового блюда**\n\n' +
      '📝 Шаг 1/4: Введите название блюда\n\n' +
      '_Для отмены отправьте /cancel_',
      { parse_mode: 'Markdown' }
    )
  })

  // Команда /cancel - отменить текущий диалог
  bot.command('cancel', async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return

    if (userStates.has(chatId)) {
      userStates.delete(chatId)
      await ctx.reply('❌ Операция отменена')
    } else {
      await ctx.reply('Нет активных операций')
    }
  })

  // Команда /delete - удалить блюдо
  bot.command('delete', async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) {
      await ctx.reply('❌ Не удалось определить chat ID')
      return
    }

    const restaurant = restaurantRepo.findByChatId(chatId)
    if (!restaurant) {
      await ctx.reply('У вас ещё нет меню. Отправьте фото меню или добавьте блюдо через /add')
      return
    }

    const items = menuRepo.findByRestaurantId(restaurant.id)
    if (items.length === 0) {
      await ctx.reply('Меню пусто!')
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

    let message = '🗑️ **Удаление блюда**\n\nВыберите блюдо для удаления:\n\n'

    const keyboard = new InlineKeyboard()

    for (const [category, categoryItems] of Object.entries(itemsByCategory)) {
      message += `**${category}:**\n`
      for (const item of categoryItems) {
        message += `• ${item.name} — ${item.price}₽\n`
        keyboard.text(`❌ ${item.name}`, `delete:${item.id}`).row()
      }
      message += '\n'
    }

    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    })
  })

  // Команда /edit - редактировать блюдо
  bot.command('edit', async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) {
      await ctx.reply('❌ Не удалось определить chat ID')
      return
    }

    const restaurant = restaurantRepo.findByChatId(chatId)
    if (!restaurant) {
      await ctx.reply('У вас ещё нет меню. Отправьте фото меню или добавьте блюдо через /add')
      return
    }

    const items = menuRepo.findByRestaurantId(restaurant.id)
    if (items.length === 0) {
      await ctx.reply('Меню пусто!')
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

    let message = '✏️ **Редактирование блюда**\n\nВыберите блюдо для редактирования:\n\n'

    const keyboard = new InlineKeyboard()

    for (const [category, categoryItems] of Object.entries(itemsByCategory)) {
      message += `**${category}:**\n`
      for (const item of categoryItems) {
        message += `• ${item.name} — ${item.price}₽\n`
        keyboard.text(`✏️ ${item.name}`, `edit_select:${item.id}`).row()
      }
      message += '\n'
    }

    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    })
  })

  // Команда /stoplist - управление доступностью блюд
  bot.command('stoplist', async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) {
      await ctx.reply('❌ Не удалось определить chat ID')
      return
    }

    const restaurant = restaurantRepo.findByChatId(chatId)
    if (!restaurant) {
      await ctx.reply('У вас ещё нет меню. Отправьте фото меню или добавьте блюдо через /add')
      return
    }

    const items = menuRepo.findByRestaurantId(restaurant.id)
    if (items.length === 0) {
      await ctx.reply('Меню пусто!')
      return
    }

    const available = items.filter(i => i.is_available)
    const unavailable = items.filter(i => !i.is_available)

    let message = '🚫 **Стоп-лист (управление доступностью)**\n\n'
    message += `✅ Доступно: ${available.length}\n`
    message += `❌ Скрыто: ${unavailable.length}\n\n`

    const keyboard = new InlineKeyboard()

    if (available.length > 0) {
      message += '**✅ Доступные блюда:**\n'
      for (const item of available) {
        message += `• ${item.name} — ${item.price}₽\n`
        keyboard.text(`🚫 ${item.name}`, `hide:${item.id}`).row()
      }
      message += '\n'
    }

    if (unavailable.length > 0) {
      message += '**❌ Скрытые блюда:**\n'
      for (const item of unavailable) {
        message += `• ${item.name} — ${item.price}₽\n`
        keyboard.text(`✅ ${item.name}`, `show:${item.id}`).row()
      }
    }

    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    })
  })

  // Обработка текстовых сообщений для диалогов
  bot.on('message:text', async (ctx: Context) => {
    const chatId = ctx.chat?.id
    const text = ctx.message?.text

    if (!chatId || !text) return

    // Проверяем, есть ли активный диалог
    const state = userStates.get(chatId)
    if (!state) return // Нет активного диалога, пропускаем

    try {
      // Редактирование существующего блюда
      if (state.action === 'edit' && state.editItemId && state.editField) {
        const item = menuRepo.findById(state.editItemId)
        if (!item) {
          await ctx.reply('❌ Блюдо не найдено')
          userStates.delete(chatId)
          return
        }

        if (state.editField === 'name') {
          menuRepo.updateItem(state.editItemId, { name: text.trim() })
          await ctx.reply(
            `✅ Название изменено!\n\n` +
            `📋 Новое название: **${text.trim()}**\n\n` +
            `/menu - посмотреть меню\n` +
            `/edit - редактировать ещё`,
            { parse_mode: 'Markdown' }
          )
        } else if (state.editField === 'price') {
          const price = parseFloat(text.replace(',', '.'))
          if (isNaN(price) || price <= 0) {
            await ctx.reply('❌ Неверный формат цены. Введите число больше 0')
            return
          }
          menuRepo.updateItem(state.editItemId, { price })
          await ctx.reply(
            `✅ Цена изменена!\n\n` +
            `📋 ${item.name}\n` +
            `💰 Новая цена: **${price}₽**\n\n` +
            `/menu - посмотреть меню\n` +
            `/edit - редактировать ещё`,
            { parse_mode: 'Markdown' }
          )
        } else if (state.editField === 'description') {
          const description = text.trim() === '-' ? null : text.trim()
          menuRepo.updateItem(state.editItemId, { description: description || undefined })
          await ctx.reply(
            `✅ Описание изменено!\n\n` +
            `📋 ${item.name}\n` +
            `📄 ${description || '_Описание удалено_'}\n\n` +
            `/menu - посмотреть меню\n` +
            `/edit - редактировать ещё`,
            { parse_mode: 'Markdown' }
          )
        }

        userStates.delete(chatId)
        return
      }

      // Добавление нового блюда
      if (state.action === 'add') {
        if (state.step === 'name') {
          // Сохраняем название
          state.data.name = text.trim()
          state.step = 'price'
          
          await ctx.reply(
            '💰 Шаг 2/4: Введите цену блюда (только число)\n\n' +
            `_Блюдо: ${state.data.name}_\n` +
            '_Для отмены отправьте /cancel_',
            { parse_mode: 'Markdown' }
          )
          
        } else if (state.step === 'price') {
          // Валидация и сохранение цены
          const price = parseFloat(text.replace(',', '.'))
          
          if (isNaN(price) || price <= 0) {
            await ctx.reply('❌ Неверный формат цены. Введите число больше 0')
            return
          }
          
          state.data.price = price
          state.step = 'description'
          
          await ctx.reply(
            '📄 Шаг 3/4: Введите описание блюда\n\n' +
            `_Блюдо: ${state.data.name} — ${price}₽_\n\n` +
            '_Отправьте "-" если описание не нужно_\n' +
            '_Для отмены отправьте /cancel_',
            { parse_mode: 'Markdown' }
          )
          
        } else if (state.step === 'description') {
          // Сохраняем описание
          state.data.description = text.trim() === '-' ? undefined : text.trim()
          state.step = 'category'
          
          // Пытаемся автоматически определить категорию
          const autoCategory = detectCategory(state.data.name!)
          
          // Создаём клавиатуру с категориями
          const keyboard = new InlineKeyboard()
          
          MENU_CATEGORIES_ORDER.forEach((category, index) => {
            const isAuto = category === autoCategory
            const label = isAuto ? `✨ ${category}` : category
            keyboard.text(label, `category:${category}`)
            
            // По 2 кнопки в ряд
            if (index % 2 === 1) keyboard.row()
          })
          
          let message = '🗂️ Шаг 4/4: Выберите категорию блюда\n\n' +
            `_Блюдо: ${state.data.name} — ${state.data.price}₽_\n`
          
          if (state.data.description) {
            message += `_${state.data.description}_\n\n`
          }
          
          if (autoCategory) {
            message += `✨ Рекомендуемая категория: **${autoCategory}**\n\n`
          }
          
          await ctx.reply(message, {
            parse_mode: 'Markdown',
            reply_markup: keyboard,
          })
        }
      }
    } catch (error) {
      console.error('Ошибка обработки диалога:', error)
      await ctx.reply('❌ Произошла ошибка. Попробуйте снова с /add')
      userStates.delete(chatId)
    }
  })

  // Обработка callback queries (нажатия на inline кнопки)
  bot.on('callback_query:data', async (ctx) => {
    const chatId = ctx.chat?.id
    const data = ctx.callbackQuery.data

    if (!chatId || !data) return

    try {
      // Обработка выбора категории при добавлении блюда
      if (data.startsWith('category:')) {
        const state = userStates.get(chatId)
        if (!state || state.step !== 'category') {
          await ctx.answerCallbackQuery('Операция устарела. Начните заново с /add')
          return
        }

        const category = data.replace('category:', '')
        state.data.category = category

        // Определяем, является ли блюдо завтраком
        const isBreakfast = isBreakfastDish(state.data.name!)

        // Сохраняем блюдо в базу
        menuRepo.createItem({
          restaurant_id: state.restaurantId,
          name: state.data.name!,
          price: state.data.price!,
          description: state.data.description,
          category: state.data.category,
          is_breakfast: isBreakfast,
          is_available: true,
        })

        // Очищаем состояние
        userStates.delete(chatId)

        const breakfastMark = isBreakfast ? ' 🌅' : ''
        await ctx.editMessageText(
          `✅ Блюдо добавлено!\n\n` +
          `📋 **${state.data.name}**${breakfastMark}\n` +
          `💰 ${state.data.price}₽\n` +
          `🗂️ ${state.data.category}\n` +
          (state.data.description ? `📄 _${state.data.description}_\n` : '') +
          `\n/menu - посмотреть меню`,
          { parse_mode: 'Markdown' }
        )

        await ctx.answerCallbackQuery('Блюдо добавлено!')
      }
      
      // Обработка удаления блюда
      else if (data.startsWith('delete:')) {
        const itemId = parseInt(data.replace('delete:', ''))
        const item = menuRepo.findById(itemId)
        
        if (!item) {
          await ctx.answerCallbackQuery('Блюдо не найдено')
          return
        }

        // Показываем подтверждение
        const keyboard = new InlineKeyboard()
          .text('✅ Да, удалить', `confirm_delete:${itemId}`)
          .text('❌ Отмена', 'cancel_delete')

        await ctx.editMessageText(
          `⚠️ **Подтверждение удаления**\n\n` +
          `Вы уверены, что хотите удалить?\n\n` +
          `📋 ${item.name}\n` +
          `💰 ${item.price}₽\n` +
          `🗂️ ${item.category || 'Без категории'}`,
          {
            parse_mode: 'Markdown',
            reply_markup: keyboard,
          }
        )

        await ctx.answerCallbackQuery()
      }
      
      // Подтверждение удаления
      else if (data.startsWith('confirm_delete:')) {
        const itemId = parseInt(data.replace('confirm_delete:', ''))
        const item = menuRepo.findById(itemId)
        
        if (!item) {
          await ctx.editMessageText('❌ Блюдо не найдено')
          await ctx.answerCallbackQuery('Блюдо не найдено')
          return
        }

        const itemName = item.name
        menuRepo.deleteItem(itemId)

        await ctx.editMessageText(
          `✅ Блюдо удалено!\n\n` +
          `🗑️ ${itemName}\n\n` +
          `/menu - посмотреть меню\n` +
          `/delete - удалить ещё`
        )

        await ctx.answerCallbackQuery('Блюдо удалено!')
      }
      
      // Отмена удаления
      else if (data === 'cancel_delete') {
        await ctx.editMessageText('❌ Удаление отменено')
        await ctx.answerCallbackQuery('Отменено')
      }
      
      // Скрыть блюдо (добавить в стоп-лист)
      else if (data.startsWith('hide:')) {
        const itemId = parseInt(data.replace('hide:', ''))
        const item = menuRepo.findById(itemId)
        
        if (!item) {
          await ctx.answerCallbackQuery('Блюдо не найдено')
          return
        }

        menuRepo.toggleAvailability(itemId)

        await ctx.editMessageText(
          `🚫 Блюдо скрыто!\n\n` +
          `📋 ${item.name}\n` +
          `💰 ${item.price}₽\n\n` +
          `Клиенты больше не увидят это блюдо в меню.\n\n` +
          `/stoplist - управление стоп-листом`
        )

        await ctx.answerCallbackQuery('Блюдо скрыто')
      }
      
      // Показать блюдо (убрать из стоп-листа)
      else if (data.startsWith('show:')) {
        const itemId = parseInt(data.replace('show:', ''))
        const item = menuRepo.findById(itemId)
        
        if (!item) {
          await ctx.answerCallbackQuery('Блюдо не найдено')
          return
        }

        menuRepo.toggleAvailability(itemId)

        await ctx.editMessageText(
          `✅ Блюдо снова доступно!\n\n` +
          `📋 ${item.name}\n` +
          `💰 ${item.price}₽\n\n` +
          `Клиенты снова увидят это блюдо в меню.\n\n` +
          `/stoplist - управление стоп-листом`
        )

        await ctx.answerCallbackQuery('Блюдо показано')
      }
      
      // Выбор блюда для редактирования
      else if (data.startsWith('edit_select:')) {
        const itemId = parseInt(data.replace('edit_select:', ''))
        const item = menuRepo.findById(itemId)
        
        if (!item) {
          await ctx.answerCallbackQuery('Блюдо не найдено')
          return
        }

        const keyboard = new InlineKeyboard()
          .text('📝 Название', `edit_field:${itemId}:name`).row()
          .text('💰 Цена', `edit_field:${itemId}:price`).row()
          .text('📄 Описание', `edit_field:${itemId}:description`).row()
          .text('🗂️ Категория', `edit_field:${itemId}:category`).row()
          .text('❌ Отмена', 'cancel_edit')

        await ctx.editMessageText(
          `✏️ **Редактирование блюда**\n\n` +
          `📋 ${item.name}\n` +
          `💰 ${item.price}₽\n` +
          `📄 ${item.description || '_нет описания_'}\n` +
          `🗂️ ${item.category || 'Без категории'}\n\n` +
          `Что хотите изменить?`,
          {
            parse_mode: 'Markdown',
            reply_markup: keyboard,
          }
        )

        await ctx.answerCallbackQuery()
      }
      
      // Выбор поля для редактирования
      else if (data.startsWith('edit_field:')) {
        const parts = data.split(':')
        const itemId = parseInt(parts[1])
        const field = parts[2] as EditField
        const item = menuRepo.findById(itemId)
        
        if (!item) {
          await ctx.answerCallbackQuery('Блюдо не найдено')
          return
        }

        if (field === 'category') {
          // Для категории показываем inline клавиатуру
          const keyboard = new InlineKeyboard()
          
          MENU_CATEGORIES_ORDER.forEach((category, index) => {
            const isCurrent = category === item.category
            const label = isCurrent ? `✓ ${category}` : category
            keyboard.text(label, `edit_category:${itemId}:${category}`)
            
            if (index % 2 === 1) keyboard.row()
          })
          
          keyboard.row().text('❌ Отмена', 'cancel_edit')

          await ctx.editMessageText(
            `🗂️ **Изменение категории**\n\n` +
            `📋 ${item.name}\n` +
            `Текущая категория: **${item.category || 'Не указана'}**\n\n` +
            `Выберите новую категорию:`,
            {
              parse_mode: 'Markdown',
              reply_markup: keyboard,
            }
          )
        } else {
          // Для остальных полей просим ввести текст
          userStates.set(chatId, {
            action: 'edit',
            step: field as ConversationStep,
            data: {},
            restaurantId: item.restaurant_id,
            editItemId: itemId,
            editField: field,
          })

          let promptMessage = ''
          let currentValue = ''

          if (field === 'name') {
            promptMessage = '📝 Введите новое название блюда:'
            currentValue = item.name
          } else if (field === 'price') {
            promptMessage = '💰 Введите новую цену (только число):'
            currentValue = `${item.price}₽`
          } else if (field === 'description') {
            promptMessage = '📄 Введите новое описание:\n\n_Отправьте "-" чтобы удалить описание_'
            currentValue = item.description || '_нет описания_'
          }

          await ctx.editMessageText(
            `✏️ **Редактирование блюда**\n\n` +
            `📋 ${item.name}\n` +
            `Текущее значение: ${currentValue}\n\n` +
            promptMessage + '\n\n' +
            `_Для отмены отправьте /cancel_`,
            { parse_mode: 'Markdown' }
          )
        }

        await ctx.answerCallbackQuery()
      }
      
      // Изменение категории
      else if (data.startsWith('edit_category:')) {
        const parts = data.split(':')
        const itemId = parseInt(parts[1])
        const newCategory = parts[2]
        const item = menuRepo.findById(itemId)
        
        if (!item) {
          await ctx.answerCallbackQuery('Блюдо не найдено')
          return
        }

        menuRepo.updateItem(itemId, { category: newCategory })

        await ctx.editMessageText(
          `✅ Категория изменена!\n\n` +
          `📋 ${item.name}\n` +
          `🗂️ Новая категория: **${newCategory}**\n\n` +
          `/menu - посмотреть меню\n` +
          `/edit - редактировать ещё`,
          { parse_mode: 'Markdown' }
        )

        await ctx.answerCallbackQuery('Категория изменена!')
      }
      
      // Отмена редактирования
      else if (data === 'cancel_edit') {
        await ctx.editMessageText('❌ Редактирование отменено')
        await ctx.answerCallbackQuery('Отменено')
      }
    } catch (error) {
      console.error('Ошибка обработки callback:', error)
      await ctx.answerCallbackQuery('Произошла ошибка')
    }
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
