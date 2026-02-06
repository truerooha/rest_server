import express, { Express, Request, Response, NextFunction } from 'express'
import cors from 'cors'
import Database from 'better-sqlite3'
import {
  BuildingRepository,
  UserRepository,
  RestaurantRepository,
  MenuRepository,
  RestaurantBuildingRepository,
  OrderRepository,
} from '../db/repository'
import { ORDER_CONFIG } from '../utils/order-config'

export interface ApiContext {
  db: Database.Database
  repos: {
    building: BuildingRepository
    user: UserRepository
    restaurant: RestaurantRepository
    menu: MenuRepository
    restaurantBuilding: RestaurantBuildingRepository
    order: OrderRepository
  }
}

/**
 * Создаёт Express API сервер
 */
export function createApiServer(db: Database.Database): Express {
  const app = express()

  // Middleware
  app.use(cors())
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
    },
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
      console.error('Error fetching delivery slots:', error)
      res.status(500).json({ success: false, error: 'Failed to fetch delivery slots' })
    }
  })

  // Инициализация дефолтных данных (только для первого запуска)
  app.post('/api/init-default-data', async (_req: Request, res: Response) => {
    try {
      // Проверяем, есть ли уже данные
      const buildings = context.repos.building.findAll()
      const coworkingExists = buildings.find(b => b.name === 'Коворкинг')

      if (coworkingExists) {
        return res.json({
          success: true,
          message: 'Дефолтные данные уже существуют',
          data: { building: coworkingExists },
        })
      }

      // Создаём здание "Коворкинг"
      const coworkingBuilding = context.repos.building.create({
        name: 'Коворкинг',
        address: 'Дефолтный адрес коворкинга',
      })

      // Находим первый ресторан и переименовываем в "Грамм"
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
        restaurant = restaurants[0]
        // Переименовываем в "Грамм" если нужно
        if (restaurant.name !== 'Грамм') {
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
          restaurant: { id: restaurant.id, name: 'Грамм' },
        },
      })
    } catch (error) {
      console.error('Error initializing default data:', error)
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
      console.error('Error fetching buildings:', error)
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
      console.error('Error fetching building:', error)
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
        res.json({ success: true, data: restaurants })
      } else {
        res.status(400).json({ success: false, error: 'buildingId parameter is required' })
      }
    } catch (error) {
      console.error('Error fetching restaurants:', error)
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
      console.error('Error fetching restaurant:', error)
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
      console.error('Error fetching menu:', error)
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
      console.error('Error fetching user:', error)
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
      console.error('Error creating/updating user:', error)
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
      console.error('Error updating user building:', error)
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
      console.error('Error fetching orders:', error)
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
      console.error('Error creating order:', error)
      res.status(500).json({ success: false, error: 'Failed to create order' })
    }
  })

  // Error handling middleware
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Unhandled error:', err)
    res.status(500).json({ success: false, error: 'Internal server error' })
  })

  return app
}
