import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { RestaurantRepository, MenuRepository } from '../repository'
import { initDatabase } from '../schema'

describe('RestaurantRepository', () => {
  let db: Database.Database
  let repo: RestaurantRepository

  beforeEach(() => {
    // Создаем in-memory БД для каждого теста
    db = new Database(':memory:')
    initDatabase(':memory:')
    
    // Инициализируем схему
    db.exec(`
      CREATE TABLE restaurants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        chat_id INTEGER UNIQUE NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `)
    
    repo = new RestaurantRepository(db)
  })

  it('должен создавать новый ресторан', () => {
    const restaurant = repo.findOrCreateByChatId(12345, 'Тестовый ресторан')
    
    expect(restaurant).toBeDefined()
    expect(restaurant.id).toBeDefined()
    expect(restaurant.name).toBe('Тестовый ресторан')
    expect(restaurant.chat_id).toBe(12345)
  })

  it('должен находить существующий ресторан', () => {
    const first = repo.findOrCreateByChatId(12345, 'Ресторан 1')
    const second = repo.findOrCreateByChatId(12345, 'Ресторан 2')
    
    // Должен вернуть тот же ресторан
    expect(second.id).toBe(first.id)
    expect(second.name).toBe(first.name)
  })

  it('должен находить ресторан по chat_id', () => {
    repo.findOrCreateByChatId(12345, 'Тестовый ресторан')
    
    const found = repo.findByChatId(12345)
    expect(found).toBeDefined()
    expect(found?.name).toBe('Тестовый ресторан')
  })

  it('должен возвращать undefined для несуществующего chat_id', () => {
    const found = repo.findByChatId(99999)
    expect(found).toBeUndefined()
  })
})

describe('MenuRepository', () => {
  let db: Database.Database
  let restaurantRepo: RestaurantRepository
  let menuRepo: MenuRepository
  let restaurantId: number

  beforeEach(() => {
    // Создаем in-memory БД для каждого теста
    db = new Database(':memory:')
    
    // Инициализируем схему
    db.exec(`
      CREATE TABLE restaurants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        chat_id INTEGER UNIQUE NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `)
    
    db.exec(`
      CREATE TABLE menu_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        restaurant_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        price REAL NOT NULL,
        description TEXT,
        category TEXT,
        is_breakfast INTEGER DEFAULT 0,
        is_available INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
      )
    `)
    
    restaurantRepo = new RestaurantRepository(db)
    menuRepo = new MenuRepository(db)
    
    // Создаем тестовый ресторан
    const restaurant = restaurantRepo.findOrCreateByChatId(12345, 'Тест')
    restaurantId = restaurant.id
  })

  describe('createItem', () => {
    it('должен создавать блюдо', () => {
      const item = menuRepo.createItem({
        restaurant_id: restaurantId,
        name: 'Борщ',
        price: 250,
        description: 'Украинский борщ',
        category: 'Супы',
        is_breakfast: false,
        is_available: true,
      })

      expect(item).toBeDefined()
      expect(item.id).toBeDefined()
      expect(item.name).toBe('Борщ')
      expect(item.price).toBe(250)
      expect(item.description).toBe('Украинский борщ')
      expect(item.category).toBe('Супы')
      expect(item.is_breakfast).toBe(false)
      expect(item.is_available).toBe(true)
    })

    it('должен создавать блюдо без описания', () => {
      const item = menuRepo.createItem({
        restaurant_id: restaurantId,
        name: 'Пицца',
        price: 450,
        category: 'Пицца',
        is_breakfast: false,
        is_available: true,
      })

      expect(item.description).toBeUndefined()
    })
  })

  describe('findByRestaurantId', () => {
    it('должен находить все блюда ресторана', () => {
      menuRepo.createItem({
        restaurant_id: restaurantId,
        name: 'Борщ',
        price: 250,
        category: 'Супы',
        is_breakfast: false,
        is_available: true,
      })

      menuRepo.createItem({
        restaurant_id: restaurantId,
        name: 'Салат Цезарь',
        price: 350,
        category: 'Салаты',
        is_breakfast: false,
        is_available: true,
      })

      const items = menuRepo.findByRestaurantId(restaurantId)
      expect(items).toHaveLength(2)
    })

    it('должен возвращать пустой массив для пустого меню', () => {
      const items = menuRepo.findByRestaurantId(restaurantId)
      expect(items).toHaveLength(0)
    })
  })

  describe('findById', () => {
    it('должен находить блюдо по ID', () => {
      const created = menuRepo.createItem({
        restaurant_id: restaurantId,
        name: 'Борщ',
        price: 250,
        category: 'Супы',
        is_breakfast: false,
        is_available: true,
      })

      const found = menuRepo.findById(created.id)
      expect(found).toBeDefined()
      expect(found?.name).toBe('Борщ')
    })

    it('должен возвращать undefined для несуществующего ID', () => {
      const found = menuRepo.findById(99999)
      expect(found).toBeUndefined()
    })
  })

  describe('updateItem', () => {
    it('должен обновлять название', () => {
      const item = menuRepo.createItem({
        restaurant_id: restaurantId,
        name: 'Борщ',
        price: 250,
        category: 'Супы',
        is_breakfast: false,
        is_available: true,
      })

      menuRepo.updateItem(item.id, { name: 'Борщ украинский' })
      
      const updated = menuRepo.findById(item.id)
      expect(updated?.name).toBe('Борщ украинский')
    })

    it('должен обновлять цену', () => {
      const item = menuRepo.createItem({
        restaurant_id: restaurantId,
        name: 'Борщ',
        price: 250,
        category: 'Супы',
        is_breakfast: false,
        is_available: true,
      })

      menuRepo.updateItem(item.id, { price: 300 })
      
      const updated = menuRepo.findById(item.id)
      expect(updated?.price).toBe(300)
    })

    it('должен обновлять несколько полей одновременно', () => {
      const item = menuRepo.createItem({
        restaurant_id: restaurantId,
        name: 'Борщ',
        price: 250,
        category: 'Супы',
        is_breakfast: false,
        is_available: true,
      })

      menuRepo.updateItem(item.id, {
        name: 'Борщ украинский',
        price: 300,
        description: 'Традиционный украинский борщ',
      })
      
      const updated = menuRepo.findById(item.id)
      expect(updated?.name).toBe('Борщ украинский')
      expect(updated?.price).toBe(300)
      expect(updated?.description).toBe('Традиционный украинский борщ')
    })
  })

  describe('deleteItem', () => {
    it('должен удалять блюдо', () => {
      const item = menuRepo.createItem({
        restaurant_id: restaurantId,
        name: 'Борщ',
        price: 250,
        category: 'Супы',
        is_breakfast: false,
        is_available: true,
      })

      menuRepo.deleteItem(item.id)
      
      const found = menuRepo.findById(item.id)
      expect(found).toBeUndefined()
    })
  })

  describe('toggleAvailability', () => {
    it('должен переключать доступность блюда', () => {
      const item = menuRepo.createItem({
        restaurant_id: restaurantId,
        name: 'Борщ',
        price: 250,
        category: 'Супы',
        is_breakfast: false,
        is_available: true,
      })

      // Скрываем (SQLite возвращает 0 для false)
      menuRepo.toggleAvailability(item.id)
      let updated = menuRepo.findById(item.id)
      expect(updated?.is_available).toBe(0)

      // Показываем (SQLite возвращает 1 для true)
      menuRepo.toggleAvailability(item.id)
      updated = menuRepo.findById(item.id)
      expect(updated?.is_available).toBe(1)
    })
  })

  describe('findBreakfastsByRestaurantId', () => {
    it('должен находить только завтраки', () => {
      menuRepo.createItem({
        restaurant_id: restaurantId,
        name: 'Омлет',
        price: 200,
        category: 'Завтраки',
        is_breakfast: true,
        is_available: true,
      })

      menuRepo.createItem({
        restaurant_id: restaurantId,
        name: 'Борщ',
        price: 250,
        category: 'Супы',
        is_breakfast: false,
        is_available: true,
      })

      const breakfasts = menuRepo.findBreakfastsByRestaurantId(restaurantId)
      expect(breakfasts).toHaveLength(1)
      expect(breakfasts[0].name).toBe('Омлет')
    })
  })

  describe('findByCategoryAndRestaurantId', () => {
    it('должен находить блюда по категории', () => {
      menuRepo.createItem({
        restaurant_id: restaurantId,
        name: 'Борщ',
        price: 250,
        category: 'Супы',
        is_breakfast: false,
        is_available: true,
      })

      menuRepo.createItem({
        restaurant_id: restaurantId,
        name: 'Солянка',
        price: 280,
        category: 'Супы',
        is_breakfast: false,
        is_available: true,
      })

      menuRepo.createItem({
        restaurant_id: restaurantId,
        name: 'Салат',
        price: 350,
        category: 'Салаты',
        is_breakfast: false,
        is_available: true,
      })

      const soups = menuRepo.findByCategoryAndRestaurantId('Супы', restaurantId)
      expect(soups).toHaveLength(2)
    })
  })

  describe('getAllCategories', () => {
    it('должен возвращать все уникальные категории', () => {
      menuRepo.createItem({
        restaurant_id: restaurantId,
        name: 'Борщ',
        price: 250,
        category: 'Супы',
        is_breakfast: false,
        is_available: true,
      })

      menuRepo.createItem({
        restaurant_id: restaurantId,
        name: 'Салат',
        price: 350,
        category: 'Салаты',
        is_breakfast: false,
        is_available: true,
      })

      menuRepo.createItem({
        restaurant_id: restaurantId,
        name: 'Солянка',
        price: 280,
        category: 'Супы',
        is_breakfast: false,
        is_available: true,
      })

      const categories = menuRepo.getAllCategories(restaurantId)
      expect(categories).toHaveLength(2)
      expect(categories).toContain('Супы')
      expect(categories).toContain('Салаты')
    })
  })

  describe('renameCategory', () => {
    it('должен переименовать категорию для всех блюд ресторана', () => {
      menuRepo.createItem({
        restaurant_id: restaurantId,
        name: 'Борщ',
        price: 250,
        category: 'Длинное название категории',
        is_breakfast: false,
        is_available: true,
      })
      menuRepo.createItem({
        restaurant_id: restaurantId,
        name: 'Солянка',
        price: 280,
        category: 'Длинное название категории',
        is_breakfast: false,
        is_available: true,
      })
      menuRepo.createItem({
        restaurant_id: restaurantId,
        name: 'Салат',
        price: 350,
        category: 'Салаты',
        is_breakfast: false,
        is_available: true,
      })

      const updated = menuRepo.renameCategory(restaurantId, 'Длинное название категории', 'Супы')
      expect(updated).toBe(2)

      const soups = menuRepo.findByCategoryAndRestaurantId('Супы', restaurantId)
      expect(soups).toHaveLength(3)
      const oldCat = menuRepo.findByCategoryAndRestaurantId('Длинное название категории', restaurantId)
      expect(oldCat).toHaveLength(0)
    })
  })

  describe('findAvailableByRestaurantId', () => {
    it('должен находить только доступные блюда', () => {
      menuRepo.createItem({
        restaurant_id: restaurantId,
        name: 'Борщ',
        price: 250,
        category: 'Супы',
        is_breakfast: false,
        is_available: true,
      })

      menuRepo.createItem({
        restaurant_id: restaurantId,
        name: 'Салат',
        price: 350,
        category: 'Салаты',
        is_breakfast: false,
        is_available: false,
      })

      const available = menuRepo.findAvailableByRestaurantId(restaurantId)
      expect(available).toHaveLength(1)
      expect(available[0].name).toBe('Борщ')
    })
  })

  describe('findUnavailableByRestaurantId', () => {
    it('должен находить только недоступные блюда', () => {
      menuRepo.createItem({
        restaurant_id: restaurantId,
        name: 'Борщ',
        price: 250,
        category: 'Супы',
        is_breakfast: false,
        is_available: true,
      })

      menuRepo.createItem({
        restaurant_id: restaurantId,
        name: 'Салат',
        price: 350,
        category: 'Салаты',
        is_breakfast: false,
        is_available: false,
      })

      const unavailable = menuRepo.findUnavailableByRestaurantId(restaurantId)
      expect(unavailable).toHaveLength(1)
      expect(unavailable[0].name).toBe('Салат')
    })
  })

  describe('deleteAllByRestaurantId', () => {
    it('должен удалять все блюда ресторана', () => {
      menuRepo.createItem({
        restaurant_id: restaurantId,
        name: 'Борщ',
        price: 250,
        category: 'Супы',
        is_breakfast: false,
        is_available: true,
      })

      menuRepo.createItem({
        restaurant_id: restaurantId,
        name: 'Салат',
        price: 350,
        category: 'Салаты',
        is_breakfast: false,
        is_available: true,
      })

      menuRepo.deleteAllByRestaurantId(restaurantId)
      
      const items = menuRepo.findByRestaurantId(restaurantId)
      expect(items).toHaveLength(0)
    })
  })
})
