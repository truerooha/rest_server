import express, { Express, Request, Response, NextFunction } from 'express'
import cors from 'cors'
import Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import {
  BuildingRepository,
  UserRepository,
  RestaurantRepository,
  MenuRepository,
  RestaurantBuildingRepository,
  OrderRepository,
} from '../db/repository'
import { CreditRepository } from '../db/repository-credits'
import { ORDER_CONFIG } from '../utils/order-config'
import { logger } from '../utils/logger'
import { config } from '../utils/config'

export interface ApiContext {
  db: Database.Database
  repos: {
    building: BuildingRepository
    user: UserRepository
    restaurant: RestaurantRepository
    menu: MenuRepository
    restaurantBuilding: RestaurantBuildingRepository
    order: OrderRepository
    credit: CreditRepository
  }
}

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
      credit: new CreditRepository(db),
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

  // GET /api/delivery-slots - получить доступные слоты доставки
  app.get('/api/delivery-slots', (_req: Request, res: Response) => {
    try {
      const now = new Date()
      const nowMinutes = now.getHours() * 60 + now.getMinutes()

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

      const slots = ORDER_CONFIG.deliverySlots.map((slot) => {
        const slotMinutes = toMinutes(slot.time)
        const deadlineMinutes = Math.max(
          slotMinutes - ORDER_CONFIG.orderLeadMinutes,
          0,
        )
        const deadline = toTime(deadlineMinutes)
        const isAvailable = nowMinutes <= deadlineMinutes

        return {
          id: slot.id,
          time: slot.time,
          deadline,
          isAvailable,
        }
      })

      res.json({ success: true, data: slots })
    } catch (error) {
      logApiError(res, 'Error fetching delivery slots', error)
      res.status(500).json({ success: false, error: 'Failed to fetch delivery slots' })
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
          name: 'Грамм',
          chat_id: 123456789 // Dummy chat ID
        })
        restaurant = result
      } else {
        const withMenu = findRestaurantWithMenu()
        restaurant = withMenu ?? restaurants[0]
        if (!withMenu && restaurant.name !== 'Грамм') {
          db.prepare('UPDATE restaurants SET name = ? WHERE id = ?').run('Грамм', restaurant.id)
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
      const restaurant = context.repos.restaurant.findByChatId(id)

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

  // POST /api/orders - создать заказ
  app.post('/api/orders', (req: Request, res: Response) => {
    try {
      const { user_id, restaurant_id, building_id, items, total_price, delivery_slot } = req.body

      if (!user_id || !restaurant_id || !building_id || !items || !total_price || !delivery_slot) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields',
        })
      }

      // Создаём заказ
      const order = context.repos.order.create({
        user_id,
        restaurant_id,
        building_id,
        items: JSON.stringify(items),
        total_price,
        delivery_slot,
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
      const orders = context.repos.order.findBySlotAndBuilding(deliverySlot, buildingId, restaurantId)

      // Парсим items и считаем общую сумму
      const parsedOrders = orders.map((order) => ({
        ...order,
        items: JSON.parse(order.items),
      }))

      const totalAmount = parsedOrders.reduce((sum, order) => sum + order.total_price, 0)
      const participantCount = parsedOrders.length

      res.json({
        success: true,
        data: {
          deliverySlot,
          buildingId,
          restaurantId,
          participantCount,
          totalAmount,
          orders: parsedOrders,
        },
      })
    } catch (error) {
      logApiError(res, 'Error fetching group order', error)
      res.status(500).json({ success: false, error: 'Failed to fetch group order' })
    }
  })

  // PATCH /api/orders/:id/status - обновить статус заказа
  app.patch('/api/orders/:id/status', (req: Request, res: Response) => {
    try {
      const orderId = parseInt(String(req.params.id))
      const { status } = req.body

      const validStatuses = ['pending', 'confirmed', 'preparing', 'ready', 'delivered', 'cancelled']
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

  // DELETE /api/orders/:id - отменить заказ
  app.delete('/api/orders/:id', (req: Request, res: Response) => {
    try {
      const orderId = parseInt(String(req.params.id))
      const order = context.repos.order.findById(orderId)

      if (!order) {
        return res.status(404).json({ success: false, error: 'Order not found' })
      }

      // Проверяем, можно ли отменить (только pending заказы)
      if (order.status !== 'pending') {
        return res.status(400).json({
          success: false,
          error: 'Only pending orders can be cancelled',
        })
      }

      context.repos.order.updateStatus(orderId, 'cancelled')
      const updatedOrder = context.repos.order.findById(orderId)

      res.json({
        success: true,
        data: {
          ...updatedOrder,
          items: JSON.parse(updatedOrder!.items),
        },
      })
    } catch (error) {
      logApiError(res, 'Error cancelling order', error)
      res.status(500).json({ success: false, error: 'Failed to cancel order' })
    }
  })

  // === CREDITS ENDPOINTS ===

  // GET /api/users/:userId/credits - получить баланс баллов пользователя
  app.get('/api/users/:userId/credits', (req: Request, res: Response) => {
    try {
      const userId = parseInt(String(req.params.userId))
      const credit = context.repos.credit.findByUserId(userId)

      if (!credit) {
        // Инициализируем баланс если не существует
        const newCredit = context.repos.credit.initializeForUser(userId)
        return res.json({ success: true, data: newCredit })
      }

      res.json({ success: true, data: credit })
    } catch (error) {
      logApiError(res, 'Error fetching credits', error)
      res.status(500).json({ success: false, error: 'Failed to fetch credits' })
    }
  })

  // POST /api/users/:userId/credits/adjust - изменить баланс баллов
  app.post('/api/users/:userId/credits/adjust', (req: Request, res: Response) => {
    try {
      const userId = parseInt(String(req.params.userId))
      const { amount, type, description, order_id } = req.body

      if (!amount || !type || !description) {
        return res.status(400).json({
          success: false,
          error: 'amount, type, and description are required',
        })
      }

      const validTypes = ['earn', 'spend', 'refund']
      if (!validTypes.includes(type)) {
        return res.status(400).json({
          success: false,
          error: `Invalid type. Must be one of: ${validTypes.join(', ')}`,
        })
      }

      const credit = context.repos.credit.adjustBalance(
        userId,
        amount,
        type,
        description,
        order_id,
      )

      res.json({ success: true, data: credit })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to adjust credits'
      logApiError(res, 'Error adjusting credits', error)
      res.status(500).json({ success: false, error: message })
    }
  })

  // GET /api/users/:userId/credits/transactions - получить историю транзакций
  app.get('/api/users/:userId/credits/transactions', (req: Request, res: Response) => {
    try {
      const userId = parseInt(String(req.params.userId))
      const limit = req.query.limit ? parseInt(String(req.query.limit)) : 50

      const transactions = context.repos.credit.getTransactions(userId, limit)
      res.json({ success: true, data: transactions })
    } catch (error) {
      logApiError(res, 'Error fetching credit transactions', error)
      res.status(500).json({ success: false, error: 'Failed to fetch transactions' })
    }
  })

  // Error handling middleware
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logApiError(res, 'Unhandled error', err)
    res.status(500).json({ success: false, error: 'Internal server error' })
  })

  return app
}
