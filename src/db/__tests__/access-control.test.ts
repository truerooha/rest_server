import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  BuildingRepository,
  UserRepository,
  RestaurantAdminRepository,
  RestaurantRepository,
} from '../repository'
import { generateInviteCode } from '../migrations/migrate'

function createTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE buildings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      invite_code TEXT UNIQUE,
      invite_code_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `)
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_user_id INTEGER UNIQUE NOT NULL,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      building_id INTEGER,
      is_approved INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `)
  db.exec(`
    CREATE TABLE restaurants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      chat_id INTEGER UNIQUE NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `)
  db.exec(`
    CREATE TABLE restaurant_admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      restaurant_id INTEGER NOT NULL,
      telegram_user_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      added_by_telegram_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(restaurant_id, telegram_user_id)
    )
  `)
  return db
}

describe('RestaurantAdminRepository', () => {
  let db: Database.Database
  let adminRepo: RestaurantAdminRepository
  let restaurantRepo: RestaurantRepository

  beforeEach(() => {
    db = createTestDb()
    adminRepo = new RestaurantAdminRepository(db)
    restaurantRepo = new RestaurantRepository(db)
  })

  it('должен предоставлять и проверять права админа', () => {
    const restaurant = restaurantRepo.create({ name: 'Тест', chat_id: 111 })
    expect(adminRepo.isAdmin(222)).toBe(false)
    adminRepo.grant(restaurant.id, 222, 'admin', 111)
    expect(adminRepo.isAdmin(222)).toBe(true)
  })

  it('должен отзывать права', () => {
    const restaurant = restaurantRepo.create({ name: 'Тест', chat_id: 111 })
    adminRepo.grant(restaurant.id, 222)
    expect(adminRepo.isAdmin(222)).toBe(true)
    const removed = adminRepo.revoke(restaurant.id, 222)
    expect(removed).toBe(true)
    expect(adminRepo.isAdmin(222)).toBe(false)
  })

  it('revoke возвращает false если запись не найдена', () => {
    expect(adminRepo.revoke(1, 999)).toBe(false)
  })

  it('findByRestaurantId возвращает список админов', () => {
    const restaurant = restaurantRepo.create({ name: 'Тест', chat_id: 111 })
    adminRepo.grant(restaurant.id, 222)
    adminRepo.grant(restaurant.id, 333)
    const admins = adminRepo.findByRestaurantId(restaurant.id)
    expect(admins).toHaveLength(2)
  })

  it('findByTelegramId возвращает записи по telegram_user_id', () => {
    const r1 = restaurantRepo.create({ name: 'Р1', chat_id: 111 })
    const r2 = restaurantRepo.create({ name: 'Р2', chat_id: 222 })
    adminRepo.grant(r1.id, 333)
    adminRepo.grant(r2.id, 333)
    const admins = adminRepo.findByTelegramId(333)
    expect(admins).toHaveLength(2)
  })

  it('grant не создаёт дубль (INSERT OR IGNORE)', () => {
    const restaurant = restaurantRepo.create({ name: 'Тест', chat_id: 111 })
    adminRepo.grant(restaurant.id, 222)
    adminRepo.grant(restaurant.id, 222)
    const admins = adminRepo.findByRestaurantId(restaurant.id)
    expect(admins).toHaveLength(1)
  })
})

describe('BuildingRepository - invite codes', () => {
  let db: Database.Database
  let buildingRepo: BuildingRepository

  beforeEach(() => {
    db = createTestDb()
    buildingRepo = new BuildingRepository(db)
  })

  it('findByInviteCode находит здание по коду', () => {
    const building = buildingRepo.create({ name: 'Офис', address: 'ул. Тест, 1' })
    buildingRepo.updateInviteCode(building.id, 'ABC123')
    const found = buildingRepo.findByInviteCode('abc123') // lowercase
    expect(found).toBeDefined()
    expect(found!.id).toBe(building.id)
  })

  it('findByInviteCode не находит неактивный код', () => {
    const building = buildingRepo.create({ name: 'Офис', address: 'ул. Тест, 1' })
    buildingRepo.updateInviteCode(building.id, 'ABC123')
    db.prepare('UPDATE buildings SET invite_code_active = 0 WHERE id = ?').run(building.id)
    const found = buildingRepo.findByInviteCode('ABC123')
    expect(found).toBeUndefined()
  })

  it('regenerateInviteCode генерирует новый код', () => {
    const building = buildingRepo.create({ name: 'Офис', address: 'ул. Тест, 1' })
    const code1 = buildingRepo.regenerateInviteCode(building.id)
    expect(code1).toHaveLength(6)
    const updated = buildingRepo.findById(building.id)
    expect(updated?.invite_code).toBe(code1)
  })
})

describe('UserRepository - approval', () => {
  let db: Database.Database
  let userRepo: UserRepository

  beforeEach(() => {
    db = createTestDb()
    userRepo = new UserRepository(db)
  })

  it('approve устанавливает is_approved = 1', () => {
    userRepo.create({ telegram_user_id: 111, building_id: 1 })
    userRepo.approve(111)
    const user = userRepo.findByTelegramId(111)
    expect(user?.is_approved).toBe(1)
  })

  it('block устанавливает is_approved = 0', () => {
    userRepo.create({ telegram_user_id: 111, building_id: 1 })
    userRepo.approve(111)
    userRepo.block(111)
    const user = userRepo.findByTelegramId(111)
    expect(user?.is_approved).toBe(0)
  })

  it('findApprovedByBuildingId возвращает только одобренных', () => {
    userRepo.create({ telegram_user_id: 111, building_id: 1 })
    userRepo.create({ telegram_user_id: 222, building_id: 1 })
    userRepo.approve(111)
    const approved = userRepo.findApprovedByBuildingId(1)
    expect(approved).toHaveLength(1)
    expect(approved[0].telegram_user_id).toBe(111)
  })

  it('findAll возвращает всех', () => {
    userRepo.create({ telegram_user_id: 111 })
    userRepo.create({ telegram_user_id: 222 })
    const all = userRepo.findAll()
    expect(all).toHaveLength(2)
  })
})

describe('generateInviteCode', () => {
  it('генерирует 6-символьный код', () => {
    const code = generateInviteCode()
    expect(code).toHaveLength(6)
    expect(code).toMatch(/^[A-Z0-9]+$/)
  })

  it('не содержит неоднозначных символов (0, O, 1, I)', () => {
    for (let i = 0; i < 100; i++) {
      const code = generateInviteCode()
      expect(code).not.toMatch(/[01OI]/)
    }
  })

  it('генерирует уникальные коды', () => {
    const codes = new Set<string>()
    for (let i = 0; i < 100; i++) {
      codes.add(generateInviteCode())
    }
    // 100 codes with 30^6 possible combinations — collision probability is negligible
    expect(codes.size).toBeGreaterThan(90)
  })
})
