import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initDatabase } from '../schema'
import { applyMigrations } from '../migrations/migrate'
import {
  BuildingRepository,
  UserRepository,
  OrderRepository,
  RestaurantBuildingRepository,
  RestaurantRepository,
} from '../repository'

describe('BuildingRepository', () => {
  let db: Database.Database
  let repo: BuildingRepository

  beforeEach(() => {
    db = initDatabase(':memory:')
    applyMigrations(db)
    repo = new BuildingRepository(db)
  })

  it('должен создавать здание', () => {
    const building = repo.create({
      name: 'Технопарк',
      address: 'ул. Ленина, 10',
    })

    expect(building.id).toBeGreaterThan(0)
    expect(building.name).toBe('Технопарк')
    expect(building.address).toBe('ул. Ленина, 10')
  })

  it('должен находить все здания', () => {
    repo.create({ name: 'Здание A', address: 'Адрес A' })
    repo.create({ name: 'Здание B', address: 'Адрес B' })

    const buildings = repo.findAll()
    expect(buildings.length).toBe(2)
  })

  it('должен находить здание по ID', () => {
    const created = repo.create({ name: 'Тест', address: 'Тест адрес' })
    const found = repo.findById(created.id)

    expect(found?.name).toBe('Тест')
  })

  it('должен обновлять здание', () => {
    const building = repo.create({ name: 'Старое', address: 'Старый адрес' })
    repo.update(building.id, { name: 'Новое' })

    const updated = repo.findById(building.id)
    expect(updated?.name).toBe('Новое')
    expect(updated?.address).toBe('Старый адрес')
  })

  it('должен удалять здание', () => {
    const building = repo.create({ name: 'Удалить', address: 'Адрес' })
    repo.delete(building.id)

    const found = repo.findById(building.id)
    expect(found).toBeUndefined()
  })
})

describe('UserRepository', () => {
  let db: Database.Database
  let repo: UserRepository

  beforeEach(() => {
    db = initDatabase(':memory:')
    applyMigrations(db)
    repo = new UserRepository(db)
  })

  it('должен создавать пользователя', () => {
    const user = repo.create({
      telegram_user_id: 12345,
      username: 'testuser',
      first_name: 'Иван',
      last_name: 'Иванов',
    })

    expect(user.id).toBeGreaterThan(0)
    expect(user.telegram_user_id).toBe(12345)
    expect(user.username).toBe('testuser')
  })

  it('должен находить пользователя по Telegram ID', () => {
    repo.create({
      telegram_user_id: 12345,
      username: 'testuser',
    })

    const found = repo.findByTelegramId(12345)
    expect(found?.username).toBe('testuser')
  })

  it('должен находить или создавать пользователя', () => {
    const user1 = repo.findOrCreate({
      telegram_user_id: 12345,
      username: 'testuser',
    })

    const user2 = repo.findOrCreate({
      telegram_user_id: 12345,
      username: 'testuser',
    })

    expect(user1.id).toBe(user2.id)
  })

  it('должен обновлять здание пользователя', () => {
    const buildingRepo = new BuildingRepository(db)
    const building = buildingRepo.create({ name: 'Офис', address: 'Адрес' })

    const user = repo.create({
      telegram_user_id: 12345,
      username: 'testuser',
    })

    repo.updateBuilding(12345, building.id)

    const updated = repo.findByTelegramId(12345)
    expect(updated?.building_id).toBe(building.id)
  })
})

describe('OrderRepository', () => {
  let db: Database.Database
  let repo: OrderRepository

  beforeEach(() => {
    db = initDatabase(':memory:')
    applyMigrations(db)
    repo = new OrderRepository(db)
  })

  it('должен создавать заказ', () => {
    const userRepo = new UserRepository(db)
    const restaurantRepo = new RestaurantRepository(db)
    const buildingRepo = new BuildingRepository(db)

    const user = userRepo.create({ telegram_user_id: 12345 })
    const restaurant = restaurantRepo.findOrCreateByChatId(11111, 'Столовая')
    const building = buildingRepo.create({ name: 'Офис', address: 'Адрес' })

    const order = repo.create({
      user_id: user.id,
      restaurant_id: restaurant.id,
      building_id: building.id,
      items: JSON.stringify([{ id: 1, name: 'Борщ', price: 150, quantity: 1 }]),
      total_price: 150,
      delivery_slot: '12:00-13:00',
      status: 'pending',
    })

    expect(order.id).toBeGreaterThan(0)
    expect(order.status).toBe('pending')
    expect(order.total_price).toBe(150)
  })

  it('должен находить заказы по пользователю', () => {
    const userRepo = new UserRepository(db)
    const restaurantRepo = new RestaurantRepository(db)
    const buildingRepo = new BuildingRepository(db)

    const user = userRepo.create({ telegram_user_id: 12345 })
    const restaurant = restaurantRepo.findOrCreateByChatId(11111, 'Столовая')
    const building = buildingRepo.create({ name: 'Офис', address: 'Адрес' })

    repo.create({
      user_id: user.id,
      restaurant_id: restaurant.id,
      building_id: building.id,
      items: '[]',
      total_price: 100,
      delivery_slot: '12:00-13:00',
      status: 'pending',
    })

    const orders = repo.findByUserId(user.id)
    expect(orders.length).toBe(1)
  })

  it('должен обновлять статус заказа', () => {
    const userRepo = new UserRepository(db)
    const restaurantRepo = new RestaurantRepository(db)
    const buildingRepo = new BuildingRepository(db)

    const user = userRepo.create({ telegram_user_id: 12345 })
    const restaurant = restaurantRepo.findOrCreateByChatId(11111, 'Столовая')
    const building = buildingRepo.create({ name: 'Офис', address: 'Адрес' })

    const order = repo.create({
      user_id: user.id,
      restaurant_id: restaurant.id,
      building_id: building.id,
      items: '[]',
      total_price: 100,
      delivery_slot: '12:00-13:00',
      status: 'pending',
    })

    repo.updateStatus(order.id, 'confirmed')

    const updated = repo.findById(order.id)
    expect(updated?.status).toBe('confirmed')
  })

  it('должен находить активные заказы ресторана', () => {
    const userRepo = new UserRepository(db)
    const restaurantRepo = new RestaurantRepository(db)
    const buildingRepo = new BuildingRepository(db)

    const user = userRepo.create({ telegram_user_id: 12345 })
    const restaurant = restaurantRepo.findOrCreateByChatId(11111, 'Столовая')
    const building = buildingRepo.create({ name: 'Офис', address: 'Адрес' })

    repo.create({
      user_id: user.id,
      restaurant_id: restaurant.id,
      building_id: building.id,
      items: '[]',
      total_price: 100,
      delivery_slot: '12:00-13:00',
      status: 'pending',
    })

    repo.create({
      user_id: user.id,
      restaurant_id: restaurant.id,
      building_id: building.id,
      items: '[]',
      total_price: 200,
      delivery_slot: '13:00-14:00',
      status: 'delivered',
    })

    const active = repo.findActiveByRestaurantId(restaurant.id)
    expect(active.length).toBe(1)
    expect(active[0].status).toBe('pending')
  })
})

describe('RestaurantBuildingRepository', () => {
  let db: Database.Database
  let repo: RestaurantBuildingRepository

  beforeEach(() => {
    db = initDatabase(':memory:')
    applyMigrations(db)
    repo = new RestaurantBuildingRepository(db)
  })

  it('должен связывать ресторан со зданием', () => {
    const restaurantRepo = new RestaurantRepository(db)
    const buildingRepo = new BuildingRepository(db)

    const restaurant = restaurantRepo.findOrCreateByChatId(11111, 'Столовая')
    const building = buildingRepo.create({ name: 'Офис', address: 'Адрес' })

    const link = repo.link(restaurant.id, building.id)

    expect(link.id).toBeGreaterThan(0)
    expect(link.restaurant_id).toBe(restaurant.id)
    expect(link.building_id).toBe(building.id)
  })

  it('должен находить рестораны по зданию', () => {
    const restaurantRepo = new RestaurantRepository(db)
    const buildingRepo = new BuildingRepository(db)

    const restaurant1 = restaurantRepo.findOrCreateByChatId(11111, 'Столовая 1')
    const restaurant2 = restaurantRepo.findOrCreateByChatId(22222, 'Столовая 2')
    const building = buildingRepo.create({ name: 'Офис', address: 'Адрес' })

    repo.link(restaurant1.id, building.id)
    repo.link(restaurant2.id, building.id)

    const restaurants = repo.findRestaurantsByBuildingId(building.id)
    expect(restaurants.length).toBe(2)
  })

  it('должен отвязывать ресторан от здания', () => {
    const restaurantRepo = new RestaurantRepository(db)
    const buildingRepo = new BuildingRepository(db)

    const restaurant = restaurantRepo.findOrCreateByChatId(11111, 'Столовая')
    const building = buildingRepo.create({ name: 'Офис', address: 'Адрес' })

    repo.link(restaurant.id, building.id)
    repo.unlink(restaurant.id, building.id)

    const restaurants = repo.findRestaurantsByBuildingId(building.id)
    expect(restaurants.length).toBe(0)
  })
})
