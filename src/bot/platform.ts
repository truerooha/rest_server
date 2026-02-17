import { Bot, Context } from 'grammy'
import Database from 'better-sqlite3'
import {
  BuildingRepository,
  RestaurantRepository,
  RestaurantBuildingRepository,
  UserRepository,
  RestaurantAdminRepository,
} from '../db/repository'
import { logger } from '../utils/logger'

export function createPlatformBot(
  token: string,
  db: Database.Database,
  allowedAdminIds: number[],
) {
  const bot = new Bot(token)
  const buildingRepo = new BuildingRepository(db)
  const restaurantRepo = new RestaurantRepository(db)
  const rbRepo = new RestaurantBuildingRepository(db)
  const userRepo = new UserRepository(db)
  const adminRepo = new RestaurantAdminRepository(db)

  // Track conversation states for /add_building
  const awaitingBuildingName = new Set<number>()
  const awaitingBuildingAddress = new Map<number, string>() // chatId → name

  // Access middleware
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id
    if (!userId || !allowedAdminIds.includes(userId)) {
      await ctx.reply('Доступ запрещён.')
      return
    }
    await next()
  })

  function getHelpText(): string {
    return [
      '🏢 Платформа «Обед в Офис» — управление',
      '',
      '📋 Здания:',
      '/buildings — список зданий с invite-кодами',
      '/add_building — добавить здание',
      '/regen_code <id> — перегенерировать invite-код',
      '',
      '🍽 Рестораны:',
      '/restaurants — список ресторанов',
      '/grant <restaurant_id> <telegram_user_id> — дать доступ к ресторану',
      '/revoke <restaurant_id> <telegram_user_id> — забрать доступ',
      '/link <restaurant_id> <building_id> — привязать ресторан к зданию',
      '/unlink <restaurant_id> <building_id> — отвязать',
      '',
      '👥 Пользователи:',
      '/users — список пользователей',
      '/approve <telegram_user_id> — одобрить пользователя',
      '/block <telegram_user_id> — заблокировать пользователя',
    ].join('\n')
  }

  bot.command('start', async (ctx) => {
    await ctx.reply(getHelpText())
  })

  bot.command('help', async (ctx) => {
    await ctx.reply(getHelpText())
  })

  // /buildings
  bot.command('buildings', async (ctx) => {
    const buildings = buildingRepo.findAll()
    if (buildings.length === 0) {
      await ctx.reply('Зданий пока нет. Используйте /add_building')
      return
    }
    const lines = buildings.map((b) => {
      const users = userRepo.findApprovedByBuildingId(b.id)
      const code = b.invite_code ?? '—'
      const active = b.invite_code_active ? '✅' : '❌'
      return `#${b.id} ${b.name}\n   📍 ${b.address}\n   🔑 ${code} ${active} | 👥 ${users.length} чел.`
    })
    await ctx.reply(lines.join('\n\n'))
  })

  // /add_building
  bot.command('add_building', async (ctx) => {
    awaitingBuildingName.add(ctx.chat.id)
    awaitingBuildingAddress.delete(ctx.chat.id)
    await ctx.reply('Введите название здания:')
  })

  // /regen_code <id>
  bot.command('regen_code', async (ctx) => {
    const idStr = ctx.match?.trim()
    if (!idStr) {
      await ctx.reply('Использование: /regen_code <building_id>')
      return
    }
    const id = parseInt(idStr, 10)
    const building = buildingRepo.findById(id)
    if (!building) {
      await ctx.reply(`Здание #${id} не найдено`)
      return
    }
    const newCode = buildingRepo.regenerateInviteCode(id)
    await ctx.reply(`Новый invite-код для «${building.name}»: ${newCode}`)
  })

  // /restaurants
  bot.command('restaurants', async (ctx) => {
    const rows = db.prepare('SELECT * FROM restaurants ORDER BY name').all() as Array<{
      id: number
      name: string
      chat_id: number
    }>
    if (rows.length === 0) {
      await ctx.reply('Ресторанов пока нет.')
      return
    }
    const lines = rows.map((r) => {
      const admins = adminRepo.findByRestaurantId(r.id)
      const buildings = rbRepo.findBuildingsByRestaurantId(r.id)
      const buildingNames = buildings.map((b) => b.name).join(', ') || '—'
      return `#${r.id} ${r.name}\n   👤 Админов: ${admins.length} | 🏢 ${buildingNames}`
    })
    await ctx.reply(lines.join('\n\n'))
  })

  // /grant <restaurant_id> <telegram_user_id>
  bot.command('grant', async (ctx) => {
    const parts = ctx.match?.trim().split(/\s+/)
    if (!parts || parts.length < 2) {
      await ctx.reply('Использование: /grant <restaurant_id> <telegram_user_id>')
      return
    }
    const restaurantId = parseInt(parts[0], 10)
    const telegramUserId = parseInt(parts[1], 10)
    const restaurant = restaurantRepo.findById(restaurantId)
    if (!restaurant) {
      await ctx.reply(`Ресторан #${restaurantId} не найден`)
      return
    }
    adminRepo.grant(restaurantId, telegramUserId, 'admin', ctx.from?.id)
    await ctx.reply(`✅ Пользователь ${telegramUserId} добавлен как админ ресторана «${restaurant.name}»`)
  })

  // /revoke <restaurant_id> <telegram_user_id>
  bot.command('revoke', async (ctx) => {
    const parts = ctx.match?.trim().split(/\s+/)
    if (!parts || parts.length < 2) {
      await ctx.reply('Использование: /revoke <restaurant_id> <telegram_user_id>')
      return
    }
    const restaurantId = parseInt(parts[0], 10)
    const telegramUserId = parseInt(parts[1], 10)
    const removed = adminRepo.revoke(restaurantId, telegramUserId)
    if (removed) {
      await ctx.reply(`✅ Доступ пользователя ${telegramUserId} к ресторану #${restaurantId} отозван`)
    } else {
      await ctx.reply(`Запись не найдена`)
    }
  })

  // /link <restaurant_id> <building_id>
  bot.command('link', async (ctx) => {
    const parts = ctx.match?.trim().split(/\s+/)
    if (!parts || parts.length < 2) {
      await ctx.reply('Использование: /link <restaurant_id> <building_id>')
      return
    }
    const restaurantId = parseInt(parts[0], 10)
    const buildingId = parseInt(parts[1], 10)
    try {
      rbRepo.link(restaurantId, buildingId)
      await ctx.reply(`✅ Ресторан #${restaurantId} привязан к зданию #${buildingId}`)
    } catch {
      await ctx.reply('Ошибка привязки. Проверьте ID.')
    }
  })

  // /unlink <restaurant_id> <building_id>
  bot.command('unlink', async (ctx) => {
    const parts = ctx.match?.trim().split(/\s+/)
    if (!parts || parts.length < 2) {
      await ctx.reply('Использование: /unlink <restaurant_id> <building_id>')
      return
    }
    const restaurantId = parseInt(parts[0], 10)
    const buildingId = parseInt(parts[1], 10)
    rbRepo.unlink(restaurantId, buildingId)
    await ctx.reply(`✅ Ресторан #${restaurantId} отвязан от здания #${buildingId}`)
  })

  // /users
  bot.command('users', async (ctx) => {
    const users = userRepo.findAll()
    if (users.length === 0) {
      await ctx.reply('Пользователей пока нет.')
      return
    }
    const lines = users.slice(0, 50).map((u) => {
      const name = u.first_name || u.username || String(u.telegram_user_id)
      const status = u.is_approved ? '✅' : '❌'
      const bld = u.building_id ? `🏢#${u.building_id}` : '—'
      return `${status} ${name} (tg:${u.telegram_user_id}) ${bld}`
    })
    if (users.length > 50) {
      lines.push(`\n... и ещё ${users.length - 50}`)
    }
    await ctx.reply(lines.join('\n'))
  })

  // /approve <telegram_user_id>
  bot.command('approve', async (ctx) => {
    const idStr = ctx.match?.trim()
    if (!idStr) {
      await ctx.reply('Использование: /approve <telegram_user_id>')
      return
    }
    const telegramUserId = parseInt(idStr, 10)
    const user = userRepo.findByTelegramId(telegramUserId)
    if (!user) {
      await ctx.reply(`Пользователь с telegram_user_id ${telegramUserId} не найден`)
      return
    }
    userRepo.approve(telegramUserId)
    await ctx.reply(`✅ Пользователь ${user.first_name || telegramUserId} одобрен`)
  })

  // /block <telegram_user_id>
  bot.command('block', async (ctx) => {
    const idStr = ctx.match?.trim()
    if (!idStr) {
      await ctx.reply('Использование: /block <telegram_user_id>')
      return
    }
    const telegramUserId = parseInt(idStr, 10)
    const user = userRepo.findByTelegramId(telegramUserId)
    if (!user) {
      await ctx.reply(`Пользователь с telegram_user_id ${telegramUserId} не найден`)
      return
    }
    userRepo.block(telegramUserId)
    await ctx.reply(`❌ Пользователь ${user.first_name || telegramUserId} заблокирован`)
  })

  // Handle text for /add_building conversation
  bot.on('message:text', async (ctx) => {
    const chatId = ctx.chat.id
    const text = ctx.message.text.trim()

    // Step 1: awaiting building name
    if (awaitingBuildingName.has(chatId)) {
      awaitingBuildingName.delete(chatId)
      awaitingBuildingAddress.set(chatId, text)
      await ctx.reply(`Название: «${text}»\nТеперь введите адрес:`)
      return
    }

    // Step 2: awaiting building address
    if (awaitingBuildingAddress.has(chatId)) {
      const name = awaitingBuildingAddress.get(chatId)!
      awaitingBuildingAddress.delete(chatId)
      const building = buildingRepo.create({ name, address: text })
      const code = buildingRepo.regenerateInviteCode(building.id)
      await ctx.reply(
        `✅ Здание создано:\n` +
        `Название: ${building.name}\n` +
        `Адрес: ${text}\n` +
        `Invite-код: ${code}`,
      )
      return
    }
  })

  return bot
}
