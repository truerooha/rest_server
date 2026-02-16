import { Bot, Context, InlineKeyboard, Keyboard } from 'grammy'
import {
  RestaurantRepository,
  MenuRepository,
  OrderRepository,
  UserRepository,
  GroupOrderRepository,
  BuildingRepository,
} from '../db/repository'
import { DraftRepository } from '../db/repository-drafts'
import { VisionService } from '../services/vision'
import { logger } from '../utils/logger'
import { MENU_CATEGORIES_ORDER, detectCategory, isBreakfastDish } from '../db/constants'
import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import { config } from '../utils/config'

export type AdminBotOptions = {
  notifyUser?: (telegramUserId: number, text: string) => Promise<void>
}

export type GroupOrderMessageParams = {
  restaurantName: string
  buildingName: string
  deliverySlot: string
  groupOrderId: number
  orders: Array<{
    id: number
    userId: number
    totalPrice: number
    items: string
    userName?: string
  }>
  totalAmount: number
  participantCount: number
}

/** Формирует текст и клавиатуру для сообщения о групповом заказе */
export function formatGroupOrderMessage(params: GroupOrderMessageParams): { text: string; keyboard: InlineKeyboard } {
  const { restaurantName, buildingName, deliverySlot, groupOrderId, orders, totalAmount, participantCount } = params
  const lines: string[] = [
    `📦 Заказ`,
    `Ресторан: ${restaurantName}`,
    `Здание: ${buildingName}`,
    `Слот: ${deliverySlot}`,
    `Участников: ${participantCount}`,
    `Сумма: ${totalAmount} ₽`,
    ``,
  ]
  orders.forEach((order, i) => {
    const userName = `Клиент ${i + 1}`
    const items = JSON.parse(order.items) as Array<{ name: string; price: number; quantity: number }>
    const orderLines = items.map((i) => `    • ${i.name} × ${i.quantity} — ${i.price * i.quantity} ₽`)
    lines.push(`👤 ${userName} (${order.totalPrice} ₽):`)
    lines.push(...orderLines)
    lines.push('')
  })
  const keyboard = new InlineKeyboard()
    .text('✅ Принять', `group:${groupOrderId}:accept`)
    .text('❌ Отклонить', `group:${groupOrderId}:reject`)
  return { text: lines.join('\n'), keyboard }
}

// Функция для экранирования HTML спецсимволов
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Типы для управления состоянием диалогов
type ConversationStep = 'name' | 'price' | 'description' | 'category'
type EditField = 'name' | 'price' | 'description' | 'category' | 'photo'

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
  visionService: VisionService,
  options?: AdminBotOptions
) {
  const bot = new Bot(token)
  const restaurantRepo = new RestaurantRepository(db)
  const menuRepo = new MenuRepository(db)
  const orderRepo = new OrderRepository(db)
  const userRepo = new UserRepository(db)
  const draftRepo = new DraftRepository(db)
  const groupOrderRepo = new GroupOrderRepository(db)
  const buildingRepo = new BuildingRepository(db)
  const notifyUser = options?.notifyUser

  const userStates = new Map<number, UserState>()
  const awaitingRestaurantName = new Set<number>()
  const awaitingPhotoForItem = new Map<number, number>() // chatId → menuItemId
  const awaitingSbpLink = new Set<number>() // chatId

  /** Удаляет файл изображения блюда с диска, если он существует */
  function deleteItemImage(imageUrl: string | undefined | null): void {
    if (!imageUrl) return
    try {
      const filename = path.basename(imageUrl)
      const filepath = path.join(config.uploadsPath, filename)
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath)
      }
    } catch (err) {
      logger.warn('Не удалось удалить файл изображения', { imageUrl, error: err })
    }
  }

  /** Удаляет все файлы изображений для блюд ресторана */
  function deleteAllItemImages(restaurantId: number): void {
    const items = menuRepo.findByRestaurantId(restaurantId)
    for (const item of items) {
      deleteItemImage(item.image_url)
    }
  }

  function getHelpText(): string {
    return (
      `👋 Привет! Я помогу тебе создать цифровое меню для твоего ресторана.\n\n` +
      `📸 Просто отправь мне фото своего меню, и я распознаю все блюда, цены и категории автоматически!\n\n` +
      `**Заказы:**\n` +
      `/orders - список заказов (Принять / Готово / Отменить)\n\n` +
      `**Просмотр меню:**\n` +
      `/menu - показать меню по категориям\n` +
      `/categories - статистика по категориям\n` +
      `/breakfasts - показать только завтраки\n\n` +
      `**Управление меню:**\n` +
      `/add - добавить блюдо вручную\n` +
      `/delete - удалить блюдо\n` +
      `/stoplist - управление доступностью блюд\n` +
      `/edit - редактировать блюдо\n` +
      `/photos - добавить фотографии к блюдам\n\n` +
      `**Настройки:**\n` +
      `/payment - ссылка для оплаты по СБП\n\n` +
      `**Опасная зона:**\n` +
      `/clearall - удалить все данные вашего ресторана\n` +
      `/wipe_orders - [ТЕСТ] удалить все заказы в системе\n` +
      `/wipeall - [ТЕСТ] удалить ВСЁ в базе`
    )
  }

  async function safeReplyHelp(ctx: Context, options?: { withKeyboard?: boolean }) {
    try {
      const replyOptions: Parameters<typeof ctx.reply>[1] = {
        parse_mode: 'Markdown',
      }
      if (options?.withKeyboard) {
        replyOptions.reply_markup = getMainKeyboard()
      }
      await ctx.reply(getHelpText(), replyOptions)
    } catch (error) {
      // Если вдруг Telegram ругнётся на Markdown — шлём простой текст
      logger.error('Не удалось отправить help-текст админ-бота', { error })
      await ctx.reply(
        '👋 Привет! Я помогу тебе создать цифровое меню для твоего ресторана.\n\n' +
          'Команды:\n' +
          '/orders — заказы\n' +
          '/menu — меню\n' +
          '/add, /edit, /delete, /stoplist, /photos — управление меню\n' +
          '/payment — ссылка для оплаты по СБП\n' +
          '/clearall, /wipe_orders, /wipeall — опасные тестовые команды',
      )
    }
  }

  function getMainKeyboard(): Keyboard {
    return new Keyboard().text('📋 Команды').resized().persistent()
  }

  // Кнопка «Команды» — всегда показывает справку
  bot.hears('📋 Команды', async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return
    const restaurant = restaurantRepo.findByChatId(chatId)
    if (!restaurant) {
      await ctx.reply('❌ Ресторан не найден. Отправьте /start и укажите название ресторана.')
      return
    }
    await safeReplyHelp(ctx, { withKeyboard: true })
  })

  // Команда /start — всегда показывает приветствие
  bot.command('start', async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return

    const restaurant = restaurantRepo.findByChatId(chatId)
    if (restaurant) {
      await safeReplyHelp(ctx, { withKeyboard: true })
      return
    }

    awaitingRestaurantName.add(chatId)
    await ctx.reply(
      '👋 Привет! Как называется ваш ресторан?\n\n_Напишите короткое название — оно будет отображаться в приложении._',
      { parse_mode: 'Markdown' }
    )
  })

  // /help — дублирует start для быстрого доступа к справке
  bot.command('help', async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return
    const restaurant = restaurantRepo.findByChatId(chatId)
    if (!restaurant) {
      await ctx.reply('❌ Ресторан не найден. Отправьте /start и укажите название ресторана.')
      return
    }
    await safeReplyHelp(ctx, { withKeyboard: true })
  })

  // Команда /orders - список заказов: сначала групповые на подтверждении, затем индивидуальные
  bot.command('orders', async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) {
      await ctx.reply('❌ Не удалось определить chat ID')
      return
    }
    const restaurant = restaurantRepo.findByChatId(chatId)
    if (!restaurant) {
      await ctx.reply('❌ Ресторан не найден. Сначала отправьте /start и укажите название ресторана.')
      return
    }
    let hasAny = false
    const pendingGroups = groupOrderRepo.findPendingByRestaurant(restaurant.id)
    for (const group of pendingGroups) {
      const building = buildingRepo.findById(group.building_id)
      const orders = orderRepo.findPendingForGroup(
        group.delivery_slot,
        group.building_id,
        group.restaurant_id,
        group.order_date,
      )
      if (orders.length === 0) continue
      hasAny = true
      const totalAmount = orders.reduce((s, o) => s + o.total_price, 0)
      const { text, keyboard } = formatGroupOrderMessage({
        restaurantName: restaurant.name,
        buildingName: building?.name ?? '',
        deliverySlot: group.delivery_slot,
        groupOrderId: group.id,
        orders: orders.map((o) => {
          const user = userRepo.findById(o.user_id)
          return {
            id: o.id,
            userId: o.user_id,
            totalPrice: o.total_price,
            items: o.items,
            userName: user?.first_name || user?.username || undefined,
          }
        }),
        totalAmount,
        participantCount: orders.length,
      })
      await ctx.reply(text, { reply_markup: keyboard })
    }
    const individualOrders = orderRepo.findActiveByRestaurantId(restaurant.id).filter((o) => {
      const orderDate = o.order_date ?? o.created_at.split('T')[0]
      const group = groupOrderRepo.findByRestaurantAndSlot(
        o.restaurant_id,
        o.building_id,
        o.delivery_slot,
        orderDate,
      )
      return !group || group.status !== 'pending_restaurant'
    })
    for (const order of individualOrders) {
      const items = JSON.parse(order.items) as Array<{ name: string; price: number; quantity: number }>
      const lines = items.map((i) => `  • ${i.name} × ${i.quantity} — ${i.price * i.quantity} ₽`)
      const text = `📦 Заказ #${order.id}\nСлот: ${order.delivery_slot}\nСумма: ${order.total_price} ₽\nСтатус: ${order.status}\n\n${lines.join('\n')}`
      const keyboard = new InlineKeyboard()
      if (order.status === 'confirmed') {
        keyboard.text('✅ Принять', `order:${order.id}:accept`).text('❌ Отменить', `order:${order.id}:cancel`).row()
      }
      if (order.status === 'confirmed' || order.status === 'restaurant_confirmed' || order.status === 'preparing') {
        keyboard.text('🍽️ Готово', `order:${order.id}:ready`)
      }
      await ctx.reply(text, { reply_markup: keyboard })
      hasAny = true
    }
    if (!hasAny) {
      await ctx.reply('📋 Нет активных заказов.')
    }
  })

  // Обработка кнопок группового заказа: Принять / Отклонить
  bot.on('callback_query', async (ctx: Context, next: () => Promise<void>) => {
    const data = ctx.callbackQuery?.data
    if (!data || !data.startsWith('group:')) {
      return handleOrderCallback(ctx, next)
    }
    const parts = data.split(':')
    if (parts.length < 3) {
      await ctx.answerCallbackQuery()
      return
    }
    const groupId = parseInt(parts[1], 10)
    const action = parts[2]
    if (!Number.isFinite(groupId) || !['accept', 'reject'].includes(action)) {
      await ctx.answerCallbackQuery()
      return
    }
    const chatId =
      ctx.callbackQuery?.message && 'chat' in ctx.callbackQuery.message
        ? ctx.callbackQuery.message.chat.id
        : ctx.chat?.id
    if (!chatId) {
      await ctx.answerCallbackQuery()
      return
    }
    const restaurant = restaurantRepo.findByChatId(chatId)
    if (!restaurant) {
      await ctx.answerCallbackQuery({ text: 'Ресторан не найден' })
      return
    }
    const groupOrder = groupOrderRepo.findById(groupId)
    if (!groupOrder || groupOrder.restaurant_id !== restaurant.id || groupOrder.status !== 'pending_restaurant') {
      await ctx.answerCallbackQuery({ text: 'Заказ уже обработан или не найден' })
      return
    }
    const orders = orderRepo.findPendingForGroup(
      groupOrder.delivery_slot,
      groupOrder.building_id,
      groupOrder.restaurant_id,
      groupOrder.order_date,
    )
    if (orders.length === 0) {
      await ctx.answerCallbackQuery({ text: 'Заказы не найдены' })
      return
    }
    if (action === 'accept') {
      groupOrderRepo.updateStatus(groupId, 'accepted')
      orderRepo.updateStatusBatch(orders.map((o) => o.id), 'restaurant_confirmed')
      await ctx.answerCallbackQuery({ text: 'Заказ принят' })
      try {
        const msg = ctx.callbackQuery?.message
        if (msg && 'message_id' in msg) {
          await ctx.api.editMessageReplyMarkup(chatId, msg.message_id, { reply_markup: { inline_keyboard: [] } })
        }
      } catch {
        // Игнорируем ошибки редактирования (например, сообщение устарело)
      }
      for (const order of orders) {
        const user = userRepo.findById(order.user_id)
        if (notifyUser && user) {
          await notifyUser(user.telegram_user_id, '✅ Ваш заказ Подтверждён.')
        }
      }
    } else {
      groupOrderRepo.updateStatus(groupId, 'rejected')
      for (const order of orders) {
        orderRepo.updateStatus(order.id, 'cancelled')
      }
      await ctx.answerCallbackQuery({ text: 'Заказ отклонён' })
      try {
        const msg = ctx.callbackQuery?.message
        if (msg && 'message_id' in msg) {
          await ctx.api.editMessageReplyMarkup(chatId, msg.message_id, { reply_markup: { inline_keyboard: [] } })
        }
      } catch {
        // Игнорируем ошибки редактирования (например, сообщение устарело)
      }
      for (const order of orders) {
        const user = userRepo.findById(order.user_id)
        if (notifyUser && user) {
          await notifyUser(user.telegram_user_id, '❌ Общий заказ отклонён рестораном.')
        }
      }
    }
  })

  async function handleOrderCallback(ctx: Context, next: () => Promise<void>): Promise<void> {
    const data = ctx.callbackQuery?.data
    if (!data || !data.startsWith('order:')) {
      return next()
    }
    const parts = data.split(':')
    if (parts.length < 3) {
      await ctx.answerCallbackQuery()
      return
    }
    const orderId = parseInt(parts[1], 10)
    const action = parts[2]
    if (!Number.isFinite(orderId) || !['accept', 'ready', 'cancel'].includes(action)) {
      await ctx.answerCallbackQuery()
      return
    }
    const chatId =
      ctx.callbackQuery?.message && 'chat' in ctx.callbackQuery.message
        ? ctx.callbackQuery.message.chat.id
        : ctx.chat?.id
    if (!chatId) {
      await ctx.answerCallbackQuery()
      return
    }
    const restaurant = restaurantRepo.findByChatId(chatId)
    if (!restaurant) {
      await ctx.answerCallbackQuery({ text: 'Ресторан не найден' })
      return
    }
    const order = orderRepo.findById(orderId)
    if (!order || order.restaurant_id !== restaurant.id) {
      await ctx.answerCallbackQuery({ text: 'Заказ не найден' })
      return
    }
    const user = userRepo.findById(order.user_id)
    const telegramUserId = user?.telegram_user_id

    if (action === 'accept') {
      if (order.status !== 'confirmed') {
        await ctx.answerCallbackQuery({ text: 'Заказ уже обработан' })
        return
      }
      orderRepo.updateStatus(orderId, 'preparing')
      await ctx.answerCallbackQuery({ text: 'Заказ принят в работу' })
      if (notifyUser && telegramUserId) {
        await notifyUser(telegramUserId, '✅ Ваш заказ принят в работу.')
      }
      // Обновляем сообщение: статус и клавиатура с кнопкой «Готово»
      const msg = ctx.callbackQuery?.message
      if (msg && 'message_id' in msg && 'text' in msg) {
        try {
          const updatedOrder = orderRepo.findById(orderId)
          if (updatedOrder) {
            const items = JSON.parse(updatedOrder.items) as Array<{
              name: string
              price: number
              quantity: number
            }>
            const lines = items.map(
              (i) => `  • ${i.name} × ${i.quantity} — ${i.price * i.quantity} ₽`
            )
            const text = `📦 Заказ #${updatedOrder.id}\nСлот: ${updatedOrder.delivery_slot}\nСумма: ${updatedOrder.total_price} ₽\nСтатус: ${updatedOrder.status}\n\n${lines.join('\n')}`
            const keyboard = new InlineKeyboard().text('🍽️ Готово', `order:${orderId}:ready`)
            await ctx.api.editMessageText(chatId, msg.message_id, text, {
              reply_markup: keyboard,
            })
          }
        } catch {
          // Игнорируем ошибки редактирования (например, сообщение устарело)
        }
      }
    } else if (action === 'ready') {
      if (order.status !== 'confirmed' && order.status !== 'restaurant_confirmed' && order.status !== 'preparing') {
        await ctx.answerCallbackQuery({ text: 'Заказ уже обработан' })
        return
      }
      orderRepo.updateStatus(orderId, 'ready')
      await ctx.answerCallbackQuery({ text: 'Отмечено: готово' })
      if (notifyUser && telegramUserId) {
        await notifyUser(telegramUserId, '🍽️ Ваш заказ готов!')
      }
    } else if (action === 'cancel') {
      if (order.status === 'cancelled') {
        await ctx.answerCallbackQuery({ text: 'Заказ уже отменён' })
        return
      }
      orderRepo.updateStatus(orderId, 'cancelled')
      await ctx.answerCallbackQuery({ text: 'Заказ отменён' })
      if (notifyUser && telegramUserId) {
        await notifyUser(telegramUserId, '❌ Заказ отменён рестораном.')
      }
    }
  }

  // Команда /add - добавить блюдо вручную
  bot.command('add', async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) {
      await ctx.reply('❌ Не удалось определить chat ID')
      return
    }

    const restaurant = restaurantRepo.findByChatId(chatId)
    if (!restaurant) {
      await ctx.reply('❌ Ресторан не найден. Сначала отправьте /start и укажите название ресторана.')
      return
    }

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

    if (awaitingRestaurantName.has(chatId)) {
      awaitingRestaurantName.delete(chatId)
      await ctx.reply('Отменено. Напишите /start когда будете готовы.')
    } else if (awaitingPhotoForItem.has(chatId)) {
      awaitingPhotoForItem.delete(chatId)
      await ctx.reply('❌ Загрузка фото отменена')
    } else if (awaitingSbpLink.has(chatId)) {
      awaitingSbpLink.delete(chatId)
      await ctx.reply('❌ Ввод ссылки СБП отменён')
    } else if (userStates.has(chatId)) {
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
      await ctx.reply('❌ Ресторан не найден. Сначала отправьте /start и укажите название ресторана.')
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
      await ctx.reply('❌ Ресторан не найден. Сначала отправьте /start и укажите название ресторана.')
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
      await ctx.reply('❌ Ресторан не найден. Сначала отправьте /start и укажите название ресторана.')
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
      
      // Выбор блюда для загрузки фото
      else if (data.startsWith('photo:')) {
        const itemId = parseInt(data.replace('photo:', ''))
        const item = menuRepo.findById(itemId)

        if (!item) {
          await ctx.answerCallbackQuery('Блюдо не найдено')
          return
        }

        awaitingPhotoForItem.set(chatId, itemId)

        const hasPhoto = item.image_url ? '\n\n⚠️ У блюда уже есть фото — оно будет заменено.' : ''
        await ctx.editMessageText(
          `📷 **Отправьте фото для блюда:**\n\n` +
          `📋 ${item.name} — ${item.price}₽${hasPhoto}\n\n` +
          `_Для отмены отправьте /cancel_`,
          { parse_mode: 'Markdown' }
        )

        await ctx.answerCallbackQuery()
      }

      // noop — пустая кнопка-разделитель
      else if (data === 'noop') {
        await ctx.answerCallbackQuery()
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
        deleteItemImage(item.image_url)
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

        const photoLabel = item.image_url ? '📷 Фото ✅' : '📷 Фото'
        const keyboard = new InlineKeyboard()
          .text('📝 Название', `edit_field:${itemId}:name`).row()
          .text('💰 Цена', `edit_field:${itemId}:price`).row()
          .text('📄 Описание', `edit_field:${itemId}:description`).row()
          .text('🗂️ Категория', `edit_field:${itemId}:category`).row()
          .text(photoLabel, `edit_field:${itemId}:photo`).row()
          .text('❌ Отмена', 'cancel_edit')

        const photoStatus = item.image_url ? '📷 Фото: ✅ есть' : '📷 Фото: нет'

        await ctx.editMessageText(
          `✏️ **Редактирование блюда**\n\n` +
          `📋 ${item.name}\n` +
          `💰 ${item.price}₽\n` +
          `📄 ${item.description || '_нет описания_'}\n` +
          `🗂️ ${item.category || 'Без категории'}\n` +
          `${photoStatus}\n\n` +
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

        if (field === 'photo') {
          // Для фото — показываем варианты: загрузить новое, удалить текущее
          const keyboard = new InlineKeyboard()
            .text('📷 Загрузить новое фото', `edit_photo_upload:${itemId}`).row()

          if (item.image_url) {
            keyboard.text('🗑️ Удалить фото', `edit_photo_delete:${itemId}`).row()
          }

          keyboard.text('◀️ Назад', `edit_select:${itemId}`).row()

          const photoInfo = item.image_url
            ? '✅ У блюда есть фото.'
            : '❌ У блюда нет фото.'

          await ctx.editMessageText(
            `📷 **Фото блюда**\n\n` +
            `📋 ${item.name}\n` +
            `${photoInfo}\n\n` +
            `Выберите действие:`,
            {
              parse_mode: 'Markdown',
              reply_markup: keyboard,
            }
          )
        } else if (field === 'category') {
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

      // Загрузка нового фото из редактирования
      else if (data.startsWith('edit_photo_upload:')) {
        const itemId = parseInt(data.replace('edit_photo_upload:', ''))
        const item = menuRepo.findById(itemId)

        if (!item) {
          await ctx.answerCallbackQuery('Блюдо не найдено')
          return
        }

        awaitingPhotoForItem.set(chatId, itemId)

        await ctx.editMessageText(
          `📷 **Загрузка фото**\n\n` +
          `📋 ${item.name} — ${item.price}₽\n\n` +
          `Отправьте фото блюда.\n` +
          (item.image_url ? '_Текущее фото будет заменено._\n' : '') +
          `\n_Для отмены отправьте /cancel_`,
          { parse_mode: 'Markdown' }
        )

        await ctx.answerCallbackQuery()
      }

      // Удаление фото из редактирования
      else if (data.startsWith('edit_photo_delete:')) {
        const itemId = parseInt(data.replace('edit_photo_delete:', ''))
        const item = menuRepo.findById(itemId)

        if (!item) {
          await ctx.answerCallbackQuery('Блюдо не найдено')
          return
        }

        deleteItemImage(item.image_url)
        menuRepo.updateItem(itemId, { image_url: null })

        await ctx.editMessageText(
          `✅ Фото удалено!\n\n` +
          `📋 ${item.name}\n\n` +
          `/edit - редактировать ещё\n` +
          `/photos - добавить фото к блюдам`,
          { parse_mode: 'Markdown' }
        )

        await ctx.answerCallbackQuery('Фото удалено')
      }
      
      // Отмена редактирования
      else if (data === 'cancel_edit') {
        await ctx.editMessageText('❌ Редактирование отменено')
        await ctx.answerCallbackQuery('Отменено')
      }
      
      // Подтверждение удаления данных текущего ресторана
      else if (data === 'confirm_clearall') {
        const chatIdForCallback =
          ctx.callbackQuery?.message && 'chat' in ctx.callbackQuery.message
            ? ctx.callbackQuery.message.chat.id
            : ctx.chat?.id

        const restaurant = chatIdForCallback ? restaurantRepo.findByChatId(chatIdForCallback) : null
        if (!restaurant) {
          await ctx.editMessageText('❌ Ресторан не найден. Возможно, он уже удалён.')
          await ctx.answerCallbackQuery('Ресторан не найден')
          return
        }

        try {
          const restaurantId = restaurant.id
          deleteAllItemImages(restaurantId)
          const deleteTransaction = db.transaction(() => {
            // Удаляем в порядке учёта FK
            db.prepare('DELETE FROM orders WHERE restaurant_id = ?').run(restaurantId)
            db.prepare('DELETE FROM menu_items WHERE restaurant_id = ?').run(restaurantId)
            db.prepare('DELETE FROM restaurant_buildings WHERE restaurant_id = ?').run(restaurantId)
            db.prepare('UPDATE user_drafts SET restaurant_id = NULL, items = ? WHERE restaurant_id = ?').run('[]', restaurantId)
            db.prepare('DELETE FROM restaurants WHERE id = ?').run(restaurantId)
          })

          deleteTransaction()

          await ctx.editMessageText(
            '✅ <b>Данные ресторана удалены</b>\n\n' +
            'Отправьте /start чтобы создать новый ресторан и начать заново.',
            { parse_mode: 'HTML' }
          )

          await ctx.answerCallbackQuery('Данные удалены!')
        } catch (error) {
          const err = error instanceof Error ? error.message : String(error)
          await ctx.editMessageText(
            `❌ Ошибка при удалении: <code>${err}</code>`,
            { parse_mode: 'HTML' }
          )
          await ctx.answerCallbackQuery('Ошибка!')
        }
      }
      
      // Отмена удаления всех данных текущего ресторана
      else if (data === 'cancel_clearall') {
        await ctx.editMessageText('✅ Операция отменена. Данные в безопасности.')
        await ctx.answerCallbackQuery('Отменено')
      }

      // [ТЕСТ] Подтверждение удаления всех заказов
      else if (data === 'confirm_wipe_orders') {
        try {
          const deleteOrders = db.transaction(() => {
            db.prepare('DELETE FROM orders').run()
          })
          deleteOrders()
          await ctx.editMessageText(
            '✅ [ТЕСТ] Все заказы в системе удалены.\n\n' +
            'Групповые суммы и списки заказов будут пустыми до создания новых заказов.'
          )
          await ctx.answerCallbackQuery('Готово')
        } catch (error) {
          const err = error instanceof Error ? error.message : String(error)
          await ctx.editMessageText(`❌ Ошибка: <code>${err}</code>`, { parse_mode: 'HTML' })
          await ctx.answerCallbackQuery('Ошибка')
        }
      }
      // Отмена удаления всех заказов
      else if (data === 'cancel_wipe_orders') {
        await ctx.editMessageText('✅ Операция отменена. Заказы не тронуты.')
        await ctx.answerCallbackQuery('Отменено')
      }

      // [ТЕСТ] Подтверждение полной очистки базы + повторная инициализация дефолтных данных
      else if (data === 'confirm_wipeall') {
        try {
          // Удаляем все файлы изображений
          try {
            const uploadsDir = config.uploadsPath
            if (fs.existsSync(uploadsDir)) {
              const files = fs.readdirSync(uploadsDir).filter((f) => f !== '.gitkeep')
              for (const file of files) {
                fs.unlinkSync(path.join(uploadsDir, file))
              }
            }
          } catch (err) {
            logger.warn('Не удалось очистить директорию uploads', { error: err })
          }
          const deleteAll = db.transaction(() => {
            const tables = [
              // Лобби слотов / групповые заказы
              'slot_lobby_reservations',
              'group_orders',
              // Основные сущности
              'orders',
              'menu_items',
              'restaurant_buildings',
              'user_drafts',
              'users',
              'buildings',
              'restaurants',
            ]
            for (const table of tables) {
              try {
                db.prepare(`DELETE FROM ${table}`).run()
              } catch (e) {
                if (e instanceof Error && !e.message.includes('no such table')) throw e
              }
            }
          })
          deleteAll()
          // После полной очистки заново создаём дефолтные данные,
          // как это делает эндпоинт /api/init-default-data
          try {
            const buildings = db.prepare('SELECT * FROM buildings').all() as Array<{ id: number; name: string }>
            const coworking = buildings.find((b) => b.name === 'Коворкинг')
            const coworkingBuilding =
              coworking ??
              db
                .prepare('INSERT INTO buildings (name, address) VALUES (?, ?)')
                .run('Коворкинг', 'Дефолтный адрес коворкинга') && (db
                .prepare('SELECT * FROM buildings WHERE name = ?')
                .get('Коворкинг') as { id: number; name: string })

            const restaurants = db.prepare('SELECT * FROM restaurants').all() as any[]
            let restaurant: any

            if (restaurants.length === 0) {
              const result = db
                .prepare('INSERT INTO restaurants (name, chat_id) VALUES (?, ?)')
                .run('Фудкорнер', 123456789)
              restaurant = {
                id: result.lastInsertRowid as number,
                name: 'Фудкорнер',
              }
            } else {
              restaurant = restaurants[0]
              if (restaurant.name !== 'Фудкорнер') {
                db.prepare('UPDATE restaurants SET name = ? WHERE id = ?').run('Фудкорнер', restaurant.id)
                restaurant.name = 'Фудкорнер'
              }
            }

            const existingLink = db
              .prepare('SELECT * FROM restaurant_buildings WHERE restaurant_id = ? AND building_id = ?')
              .get(restaurant.id, coworkingBuilding.id)

            if (!existingLink) {
              db
                .prepare(
                  'INSERT OR IGNORE INTO restaurant_buildings (restaurant_id, building_id) VALUES (?, ?)',
                )
                .run(restaurant.id, coworkingBuilding.id)
            }

            await ctx.editMessageText(
              '✅ [ТЕСТ] Вся база очищена и заново инициализирована дефолтными данными.\n\n' +
                `Здание: ${coworkingBuilding.name}\n` +
                `Ресторан: ${restaurant.name}`,
            )
          } catch (seedError) {
            logger.error('Ошибка повторной инициализации после wipeall', { error: seedError })
            await ctx.editMessageText(
              '✅ [ТЕСТ] Вся база очищена.\n\n' +
                '⚠️ Ошибка при автоматической инициализации дефолтных данных.\n' +
                'Повтори инициализацию через /api/init-default-data.',
            )
          }
          await ctx.answerCallbackQuery('Готово')
        } catch (error) {
          const err = error instanceof Error ? error.message : String(error)
          await ctx.editMessageText(`❌ Ошибка: <code>${err}</code>`, { parse_mode: 'HTML' })
          await ctx.answerCallbackQuery('Ошибка')
        }
      }
      else if (data === 'cancel_wipeall') {
        await ctx.editMessageText('✅ Отменено.')
        await ctx.answerCallbackQuery('Отменено')
      }
    } catch (error) {
      logger.error('Ошибка обработки callback', { error })
      await ctx.answerCallbackQuery('Произошла ошибка')
    }
  })

  // Команда /photos — управление фотографиями блюд
  bot.command('photos', async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return

    const restaurant = restaurantRepo.findByChatId(chatId)
    if (!restaurant) {
      await ctx.reply('❌ Ресторан не найден. Сначала отправьте /start и укажите название ресторана.')
      return
    }

    const items = menuRepo.findByRestaurantId(restaurant.id)
    if (items.length === 0) {
      await ctx.reply('Меню пусто! Сначала отправьте фото меню для распознавания.')
      return
    }

    const withPhoto = items.filter((i) => i.image_url)
    const withoutPhoto = items.filter((i) => !i.image_url)

    let message = `📷 **Фотографии блюд**\n\n`
    message += `✅ С фото: ${withPhoto.length}\n`
    message += `📷 Без фото: ${withoutPhoto.length}\n\n`

    if (withoutPhoto.length === 0) {
      message += 'У всех блюд есть фотографии! 🎉\n\n'
      message += '_Нажмите на блюдо, чтобы заменить фото._'
    } else {
      message += 'Выберите блюдо, чтобы добавить фото:'
    }

    const keyboard = new InlineKeyboard()

    // Сначала блюда без фото
    for (const item of withoutPhoto) {
      keyboard.text(`📷 ${item.name}`, `photo:${item.id}`).row()
    }

    // Затем блюда с фото (для замены)
    if (withPhoto.length > 0 && withoutPhoto.length > 0) {
      keyboard.text('— С фото (заменить) —', 'noop').row()
    }
    for (const item of withPhoto) {
      keyboard.text(`✅ ${item.name}`, `photo:${item.id}`).row()
    }

    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    })
  })

  // Обработка фото
  bot.on('message:photo', async (ctx: Context) => {
    try {
      const chatId = ctx.chat?.id
      if (!chatId) {
        await ctx.reply('❌ Не удалось определить chat ID')
        return
      }

      // Если ожидаем фото для конкретного блюда — сохраняем как image_url
      const awaitedItemId = awaitingPhotoForItem.get(chatId)
      if (awaitedItemId !== undefined) {
        awaitingPhotoForItem.delete(chatId)

        const photos = ctx.message?.photo
        if (!photos || photos.length === 0) {
          await ctx.reply('❌ Фото не найдено. Попробуйте ещё раз.')
          return
        }

        const item = menuRepo.findById(awaitedItemId)
        if (!item) {
          await ctx.reply('❌ Блюдо не найдено.')
          return
        }

        await ctx.reply('⏳ Сохраняю фото...')

        const photo = photos[photos.length - 1]
        const file = await ctx.api.getFile(photo.file_id)
        const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`

        // Скачиваем и сохраняем файл
        const uploadsDir = config.uploadsPath
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true })
        }

        const ext = file.file_path?.split('.').pop() || 'jpg'
        const filename = `menu_${awaitedItemId}_${Date.now()}.${ext}`
        const filepath = path.join(uploadsDir, filename)

        const response = await fetch(fileUrl)
        if (!response.ok) {
          await ctx.reply('❌ Не удалось скачать фото из Telegram. Попробуйте ещё раз.')
          return
        }
        const buffer = Buffer.from(await response.arrayBuffer())
        fs.writeFileSync(filepath, buffer)

        // Удаляем старый файл, если был
        if (item.image_url) {
          const oldPath = path.join(config.uploadsPath, path.basename(item.image_url))
          if (fs.existsSync(oldPath)) {
            try { fs.unlinkSync(oldPath) } catch { /* ignore */ }
          }
        }

        const imageUrl = `/uploads/${filename}`
        menuRepo.updateItem(awaitedItemId, { image_url: imageUrl })

        await ctx.reply(
          `✅ Фото для «${item.name}» сохранено!\n\n` +
          `/photos — добавить фото к другим блюдам`
        )
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

      const restaurant = restaurantRepo.findByChatId(chatId)
      if (!restaurant) {
        await ctx.reply('❌ Ресторан не найден. Сначала отправьте /start и укажите название ресторана.')
        return
      }

      // Удаляем старое меню и связанные изображения (если есть) и сохраняем новое
      deleteAllItemImages(restaurant.id)
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
      message += '💡 Используйте /menu для просмотра меню по категориям\n'
      message += '📷 Используйте /photos чтобы добавить фотографии к блюдам'

      await ctx.reply(message, { parse_mode: 'Markdown' })
    } catch (error) {
      logger.error('Ошибка обработки фото', { error })
      await ctx.reply(
        `❌ Ошибка: ${error instanceof Error ? error.message : 'Неизвестная ошибка'}`
      )
    }
  })

  // Команда /menu - показать текущее меню
  bot.command('menu', async (ctx: Context) => {
    try {
      logger.info('Команда /menu получена')
      
      const chatId = ctx.chat?.id
      if (!chatId) {
        logger.warn('Chat ID не определён для /menu')
        await ctx.reply('❌ Не удалось определить chat ID')
        return
      }
      
      logger.debug('Команда /menu: chatId', { chatId })

      const restaurant = restaurantRepo.findByChatId(chatId)
      if (!restaurant) {
        logger.warn('Ресторан не найден для /menu', { chatId })
        await ctx.reply('❌ Ресторан не найден. Сначала отправьте /start и укажите название ресторана.')
        return
      }
      
      logger.debug('Ресторан найден для /menu', { restaurantId: restaurant.id, name: restaurant.name })

      const items = menuRepo.findByRestaurantId(restaurant.id)
      logger.debug('Найдено блюд для /menu', { count: items.length })
      
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
      let message = '📋 <b>Ваше меню</b>\n\n'
      
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
        message += `${emoji} <b>${escapeHtml(category)}</b> (${categoryItems.length})\n`
        
        for (const item of categoryItems) {
          const breakfastMark = item.is_breakfast ? ' 🌅' : ''
          message += `• ${escapeHtml(item.name)}${breakfastMark} — ${item.price}₽\n`
          if (item.description) {
            message += `  <i>${escapeHtml(item.description)}</i>\n`
          }
        }
        message += '\n'
      }

      message += `<i>Всего блюд: ${items.length}</i>\n`
      message += `<i>Завтраков: ${items.filter(i => i.is_breakfast).length}</i>`

      logger.debug('Отправка меню', { length: message.length })
      await ctx.reply(message, { parse_mode: 'HTML' })
      logger.info('Меню отправлено успешно')
    } catch (error) {
      logger.error('Ошибка в команде /menu', { error })
      await ctx.reply('❌ Произошла ошибка при формировании меню. Попробуйте ещё раз.')
    }
  })

  // Команда /categories - статистика по категориям
  bot.command('categories', async (ctx: Context) => {
    try {
      const chatId = ctx.chat?.id
      if (!chatId) {
        await ctx.reply('❌ Не удалось определить chat ID')
        return
      }

      const restaurant = restaurantRepo.findByChatId(chatId)
      if (!restaurant) {
        await ctx.reply('❌ Ресторан не найден. Сначала отправьте /start и укажите название ресторана.')
        return
      }

      const categories = menuRepo.getAllCategories(restaurant.id)
      if (categories.length === 0) {
        await ctx.reply('Меню пусто!')
        return
      }

      let message = '📊 <b>Статистика по категориям</b>\n\n'

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
        
        message += `${emoji} <b>${escapeHtml(category)}</b>\n`
        message += `   Блюд: ${items.length}\n`
        message += `   Средняя цена: ${avgPrice}₽\n\n`
      }

      const allItems = menuRepo.findByRestaurantId(restaurant.id)
      message += `<i>Всего категорий: ${categories.length}</i>\n`
      message += `<i>Всего блюд: ${allItems.length}</i>`

      await ctx.reply(message, { parse_mode: 'HTML' })
    } catch (error) {
      logger.error('Ошибка в команде /categories', { error })
      await ctx.reply('❌ Произошла ошибка при формировании статистики. Попробуйте ещё раз.')
    }
  })

  // Команда /breakfasts - показать только завтраки
  bot.command('breakfasts', async (ctx: Context) => {
    try {
      const chatId = ctx.chat?.id
      if (!chatId) {
        await ctx.reply('❌ Не удалось определить chat ID')
        return
      }

      const restaurant = restaurantRepo.findByChatId(chatId)
      if (!restaurant) {
        await ctx.reply('❌ Ресторан не найден. Сначала отправьте /start и укажите название ресторана.')
        return
      }

      const breakfasts = menuRepo.findBreakfastsByRestaurantId(restaurant.id)
      
      if (breakfasts.length === 0) {
        await ctx.reply('В меню нет завтраков 🤷')
        return
      }

      let message = '🌅 <b>Завтраки</b>\n\n'
      
      for (const item of breakfasts) {
        message += `• ${escapeHtml(item.name)} — ${item.price}₽\n`
        if (item.description) {
          message += `  <i>${escapeHtml(item.description)}</i>\n`
        }
        if (item.category) {
          message += `  📂 ${escapeHtml(item.category)}\n`
        }
        message += '\n'
      }

      const avgPrice = Math.round(breakfasts.reduce((sum, item) => sum + item.price, 0) / breakfasts.length)
      message += `<i>Всего завтраков: ${breakfasts.length}</i>\n`
      message += `<i>Средняя цена: ${avgPrice}₽</i>\n\n`
      message += '⏰ Рекомендуется доступность до 11:00'

      await ctx.reply(message, { parse_mode: 'HTML' })
    } catch (error) {
      logger.error('Ошибка в команде /breakfasts', { error })
      await ctx.reply('❌ Произошла ошибка при формировании списка завтраков. Попробуйте ещё раз.')
    }
  })

  // [ТЕСТ] Команда /wipe_orders - удалить все заказы в системе
  bot.command('wipe_orders', async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return

    const keyboard = new InlineKeyboard()
      .text('⚠️ ДА, УДАЛИТЬ ВСЕ ЗАКАЗЫ', 'confirm_wipe_orders')
      .text('❌ Отмена', 'cancel_wipe_orders')

    await ctx.reply(
      '🚨 <b>[ТЕСТ] ОПАСНО!</b>\n\n' +
      'Удалить ВСЕ заказы в системе:\n' +
      '• Индивидуальные заказы\n' +
      '• Заказы всех ресторанов и слотов\n\n' +
      'ℹ️ Балансы и транзакции кредитов затронуты не будут.\n\n' +
      '⚠️ <b>Использовать только в тестовой среде!</b>',
      { parse_mode: 'HTML', reply_markup: keyboard }
    )
  })

  // [ТЕСТ] Команда /wipeall - удалить абсолютно всё в базе
  bot.command('wipeall', async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return

    const keyboard = new InlineKeyboard()
      .text('⚠️ ДА, УДАЛИТЬ ВСЁ', 'confirm_wipeall')
      .text('❌ Отмена', 'cancel_wipeall')

    await ctx.reply(
      '🚨 <b>[ТЕСТ] ОПАСНО!</b>\n\n' +
      'Удалить ВСЕ данные в базе:\n' +
      '• Все рестораны, меню, заказы\n' +
      '• Всех пользователей, здания\n' +
      '• Кредиты, черновики\n\n' +
      '⚠️ <b>Необратимо!</b>',
      { parse_mode: 'HTML', reply_markup: keyboard }
    )
  })

  // Команда /payment — настройка ссылки для оплаты по СБП
  bot.command('payment', async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return

    const restaurant = restaurantRepo.findByChatId(chatId)
    if (!restaurant) {
      await ctx.reply('❌ Ресторан не найден. Сначала отправьте /start и укажите название ресторана.')
      return
    }

    const currentLink = restaurant.sbp_link
    let message = '💳 **Оплата по СБП**\n\n'

    if (currentLink) {
      message += `Текущая ссылка:\n${currentLink}\n\n`
      message += 'Отправьте новую ссылку, чтобы заменить текущую.\n'
    } else {
      message += 'Ссылка для оплаты не настроена.\n\n'
      message += 'Отправьте ссылку на оплату по СБП (начинается с https://).\n'
      message += 'Эта ссылка будет использоваться клиентами для оплаты заказов.\n'
    }

    message += '\n_Для отмены отправьте /cancel_'

    awaitingSbpLink.add(chatId)

    await ctx.reply(message, { parse_mode: 'Markdown' })
  })

  // Команда /clearall - удалить все данные ТЕКУЩЕГО ресторана
  bot.command('clearall', async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) {
      await ctx.reply('❌ Не удалось определить chat ID')
      return
    }

    const restaurant = restaurantRepo.findByChatId(chatId)
    if (!restaurant) {
      await ctx.reply('❌ Ресторан не найден. Сначала отправьте /start и укажите название ресторана.')
      return
    }

    const keyboard = new InlineKeyboard()
      .text('⚠️ ДА, УДАЛИТЬ', 'confirm_clearall')
      .text('❌ Отмена', 'cancel_clearall')

    await ctx.reply(
      `🚨 <b>ВНИМАНИЕ!</b>\n\n` +
      `Вы собираетесь удалить все данные ресторана «${restaurant.name}»:\n` +
      '• Все блюда из меню\n' +
      '• Все заказы\n' +
      '• Связи со зданиями\n' +
      '• Черновики заказов клиентов\n\n' +
      '⚠️ <b>Это действие НЕОБРАТИМО!</b>\n\n' +
      'Данные других ресторанов не затрагиваются.\n\n' +
      'Вы уверены?',
      {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      }
    )
  })

  // Обработка текстовых сообщений для диалогов
  bot.on('message:text', async (ctx: Context, next: () => Promise<void>) => {
    const chatId = ctx.chat?.id
    const text = ctx.message?.text

    if (!chatId || !text) return

    // Команды (/start, /help и др.) передаём command-обработчикам
    const isCommand = ctx.message?.entities?.some((e) => e.type === 'bot_command') ?? text.startsWith('/')
    if (isCommand) {
      await next()
      return
    }

    // Ожидание названия ресторана при первом /start
    if (awaitingRestaurantName.has(chatId)) {
      const name = text.trim()
      if (name.length === 0 || name.length > 100) {
        await ctx.reply('Введите короткое название ресторана (до 100 символов).')
        return
      }
      awaitingRestaurantName.delete(chatId)
      restaurantRepo.findOrCreateByChatId(chatId, name)
      await ctx.reply(`✅ Ресторан «${name}» создан!\n\n` + getHelpText(), {
        parse_mode: 'Markdown',
        reply_markup: getMainKeyboard(),
      })
      return
    }

    // Ожидание ссылки СБП
    if (awaitingSbpLink.has(chatId)) {
      const link = text.trim()
      if (!link.startsWith('https://')) {
        await ctx.reply('❌ Ссылка должна начинаться с https://\n\nПопробуйте ещё раз или отправьте /cancel')
        return
      }
      awaitingSbpLink.delete(chatId)
      const restaurant = restaurantRepo.findByChatId(chatId)
      if (!restaurant) {
        await ctx.reply('❌ Ресторан не найден.')
        return
      }
      restaurantRepo.updateSbpLink(restaurant.id, link)
      await ctx.reply(
        `✅ Ссылка СБП сохранена!\n\n` +
        `💳 ${link}\n\n` +
        `Клиенты будут использовать эту ссылку для оплаты заказов.`
      )
      return
    }

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
      logger.error('Ошибка обработки диалога', { error })
      await ctx.reply('❌ Произошла ошибка. Попробуйте снова с /add')
      userStates.delete(chatId)
    }
  })

  return bot
}
