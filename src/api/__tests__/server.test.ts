import request from 'supertest'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyMigrations } from '../../db/migrations/migrate'
import { createApiServer } from '../server'
import {
  BuildingRepository,
  RestaurantBuildingRepository,
  RestaurantRepository,
  UserRepository,
} from '../../db/repository'
import { DraftRepository } from '../../db/repository-drafts'
import { initDatabase } from '../../db/schema'

describe('HTTP API server', () => {
  let db: Database.Database

  beforeEach(() => {
    db = initDatabase(':memory:')
    applyMigrations(db)

    // Страховка для in-memory БД: гарантируем наличие таблицы user_drafts
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_drafts (
        telegram_user_id INTEGER PRIMARY KEY,
        delivery_slot TEXT,
        restaurant_id INTEGER,
        building_id INTEGER,
        items TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `)
  })

  afterEach(() => {
    db.close()
  })

  const createApp = () => createApiServer(db)

  it('GET /api/health возвращает ok', async () => {
    const app = createApp()

    const res = await request(app).get('/api/health')

    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('status', 'ok')
    expect(res.body).toHaveProperty('timestamp')
  })

  it('POST /api/init-default-data создаёт Коворкинг и связывает ресторан', async () => {
    const app = createApp()

    const res = await request(app).post('/api/init-default-data').send({})

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.building.name).toBe('Коворкинг')
    expect(res.body.data.restaurant).toMatchObject({
      id: expect.any(Number),
      name: expect.any(String),
    })

    const buildingRepo = new BuildingRepository(db)
    const restaurantRepo = new RestaurantRepository(db)
    const restaurantBuildingRepo = new RestaurantBuildingRepository(db)

    const buildings = buildingRepo.findAll()
    expect(buildings.some((b) => b.name === 'Коворкинг')).toBe(true)

    const restaurant = restaurantRepo.findById(res.body.data.restaurant.id)
    expect(restaurant).toBeDefined()

    const buildingsForRestaurant = restaurantBuildingRepo.findBuildingsByRestaurantId(
      res.body.data.restaurant.id,
    )
    expect(buildingsForRestaurant.some((b) => b.name === 'Коворкинг')).toBe(true)
  })

  it('GET /api/buildings возвращает список зданий после init-default-data', async () => {
    const app = createApp()

    await request(app).post('/api/init-default-data').send({})
    const res = await request(app).get('/api/buildings')

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.length).toBeGreaterThan(0)
  })

  it('GET /api/restaurants?buildingId=... возвращает рестораны или fallback', async () => {
    const app = createApp()

    const initRes = await request(app).post('/api/init-default-data').send({})
    const buildingId = initRes.body.data.building.id

    const res = await request(app).get(`/api/restaurants?buildingId=${buildingId}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(Array.isArray(res.body.data)).toBe(true)
  })

  it('PUT /api/draft сохраняет валидный черновик и возвращает его с items как массив', async () => {
    const app = createApp()

    const body = {
      telegram_user_id: 123456789,
      delivery_slot: '12:00-13:00',
      restaurant_id: 1,
      building_id: 1,
      items: [
        { menu_item_id: 1, name: 'Борщ', price: 150, quantity: 1 },
        { menu_item_id: 2, name: 'Пюре', price: 100, quantity: 2 },
      ],
    }

    const res = await request(app).put('/api/draft').send(body)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.telegram_user_id).toBe(body.telegram_user_id)
    expect(Array.isArray(res.body.data.items)).toBe(true)
    expect(res.body.data.items).toEqual(body.items)

    const repo = new DraftRepository(db)
    const stored = repo.findByTelegramId(body.telegram_user_id)!
    expect(stored.items).toBe(JSON.stringify(body.items))
  })

  it('PUT /api/draft отклоняет невалидные items', async () => {
    const app = createApp()

    const invalidBodies = [
      {
        telegram_user_id: 1,
        items: 'строка',
      },
      {
        telegram_user_id: 1,
        items: [{ menu_item_id: 1, name: 'Борщ', quantity: 1 }], // нет price
      },
    ]

    for (const body of invalidBodies) {
      const res = await request(app).put('/api/draft').send(body)
      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
    }
  })

  it('POST /api/orders создаёт pending заказ и сохраняет items в JSON', async () => {
    const app = createApp()
    const userRepo = new UserRepository(db)
    const restaurantRepo = new RestaurantRepository(db)
    const buildingRepo = new BuildingRepository(db)

    const user = userRepo.create({ telegram_user_id: 12345 })
    const restaurant = restaurantRepo.findOrCreateByChatId(11111, 'Столовая')
    const building = buildingRepo.create({ name: 'Офис', address: 'Адрес' })

    const items = [
      { menu_item_id: 1, name: 'Борщ', price: 150, quantity: 1 },
      { menu_item_id: 2, name: 'Пюре', price: 100, quantity: 2 },
    ]

    const res = await request(app)
      .post('/api/orders')
      .send({
        user_id: user.id,
        restaurant_id: restaurant.id,
        building_id: building.id,
        items,
        total_price: 350,
        delivery_slot: '12:00-13:00',
      })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.status).toBe('pending')
    expect(res.body.data.items).toEqual(items)
  })

  it('POST /api/orders валидирует обязательные поля', async () => {
    const app = createApp()

    const res = await request(app).post('/api/orders').send({})

    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(res.body.error).toContain('Missing required fields')
  })

  // Тесты, связанные с системой кредитов/баллов, удалены: модель кредитов больше не используется.
})

