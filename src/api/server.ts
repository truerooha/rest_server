import express, { Express, Request, Response, NextFunction } from 'express'
import cors from 'cors'
import Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import {
  BuildingRepository,
  UserRepository,
  RestaurantRepository,
  MenuRepository,
  RestaurantBuildingRepository,
  OrderRepository,
  LobbyRepository,
} from '../db/repository'
import { DraftRepository } from '../db/repository-drafts'
import { ORDER_CONFIG } from '../utils/order-config'
import { logger } from '../utils/logger'
import { config } from '../utils/config'
import { getAppTimezoneId, getNowMinutesInAppTz, getTodayInAppTz } from '../utils/timezone'

export interface ApiContext {
  db: Database.Database
  repos: {
    building: BuildingRepository
    user: UserRepository
    restaurant: RestaurantRepository
    menu: MenuRepository
    restaurantBuilding: RestaurantBuildingRepository
    order: OrderRepository
    draft: DraftRepository
    lobby: LobbyRepository
  }
}

const DraftItemSchema = z.object({
  menu_item_id: z.number().int().positive(),
  name: z.string().min(1),
  price: z.number().nonnegative(),
  quantity: z.number().int().positive(),
})

const DraftPayloadSchema = z.object({
  telegram_user_id: z.number().int(),
  delivery_slot: z.string().min(1).nullable().optional(),
  restaurant_id: z.number().int().positive().nullable().optional(),
  building_id: z.number().int().positive().nullable().optional(),
  items: z.array(DraftItemSchema),
})

const getRequestId = (res: Response): string => {
  const locals = res.locals as { requestId?: string }
  return locals.requestId ?? 'unknown'
}

const logApiError = (res: Response, message: string, error: unknown): void => {
  logger.error(message, { requestId: getRequestId(res), error })
}

/**
 * Создаёт Express API сервер
 */
export function createApiServer(db: Database.Database): Express {
  const app = express()

  // Middleware
  app.use((req, res, next) => {
    const requestId = randomUUID()
    res.locals = { ...res.locals, requestId }
    res.setHeader('x-request-id', requestId)

    const start = process.hrtime.bigint()
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6
      const status = res.statusCode
      const logFn = status >= 500 ? logger.error : status >= 400 ? logger.warn : logger.info
      logFn('HTTP запрос завершен', {
        requestId,
        method: req.method,
        path: req.originalUrl || req.url,
        status,
        durationMs: Math.round(durationMs),
        ip: req.ip,
        userAgent: req.get('user-agent'),
      })
    })
    next()
  })
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) {
          callback(null, true)
          return
        }

        if (config.corsAllowedOrigins.length === 0) {
          callback(null, true)
          return
        }

        if (config.corsAllowedOrigins.includes(origin)) {
          callback(null, true)
          return
        }

        logger.warn('CORS: origin запрещен', { origin })
        callback(new Error('Not allowed by CORS'))
      },
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }),
  )
  app.use(express.json())

  // Раздача загруженных изображений блюд
  app.use('/uploads', express.static(config.uploadsPath))

  // Создаём репозитории
  const context: ApiContext = {
    db,
    repos: {
      building: new BuildingRepository(db),
      user: new UserRepository(db),
      restaurant: new RestaurantRepository(db),
      menu: new MenuRepository(db),
      restaurantBuilding: new RestaurantBuildingRepository(db),
      order: new OrderRepository(db),
      draft: new DraftRepository(db),
      lobby: new LobbyRepository(db),
    },
  }

  const findRestaurantWithMenu = () => {
    const row = db
      .prepare(
        `
          SELECT restaurant_id as id, COUNT(*) as item_count
          FROM menu_items
          WHERE is_available = 1
          GROUP BY restaurant_id
          ORDER BY item_count DESC
          LIMIT 1
        `,
      )
      .get() as { id: number; item_count: number } | undefined

    if (!row) {
      return null
    }

    const restaurant = db
      .prepare('SELECT * FROM restaurants WHERE id = ?')
      .get(row.id) as any | undefined

    return restaurant ?? null
  }

  // Health check
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() })
  })

  // GET /api/config - конфигурация приложения (часовой пояс и т.д.)
  app.get('/api/config', (_req: Request, res: Response) => {
    res.json({ success: true, data: { timezone: getAppTimezoneId() } })
  })

  // GET /api/delivery-slots - получить доступные слоты доставки
  // Query: buildingId, restaurantId, telegram_user_id (опционально) — при наличии возвращает поля лобби
  app.get('/api/delivery-slots', (req: Request, res: Response) => {
    try {
      const nowMinutes = getNowMinutesInAppTz()
      const orderDate = getTodayInAppTz()
      const buildingId = req.query.buildingId ? parseInt(String(req.query.buildingId)) : null
      const restaurantId = req.query.restaurantId ? parseInt(String(req.query.restaurantId)) : null
      const telegramUserId = req.query.telegram_user_id
        ? parseInt(String(req.query.telegram_user_id))
        : null
      const withLobby = buildingId != null && restaurantId != null && telegramUserId != null

      const toMinutes = (time: string) => {
        const [hours, minutes] = time.split(':').map(Number)
        return hours * 60 + minutes
      }

      const toTime = (minutesTotal: number) => {
        const hours = Math.floor(minutesTotal / 60)
        const minutes = minutesTotal % 60
        const hoursLabel = String(hours).padStart(2, '0')
        const minutesLabel = String(minutes).padStart(2, '0')
        return `${hoursLabel}:${minutesLabel}`
      }

      const lobbyLeadMinutes = ORDER_CONFIG.lobbyLeadMinutes ?? ORDER_CONFIG.orderLeadMinutes
      const minParticipants = ORDER_CONFIG.minLobbyParticipants ?? 1
      const deliveryPriceWhenNotFull = ORDER_CONFIG.deliveryPriceCentsWhenNotFull ?? 0

      const slots = ORDER_CONFIG.deliverySlots.map((slot) => {
        const slotMinutes = toMinutes(slot.time)
        const deadlineMinutes = Math.max(
          slotMinutes - ORDER_CONFIG.orderLeadMinutes,
          0,
        )
        const lobbyDeadlineMinutes = Math.max(slotMinutes - lobbyLeadMinutes, 0)
        const deadline = toTime(deadlineMinutes)
        const lobbyDeadline = toTime(lobbyDeadlineMinutes)
        const isAvailable = nowMinutes <= deadlineMinutes

        const base = {
          id: slot.id,
          time: slot.time,
          deadline,
          isAvailable,
        }

        if (!withLobby || buildingId == null || restaurantId == null || telegramUserId == null) {
          return base
        }

        const currentParticipants = context.repos.lobby.countReservations(
          buildingId,
          restaurantId,
          slot.id,
          orderDate,
        )
        const isActivated = currentParticipants >= minParticipants
        const deliveryPriceCents = isActivated ? 0 : deliveryPriceWhenNotFull
        const userInLobby = context.repos.lobby.hasUserReservation(
          telegramUserId,
          buildingId,
          restaurantId,
          slot.id,
          orderDate,
        )

        return {
          ...base,
          lobbyDeadline,
          minParticipants,
          currentParticipants,
          deliveryPriceCents,
          isActivated,
          userInLobby,
        }
      })

      res.json({ success: true, data: slots })
    } catch (error) {
      logApiError(res, 'Error fetching delivery slots', error)
      res.status(500).json({ success: false, error: 'Failed to fetch delivery slots' })
    }
  })

  const lobbyJoinSchema = z.object({
    telegram_user_id: z.number().int(),
    building_id: z.number().int().positive(),
    restaurant_id: z.number().int().positive(),
    delivery_slot: z.string().min(1),
  })

  // POST /api/lobby/join - присоединиться к лобби слота
  app.post('/api/lobby/join', (req: Request, res: Response) => {
    try {
      const parsed = lobbyJoinSchema.safeParse(req.body)
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: 'Invalid request body' })
      }
      const { telegram_user_id, building_id, restaurant_id, delivery_slot } = parsed.data
      const orderDate = getTodayInAppTz()
      const nowMinutes = getNowMinutesInAppTz()

      const toMinutes = (time: string) => {
        const [hours, minutes] = time.split(':').map(Number)
        return hours * 60 + minutes
      }
      const lobbyLeadMinutes = ORDER_CONFIG.lobbyLeadMinutes ?? ORDER_CONFIG.orderLeadMinutes
      const slotMinutes = toMinutes(delivery_slot)
      const lobbyDeadlineMinutes = Math.max(slotMinutes - lobbyLeadMinutes, 0)
      if (nowMinutes > lobbyDeadlineMinutes) {
        return res.status(400).json({
          success: false,
          error: 'Lobby deadline has passed',
        })
      }

      const user = context.repos.user.findByTelegramId(telegram_user_id)
      if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' })
      }

      context.repos.lobby.addReservation(
        building_id,
        restaurant_id,
        delivery_slot,
        orderDate,
        user.id,
      )
      res.json({ success: true })
    } catch (error) {
      logApiError(res, 'Error joining lobby', error)
      res.status(500).json({ success: false, error: 'Failed to join lobby' })
    }
  })

  // POST /api/lobby/leave - выйти из лобби слота
  app.post('/api/lobby/leave', (req: Request, res: Response) => {
    try {
      const parsed = lobbyJoinSchema.safeParse(req.body)
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: 'Invalid request body' })
      }
      const { telegram_user_id, building_id, restaurant_id, delivery_slot } = parsed.data
      const orderDate = getTodayInAppTz()

      const user = context.repos.user.findByTelegramId(telegram_user_id)
      if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' })
      }

      context.repos.lobby.removeReservation(
        building_id,
        restaurant_id,
        delivery_slot,
        orderDate,
        user.id,
      )
      res.json({ success: true })
    } catch (error) {
      logApiError(res, 'Error leaving lobby', error)
      res.status(500).json({ success: false, error: 'Failed to leave lobby' })
    }
  })

  // Инициализация/починка дефолтных данных
  app.post('/api/init-default-data', async (_req: Request, res: Response) => {
    try {
      // Проверяем, есть ли уже данные
      const buildings = context.repos.building.findAll()
      const coworkingExists = buildings.find((b) => b.name === 'Коворкинг')

      // Гарантируем существование здания "Коворкинг"
      const coworkingBuilding =
        coworkingExists ??
        context.repos.building.create({
          name: 'Коворкинг',
          address: 'Дефолтный адрес коворкинга',
        })

      // Находим ресторан с меню (если есть), иначе берём первый
      const restaurants = db.prepare('SELECT * FROM restaurants').all() as any[]
      let restaurant: any

      if (restaurants.length === 0) {
        // Создаём дефолтный ресторан если нет ни одного
        const result = context.repos.restaurant.create({
          name: 'Фудкорнер',
          chat_id: 123456789, // Dummy chat ID
        })
        restaurant = result
      } else {
        const withMenu = findRestaurantWithMenu()
        restaurant = withMenu ?? restaurants[0]
        if (!withMenu && restaurant.name !== 'Фудкорнер') {
          db.prepare('UPDATE restaurants SET name = ? WHERE id = ?').run('Фудкорнер', restaurant.id)
        }
      }

      // Связываем ресторан со зданием
      const existingLink = db
        .prepare('SELECT * FROM restaurant_buildings WHERE restaurant_id = ? AND building_id = ?')
        .get(restaurant.id, coworkingBuilding.id)

      if (!existingLink) {
        context.repos.restaurantBuilding.link(restaurant.id, coworkingBuilding.id)
      }

      res.json({
        success: true,
        message: 'Дефолтные данные успешно созданы',
        data: {
          building: coworkingBuilding,
          restaurant: { id: restaurant.id, name: restaurant.name },
        },
      })
    } catch (error) {
      logApiError(res, 'Error initializing default data', error)
      res.status(500).json({ success: false, error: 'Failed to initialize default data' })
    }
  })

  // === BUILDINGS ENDPOINTS ===

  // GET /api/buildings - получить список зданий
  app.get('/api/buildings', (_req: Request, res: Response) => {
    try {
      const buildings = context.repos.building.findAll()
      res.json({ success: true, data: buildings })
    } catch (error) {
      logApiError(res, 'Error fetching buildings', error)
      res.status(500).json({ success: false, error: 'Failed to fetch buildings' })
    }
  })

  // GET /api/buildings/:id - получить здание по ID
  app.get('/api/buildings/:id', (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id))
      const building = context.repos.building.findById(id)

      if (!building) {
        return res.status(404).json({ success: false, error: 'Building not found' })
      }

      res.json({ success: true, data: building })
    } catch (error) {
      logApiError(res, 'Error fetching building', error)
      res.status(500).json({ success: false, error: 'Failed to fetch building' })
    }
  })

  // === RESTAURANTS ENDPOINTS ===

  // GET /api/restaurants?buildingId=1 - получить рестораны по зданию
  app.get('/api/restaurants', (req: Request, res: Response) => {
    try {
      const buildingId = req.query.buildingId ? parseInt(String(req.query.buildingId)) : null

      if (buildingId) {
        const restaurants = context.repos.restaurantBuilding.findRestaurantsByBuildingId(buildingId)
        if (restaurants.length === 0) {
          const fallbackRestaurant = findRestaurantWithMenu()
          if (fallbackRestaurant) {
            const existingLink = db
              .prepare('SELECT * FROM restaurant_buildings WHERE restaurant_id = ? AND building_id = ?')
              .get(fallbackRestaurant.id, buildingId)
            if (!existingLink) {
              context.repos.restaurantBuilding.link(fallbackRestaurant.id, buildingId)
            }
            res.json({ success: true, data: [fallbackRestaurant] })
            return
          }
        }
        res.json({ success: true, data: restaurants })
      } else {
        res.status(400).json({ success: false, error: 'buildingId parameter is required' })
      }
    } catch (error) {
      logApiError(res, 'Error fetching restaurants', error)
      res.status(500).json({ success: false, error: 'Failed to fetch restaurants' })
    }
  })

  // GET /api/restaurants/:id - получить ресторан по ID
  app.get('/api/restaurants/:id', (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id))
      const restaurant = context.repos.restaurant.findById(id)

      if (!restaurant) {
        return res.status(404).json({ success: false, error: 'Restaurant not found' })
      }

      res.json({ success: true, data: restaurant })
    } catch (error) {
      logApiError(res, 'Error fetching restaurant', error)
      res.status(500).json({ success: false, error: 'Failed to fetch restaurant' })
    }
  })

  // === MENU ENDPOINTS ===

  // GET /api/menu/:restaurantId - получить меню ресторана
  app.get('/api/menu/:restaurantId', (req: Request, res: Response) => {
    try {
      const restaurantId = parseInt(String(req.params.restaurantId))
      
      // Получаем только доступные блюда
      const items = context.repos.menu.findAvailableByRestaurantId(restaurantId)

      // Группируем по категориям
      const grouped = items.reduce((acc, item) => {
        const category = item.category || 'Другое'
        if (!acc[category]) {
          acc[category] = []
        }
        acc[category].push(item)
        return acc
      }, {} as Record<string, typeof items>)

      res.json({
        success: true,
        data: {
          items,
          grouped,
        },
      })
    } catch (error) {
      logApiError(res, 'Error fetching menu', error)
      res.status(500).json({ success: false, error: 'Failed to fetch menu' })
    }
  })

  // === USER ENDPOINTS ===

  // GET /api/user/:telegramId - получить или создать пользователя
  app.get('/api/user/:telegramId', (req: Request, res: Response) => {
    try {
      const telegramId = parseInt(String(req.params.telegramId))
      const user = context.repos.user.findByTelegramId(telegramId)

      if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' })
      }

      res.json({ success: true, data: user })
    } catch (error) {
      logApiError(res, 'Error fetching user', error)
      res.status(500).json({ success: false, error: 'Failed to fetch user' })
    }
  })

  // POST /api/user - создать или обновить пользователя
  app.post('/api/user', (req: Request, res: Response) => {
    try {
      const { telegram_user_id, username, first_name, last_name, building_id } = req.body

      if (!telegram_user_id) {
        return res.status(400).json({ success: false, error: 'telegram_user_id is required' })
      }

      const user = context.repos.user.findOrCreate({
        telegram_user_id,
        username,
        first_name,
        last_name,
        building_id,
      })

      res.json({ success: true, data: user })
    } catch (error) {
      logApiError(res, 'Error creating/updating user', error)
      res.status(500).json({ success: false, error: 'Failed to create/update user' })
    }
  })

  // PUT /api/user/:telegramId/building - обновить здание пользователя
  app.put('/api/user/:telegramId/building', (req: Request, res: Response) => {
    try {
      const telegramId = parseInt(String(req.params.telegramId))
      const { building_id } = req.body

      if (!building_id) {
        return res.status(400).json({ success: false, error: 'building_id is required' })
      }

      context.repos.user.updateBuilding(telegramId, building_id)
      const user = context.repos.user.findByTelegramId(telegramId)

      res.json({ success: true, data: user })
    } catch (error) {
      logApiError(res, 'Error updating user building', error)
      res.status(500).json({ success: false, error: 'Failed to update user building' })
    }
  })

  // === DRAFT ENDPOINTS ===

  // GET /api/draft?telegram_user_id=123 - получить черновик заказа
  app.get('/api/draft', (req: Request, res: Response) => {
    try {
      const telegramUserId = req.query.telegram_user_id
        ? parseInt(String(req.query.telegram_user_id))
        : NaN
      if (!Number.isFinite(telegramUserId)) {
        return res.status(400).json({ success: false, error: 'telegram_user_id is required' })
      }
      const draft = context.repos.draft.findByTelegramId(telegramUserId)
      if (!draft) {
        return res.json({ success: true, data: null })
      }
      res.json({
        success: true,
        data: {
          ...draft,
          items: JSON.parse(draft.items),
        },
      })
    } catch (error) {
      logApiError(res, 'Error fetching draft', error)
      res.status(500).json({ success: false, error: 'Failed to fetch draft' })
    }
  })

  // PUT /api/draft - сохранить черновик (upsert по telegram_user_id)
  app.put('/api/draft', (req: Request, res: Response) => {
    try {
      const parsed = DraftPayloadSchema.safeParse(req.body)
      if (!parsed.success) {
        logger.warn('Draft validation failed', { issues: parsed.error.issues })
        return res.status(400).json({ success: false, error: 'Invalid draft payload' })
      }

      const { telegram_user_id, delivery_slot, restaurant_id, building_id, items } = parsed.data

      const draft = context.repos.draft.put({
        telegram_user_id,
        delivery_slot: delivery_slot ?? null,
        restaurant_id: restaurant_id ?? null,
        building_id: building_id ?? null,
        items: JSON.stringify(items),
      })
      res.json({
        success: true,
        data: {
          ...draft,
          items,
        },
      })
    } catch (error) {
      logApiError(res, 'Error saving draft', error)
      res.status(500).json({ success: false, error: 'Failed to save draft' })
    }
  })

  // DELETE /api/draft?telegram_user_id=123 - удалить черновик
  app.delete('/api/draft', (req: Request, res: Response) => {
    try {
      const telegramUserId = req.query.telegram_user_id
        ? parseInt(String(req.query.telegram_user_id))
        : NaN
      if (!Number.isFinite(telegramUserId)) {
        return res.status(400).json({ success: false, error: 'telegram_user_id is required' })
      }
      context.repos.draft.delete(telegramUserId)
      res.json({ success: true })
    } catch (error) {
      logApiError(res, 'Error deleting draft', error)
      res.status(500).json({ success: false, error: 'Failed to delete draft' })
    }
  })

  // === ORDERS ENDPOINTS ===

  // GET /api/orders/:userId - получить заказы пользователя
  app.get('/api/orders/:userId', (req: Request, res: Response) => {
    try {
      const userId = parseInt(String(req.params.userId))
      const orders = context.repos.order.findByUserId(userId)

      // Парсим items из JSON строки
      const parsedOrders = orders.map((order) => ({
        ...order,
        items: JSON.parse(order.items),
      }))

      res.json({ success: true, data: parsedOrders })
    } catch (error) {
      logApiError(res, 'Error fetching orders', error)
      res.status(500).json({ success: false, error: 'Failed to fetch orders' })
    }
  })

  // GET /api/users/by-telegram/:telegramId/order-slots - слоты, где у пользователя есть заказ (для выбора на главной)
  app.get('/api/users/by-telegram/:telegramId/order-slots', (req: Request, res: Response) => {
    try {
      const telegramId = parseInt(String(req.params.telegramId))
      const buildingId = req.query.buildingId ? parseInt(String(req.query.buildingId)) : null
      const restaurantId = req.query.restaurantId ? parseInt(String(req.query.restaurantId)) : null

      if (!Number.isFinite(telegramId) || !buildingId || !restaurantId) {
        return res.status(400).json({
          success: false,
          error: 'telegramId, buildingId, and restaurantId are required',
        })
      }

      const user = context.repos.user.findByTelegramId(telegramId)
      if (!user) {
        return res.json({ success: true, data: [] })
      }

      const orderDate = getTodayInAppTz()
      const slotIds = context.repos.order.findUserOrderSlotsByBuildingRestaurant(
        user.id,
        buildingId,
        restaurantId,
        orderDate,
      )

      res.json({ success: true, data: slotIds })
    } catch (error) {
      logApiError(res, 'Error fetching user order slots', error)
      res.status(500).json({ success: false, error: 'Failed to fetch order slots' })
    }
  })

  // GET /api/users/by-telegram/:telegramId/active-order - активный заказ пользователя (по telegram_user_id)
  app.get('/api/users/by-telegram/:telegramId/active-order', (req: Request, res: Response) => {
    try {
      const telegramId = parseInt(String(req.params.telegramId))
      const deliverySlot = String(req.query.deliverySlot || '')
      const buildingId = req.query.buildingId ? parseInt(String(req.query.buildingId)) : null
      const restaurantId = req.query.restaurantId ? parseInt(String(req.query.restaurantId)) : null

      if (!Number.isFinite(telegramId) || !deliverySlot || !buildingId || !restaurantId) {
        return res.status(400).json({
          success: false,
          error: 'telegramId, deliverySlot, buildingId, and restaurantId are required',
        })
      }

      const user = context.repos.user.findByTelegramId(telegramId)
      if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' })
      }

      const orderDate = getTodayInAppTz()
      const order = context.repos.order.findActiveByUserAndSlot(
        user.id,
        buildingId,
        restaurantId,
        deliverySlot,
        orderDate,
      )

      if (!order) {
        return res.json({ success: true, data: null })
      }

      const parsed = {
        ...order,
        items: JSON.parse(order.items),
      }

      res.json({ success: true, data: parsed })
    } catch (error) {
      logApiError(res, 'Error fetching active order by telegram id', error)
      res.status(500).json({ success: false, error: 'Failed to fetch active order' })
    }
  })

  // GET /api/users/:userId/active-order - получить активный заказ пользователя для слота/здания/ресторана
  app.get('/api/users/:userId/active-order', (req: Request, res: Response) => {
    try {
      const userId = parseInt(String(req.params.userId))
      const deliverySlot = String(req.query.deliverySlot || '')
      const buildingId = req.query.buildingId ? parseInt(String(req.query.buildingId)) : null
      const restaurantId = req.query.restaurantId ? parseInt(String(req.query.restaurantId)) : null

      if (!deliverySlot || !buildingId || !restaurantId || !Number.isFinite(userId)) {
        return res.status(400).json({
          success: false,
          error: 'userId, deliverySlot, buildingId, and restaurantId are required',
        })
      }

      const orderDate = getTodayInAppTz()
      const order = context.repos.order.findActiveByUserAndSlot(
        userId,
        buildingId,
        restaurantId,
        deliverySlot,
        orderDate,
      )

      if (!order) {
        return res.json({ success: true, data: null })
      }

      const parsed = {
        ...order,
        items: JSON.parse(order.items),
      }

      res.json({ success: true, data: parsed })
    } catch (error) {
      logApiError(res, 'Error fetching active order for user', error)
      res.status(500).json({ success: false, error: 'Failed to fetch active order' })
    }
  })

  // POST /api/orders - создать заказ (принимает snake_case или camelCase)
  app.post('/api/orders', (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, unknown>
      const user_id = body.user_id ?? body.userId
      const restaurant_id = body.restaurant_id ?? body.restaurantId
      const building_id = body.building_id ?? body.buildingId
      const items = body.items
      const total_price = body.total_price ?? body.totalPrice
      const delivery_slot = body.delivery_slot ?? body.deliverySlot

      const missingFields: string[] = []
      if (!user_id) missingFields.push('user_id')
      if (!restaurant_id) missingFields.push('restaurant_id')
      if (!building_id) missingFields.push('building_id')
      if (!items) missingFields.push('items')
      if (total_price == null) missingFields.push('total_price')
      if (!delivery_slot) missingFields.push('delivery_slot')

      if (missingFields.length > 0) {
        logger.warn('Order creation: missing fields', { missingFields, body: req.body })
        return res.status(400).json({
          success: false,
          error: `Missing required fields: ${missingFields.join(', ')}`,
        })
      }

      // Защита от дубликатов: проверяем, нет ли уже активного заказа пользователя
      // для этого же слота/здания/ресторана. Если есть — возвращаем понятную
      // бизнес-ошибку, чтобы фронт не создавал несколько заказов на одно и то же.
      const orderDate = getTodayInAppTz()
      const existingOrder = context.repos.order.findActiveByUserAndSlot(
        Number(user_id),
        Number(building_id),
        Number(restaurant_id),
        String(delivery_slot),
        orderDate,
      )

      if (existingOrder) {
        return res.status(400).json({
          success: false,
          error: 'user_order_already_exists_for_slot',
        })
      }

      const order = context.repos.order.create({
        user_id: Number(user_id),
        restaurant_id: Number(restaurant_id),
        building_id: Number(building_id),
        items: JSON.stringify(items),
        total_price: Number(total_price),
        delivery_slot: String(delivery_slot),
        status: 'pending',
      })

      res.json({
        success: true,
        data: {
          ...order,
          items: JSON.parse(order.items),
        },
      })
    } catch (error) {
      logApiError(res, 'Error creating order', error)
      res.status(500).json({ success: false, error: 'Failed to create order' })
    }
  })

  // GET /api/group-orders - получить общий заказ по слоту/зданию/ресторану
  app.get('/api/group-orders', (req: Request, res: Response) => {
    try {
      const deliverySlot = String(req.query.deliverySlot || '')
      const buildingId = req.query.buildingId ? parseInt(String(req.query.buildingId)) : null
      const restaurantId = req.query.restaurantId ? parseInt(String(req.query.restaurantId)) : null

      if (!deliverySlot || !buildingId || !restaurantId) {
        return res.status(400).json({
          success: false,
          error: 'deliverySlot, buildingId, and restaurantId are required',
        })
      }

      // Получаем все заказы для этого слота/здания/ресторана
      const orderDate = getTodayInAppTz()
      const orders = context.repos.order.findBySlotAndBuilding(
        deliverySlot,
        buildingId,
        restaurantId,
        orderDate,
      )

      // Парсим items и считаем общую сумму
      const parsedOrders = orders.map((order) => ({
        ...order,
        items: JSON.parse(order.items),
      }))

      const totalAmount = parsedOrders.reduce((sum, order) => sum + order.total_price, 0)
      const participantCount = parsedOrders.length
      const restaurant = context.repos.restaurant.findById(restaurantId)
      const minimumAmount = restaurant?.min_order_amount ?? 0

      res.json({
        success: true,
        data: {
          deliverySlot,
          buildingId,
          restaurantId,
          participantCount,
          totalAmount,
          minimumAmount,
          orders: parsedOrders,
        },
      })
    } catch (error) {
      logApiError(res, 'Error fetching group order', error)
      res.status(500).json({ success: false, error: 'Failed to fetch group order' })
    }
  })

  // POST /api/orders/:id/pay — [ВРЕМЕННАЯ ЗАГЛУШКА] без оплаты, без проверки кредитов (см. STATUS.md)
  app.post('/api/orders/:id/pay', (req: Request, res: Response) => {
    try {
      const orderId = parseInt(String(req.params.id))
      const { telegram_user_id } = req.body
      if (!telegram_user_id) {
        return res.status(400).json({
          success: false,
          error: 'telegram_user_id is required',
        })
      }
      const telegramUserId = parseInt(String(telegram_user_id))
      const user = context.repos.user.findByTelegramId(telegramUserId)
      if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' })
      }
      const order = context.repos.order.findById(orderId)
      if (!order) {
        return res.status(404).json({ success: false, error: 'Order not found' })
      }
      if (order.user_id !== user.id) {
        return res.status(403).json({ success: false, error: 'Not your order' })
      }
      // [ВРЕМЕННО] Заглушка: заказ остаётся pending, кредиты не списываются
      const updated = context.repos.order.findById(orderId)!
      res.json({
        success: true,
        data: {
          ...updated,
          items: JSON.parse(updated.items),
        },
      })
    } catch (error) {
      logApiError(res, 'Error paying order', error)
      res.status(500).json({ success: false, error: 'Failed to pay order' })
    }
  })

  // PATCH /api/orders/:id/status - обновить статус заказа
  app.patch('/api/orders/:id/status', (req: Request, res: Response) => {
    try {
      const orderId = parseInt(String(req.params.id))
      const { status } = req.body

      const validStatuses = ['pending', 'confirmed', 'restaurant_confirmed', 'preparing', 'ready', 'delivered', 'cancelled']
      if (!status || !validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
        })
      }

      context.repos.order.updateStatus(orderId, status)
      const order = context.repos.order.findById(orderId)

      if (!order) {
        return res.status(404).json({ success: false, error: 'Order not found' })
      }

      res.json({
        success: true,
        data: {
          ...order,
          items: JSON.parse(order.items),
        },
      })
    } catch (error) {
      logApiError(res, 'Error updating order status', error)
      res.status(500).json({ success: false, error: 'Failed to update order status' })
    }
  })

  // DELETE /api/orders/:id - отменить заказ (без работы с кредитами/баллами)
  app.delete('/api/orders/:id', (req: Request, res: Response) => {
    try {
      const orderId = parseInt(String(req.params.id))
      const telegramUserId = req.query.telegram_user_id
        ? parseInt(String(req.query.telegram_user_id))
        : NaN
      if (!Number.isFinite(telegramUserId)) {
        return res.status(400).json({ success: false, error: 'telegram_user_id is required' })
      }
      const user = context.repos.user.findByTelegramId(telegramUserId)
      if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' })
      }
      const order = context.repos.order.findById(orderId)
      if (!order) {
        return res.status(404).json({ success: false, error: 'Order not found' })
      }
      if (order.user_id !== user.id) {
        return res.status(403).json({ success: false, error: 'Not your order' })
      }
      if (order.status === 'cancelled') {
        return res.status(400).json({ success: false, error: 'Order already cancelled' })
      }
      context.repos.order.updateStatus(orderId, 'cancelled')
      const updatedOrder = context.repos.order.findById(orderId)!
      res.json({
        success: true,
        data: {
          ...updatedOrder,
          items: JSON.parse(updatedOrder.items),
        },
      })
    } catch (error) {
      logApiError(res, 'Error cancelling order', error)
      res.status(500).json({ success: false, error: 'Failed to cancel order' })
    }
  })

  // Error handling middleware
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logApiError(res, 'Unhandled error', err)
    res.status(500).json({ success: false, error: 'Internal server error' })
  })

  return app
}
