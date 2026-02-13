import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initDatabase } from '../schema'
import { applyMigrations } from '../migrations/migrate'
import {
  LobbyRepository,
  UserRepository,
  BuildingRepository,
  RestaurantRepository,
  RestaurantBuildingRepository,
} from '../repository'

describe('LobbyRepository', () => {
  let db: Database.Database
  let lobbyRepo: LobbyRepository
  let userRepo: UserRepository
  let buildingId: number
  let restaurantId: number
  const orderDate = '2026-02-13'
  const deliverySlot = '13:00'

  beforeEach(() => {
    db = initDatabase(':memory:')
    applyMigrations(db)
    lobbyRepo = new LobbyRepository(db)
    userRepo = new UserRepository(db)

    const buildingRepo = new BuildingRepository(db)
    const restaurantRepo = new RestaurantRepository(db)
    const rbRepo = new RestaurantBuildingRepository(db)

    const building = buildingRepo.create({ name: 'Офис', address: 'ул. Тест' })
    buildingId = building.id
    const restaurant = restaurantRepo.create({ name: 'Ресторан', chat_id: 123 })
    restaurantId = restaurant.id
    rbRepo.link(restaurantId, buildingId)
  })

  it('должен добавлять резервацию', () => {
    const user = userRepo.create({
      telegram_user_id: 111,
      username: 'u1',
    })
    lobbyRepo.addReservation(buildingId, restaurantId, deliverySlot, orderDate, user.id)

    const count = lobbyRepo.countReservations(buildingId, restaurantId, deliverySlot, orderDate)
    expect(count).toBe(1)
    expect(lobbyRepo.hasUserReservation(111, buildingId, restaurantId, deliverySlot, orderDate)).toBe(
      true,
    )
  })

  it('должен удалять резервацию', () => {
    const user = userRepo.create({
      telegram_user_id: 222,
      username: 'u2',
    })
    lobbyRepo.addReservation(buildingId, restaurantId, deliverySlot, orderDate, user.id)
    lobbyRepo.removeReservation(buildingId, restaurantId, deliverySlot, orderDate, user.id)

    const count = lobbyRepo.countReservations(buildingId, restaurantId, deliverySlot, orderDate)
    expect(count).toBe(0)
    expect(lobbyRepo.hasUserReservation(222, buildingId, restaurantId, deliverySlot, orderDate)).toBe(
      false,
    )
  })

  it('дубликат не создаёт вторую запись', () => {
    const user = userRepo.create({
      telegram_user_id: 333,
      username: 'u3',
    })
    lobbyRepo.addReservation(buildingId, restaurantId, deliverySlot, orderDate, user.id)
    lobbyRepo.addReservation(buildingId, restaurantId, deliverySlot, orderDate, user.id)

    const count = lobbyRepo.countReservations(buildingId, restaurantId, deliverySlot, orderDate)
    expect(count).toBe(1)
  })

  it('должен удалять все резервации для слота и возвращать telegram_user_id', () => {
    const u1 = userRepo.create({ telegram_user_id: 401, username: 'u401' })
    const u2 = userRepo.create({ telegram_user_id: 402, username: 'u402' })
    lobbyRepo.addReservation(buildingId, restaurantId, deliverySlot, orderDate, u1.id)
    lobbyRepo.addReservation(buildingId, restaurantId, deliverySlot, orderDate, u2.id)

    const telegramIds = lobbyRepo.deleteReservationsForSlot(
      buildingId,
      restaurantId,
      deliverySlot,
      orderDate,
    )
    expect(telegramIds).toContain(401)
    expect(telegramIds).toContain(402)
    expect(telegramIds.length).toBe(2)

    const count = lobbyRepo.countReservations(buildingId, restaurantId, deliverySlot, orderDate)
    expect(count).toBe(0)
  })
})
