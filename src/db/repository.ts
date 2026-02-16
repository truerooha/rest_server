import Database from 'better-sqlite3'
import {
  Restaurant,
  MenuItem,
  Building,
  User,
  Order,
  OrderItem,
  RestaurantBuilding,
  OrderStatus,
  GroupOrder,
  GroupOrderStatus,
} from '../types'
import { getTodayInAppTz } from '../utils/timezone'

export class RestaurantRepository {
  constructor(private db: Database.Database) {}

  findOrCreateByChatId(chatId: number, name: string): Restaurant {
    const existing = this.db
      .prepare('SELECT * FROM restaurants WHERE chat_id = ?')
      .get(chatId) as Restaurant | undefined

    if (existing) {
      return existing
    }

    const result = this.db
      .prepare('INSERT INTO restaurants (chat_id, name) VALUES (?, ?)')
      .run(chatId, name)

    return {
      id: result.lastInsertRowid as number,
      chat_id: chatId,
      name,
      created_at: new Date().toISOString(),
    }
  }

  create(restaurant: Omit<Restaurant, 'id' | 'created_at'>): Restaurant {
    const result = this.db
      .prepare('INSERT INTO restaurants (name, chat_id) VALUES (?, ?)')
      .run(restaurant.name, restaurant.chat_id)

    return {
      id: result.lastInsertRowid as number,
      name: restaurant.name,
      chat_id: restaurant.chat_id,
      created_at: new Date().toISOString(),
    }
  }

  findByChatId(chatId: number): Restaurant | undefined {
    return this.db
      .prepare('SELECT * FROM restaurants WHERE chat_id = ?')
      .get(chatId) as Restaurant | undefined
  }

  findById(id: number): Restaurant | undefined {
    return this.db
      .prepare('SELECT * FROM restaurants WHERE id = ?')
      .get(id) as Restaurant | undefined
  }

  updateSbpLink(id: number, sbpLink: string): void {
    this.db
      .prepare('UPDATE restaurants SET sbp_link = ? WHERE id = ?')
      .run(sbpLink, id)
  }
}

export class MenuRepository {
  constructor(private db: Database.Database) {}

  createItem(item: Omit<MenuItem, 'id' | 'created_at'>): MenuItem {
    const result = this.db
      .prepare(`
        INSERT INTO menu_items (restaurant_id, name, price, description, category, is_breakfast, is_available)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        item.restaurant_id,
        item.name,
        item.price,
        item.description || null,
        item.category || null,
        item.is_breakfast ? 1 : 0,
        item.is_available ? 1 : 0
      )

    return {
      ...item,
      id: result.lastInsertRowid as number,
      created_at: new Date().toISOString(),
    }
  }

  findByRestaurantId(restaurantId: number): MenuItem[] {
    return this.db
      .prepare('SELECT * FROM menu_items WHERE restaurant_id = ? ORDER BY category, name')
      .all(restaurantId) as MenuItem[]
  }

  findBreakfastsByRestaurantId(restaurantId: number): MenuItem[] {
    return this.db
      .prepare('SELECT * FROM menu_items WHERE restaurant_id = ? AND is_breakfast = 1 ORDER BY name')
      .all(restaurantId) as MenuItem[]
  }

  findByCategoryAndRestaurantId(category: string, restaurantId: number): MenuItem[] {
    return this.db
      .prepare('SELECT * FROM menu_items WHERE restaurant_id = ? AND category = ? ORDER BY name')
      .all(restaurantId, category) as MenuItem[]
  }

  getAllCategories(restaurantId: number): string[] {
    const result = this.db
      .prepare('SELECT DISTINCT category FROM menu_items WHERE restaurant_id = ? AND category IS NOT NULL ORDER BY category')
      .all(restaurantId) as Array<{ category: string }>
    
    return result.map(r => r.category)
  }

  deleteAllByRestaurantId(restaurantId: number): void {
    this.db
      .prepare('DELETE FROM menu_items WHERE restaurant_id = ?')
      .run(restaurantId)
  }

  findById(id: number): MenuItem | undefined {
    return this.db
      .prepare('SELECT * FROM menu_items WHERE id = ?')
      .get(id) as MenuItem | undefined
  }

  updateItem(id: number, updates: Partial<Omit<MenuItem, 'id' | 'created_at' | 'restaurant_id'>>): void {
    const fields: string[] = []
    const values: any[] = []

    if (updates.name !== undefined) {
      fields.push('name = ?')
      values.push(updates.name)
    }
    if (updates.price !== undefined) {
      fields.push('price = ?')
      values.push(updates.price)
    }
    if (updates.description !== undefined) {
      fields.push('description = ?')
      values.push(updates.description)
    }
    if (updates.category !== undefined) {
      fields.push('category = ?')
      values.push(updates.category)
    }
    if (updates.is_breakfast !== undefined) {
      fields.push('is_breakfast = ?')
      values.push(updates.is_breakfast ? 1 : 0)
    }
    if (updates.is_available !== undefined) {
      fields.push('is_available = ?')
      values.push(updates.is_available ? 1 : 0)
    }
    if (updates.image_url !== undefined) {
      fields.push('image_url = ?')
      values.push(updates.image_url)
    }

    if (fields.length === 0) return

    values.push(id)
    this.db
      .prepare(`UPDATE menu_items SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values)
  }

  deleteItem(id: number): void {
    this.db
      .prepare('DELETE FROM menu_items WHERE id = ?')
      .run(id)
  }

  /** Переименовывает категорию для всех блюд ресторана. Возвращает количество обновлённых записей. */
  renameCategory(restaurantId: number, oldCategory: string, newCategory: string): number {
    const result = this.db
      .prepare('UPDATE menu_items SET category = ? WHERE restaurant_id = ? AND category = ?')
      .run(newCategory.trim(), restaurantId, oldCategory)
    return result.changes
  }

  toggleAvailability(id: number): void {
    this.db
      .prepare('UPDATE menu_items SET is_available = NOT is_available WHERE id = ?')
      .run(id)
  }

  findAvailableByRestaurantId(restaurantId: number): MenuItem[] {
    return this.db
      .prepare('SELECT * FROM menu_items WHERE restaurant_id = ? AND is_available = 1 ORDER BY category, name')
      .all(restaurantId) as MenuItem[]
  }

  findUnavailableByRestaurantId(restaurantId: number): MenuItem[] {
    return this.db
      .prepare('SELECT * FROM menu_items WHERE restaurant_id = ? AND is_available = 0 ORDER BY category, name')
      .all(restaurantId) as MenuItem[]
  }
}

export class BuildingRepository {
  constructor(private db: Database.Database) {}

  create(building: Omit<Building, 'id' | 'created_at'>): Building {
    const result = this.db
      .prepare('INSERT INTO buildings (name, address) VALUES (?, ?)')
      .run(building.name, building.address)

    return {
      ...building,
      id: result.lastInsertRowid as number,
      created_at: new Date().toISOString(),
    }
  }

  findAll(): Building[] {
    return this.db
      .prepare('SELECT * FROM buildings ORDER BY name')
      .all() as Building[]
  }

  findById(id: number): Building | undefined {
    return this.db
      .prepare('SELECT * FROM buildings WHERE id = ?')
      .get(id) as Building | undefined
  }

  update(id: number, updates: Partial<Omit<Building, 'id' | 'created_at'>>): void {
    const fields: string[] = []
    const values: any[] = []

    if (updates.name !== undefined) {
      fields.push('name = ?')
      values.push(updates.name)
    }
    if (updates.address !== undefined) {
      fields.push('address = ?')
      values.push(updates.address)
    }

    if (fields.length === 0) return

    values.push(id)
    this.db
      .prepare(`UPDATE buildings SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values)
  }

  delete(id: number): void {
    this.db
      .prepare('DELETE FROM buildings WHERE id = ?')
      .run(id)
  }
}

export class UserRepository {
  constructor(private db: Database.Database) {}

  create(user: Omit<User, 'id' | 'created_at'>): User {
    const result = this.db
      .prepare(`
        INSERT INTO users (telegram_user_id, username, first_name, last_name, building_id)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(
        user.telegram_user_id,
        user.username || null,
        user.first_name || null,
        user.last_name || null,
        user.building_id || null
      )

    return {
      ...user,
      id: result.lastInsertRowid as number,
      created_at: new Date().toISOString(),
    }
  }

  findByTelegramId(telegramUserId: number): User | undefined {
    return this.db
      .prepare('SELECT * FROM users WHERE telegram_user_id = ?')
      .get(telegramUserId) as User | undefined
  }

  findOrCreate(user: Omit<User, 'id' | 'created_at'>): User {
    const existing = this.findByTelegramId(user.telegram_user_id)
    if (existing) {
      return existing
    }
    return this.create(user)
  }

  findById(id: number): User | undefined {
    return this.db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(id) as User | undefined
  }

  updateBuilding(telegramUserId: number, buildingId: number): void {
    this.db
      .prepare('UPDATE users SET building_id = ? WHERE telegram_user_id = ?')
      .run(buildingId, telegramUserId)
  }

  update(id: number, updates: Partial<Omit<User, 'id' | 'created_at' | 'telegram_user_id'>>): void {
    const fields: string[] = []
    const values: any[] = []

    if (updates.username !== undefined) {
      fields.push('username = ?')
      values.push(updates.username)
    }
    if (updates.first_name !== undefined) {
      fields.push('first_name = ?')
      values.push(updates.first_name)
    }
    if (updates.last_name !== undefined) {
      fields.push('last_name = ?')
      values.push(updates.last_name)
    }
    if (updates.building_id !== undefined) {
      fields.push('building_id = ?')
      values.push(updates.building_id)
    }

    if (fields.length === 0) return

    values.push(id)
    this.db
      .prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values)
  }
}

export class OrderRepository {
  constructor(private db: Database.Database) {}

  create(order: Omit<Order, 'id' | 'created_at' | 'updated_at' | 'order_date'>): Order {
    const orderDate = getTodayInAppTz()
    const result = this.db
      .prepare(`
        INSERT INTO orders (user_id, restaurant_id, building_id, items, total_price, delivery_slot, status, order_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        order.user_id,
        order.restaurant_id,
        order.building_id,
        order.items,
        order.total_price,
        order.delivery_slot,
        order.status,
        orderDate,
      )

    return {
      ...order,
      id: result.lastInsertRowid as number,
      order_date: orderDate,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  findById(id: number): Order | undefined {
    return this.db
      .prepare('SELECT * FROM orders WHERE id = ?')
      .get(id) as Order | undefined
  }

  findByUserId(userId: number): Order[] {
    return this.db
      .prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC')
      .all(userId) as Order[]
  }

  findByRestaurantId(restaurantId: number): Order[] {
    return this.db
      .prepare('SELECT * FROM orders WHERE restaurant_id = ? ORDER BY created_at DESC')
      .all(restaurantId) as Order[]
  }

  findByStatus(status: OrderStatus): Order[] {
    return this.db
      .prepare('SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC')
      .all(status) as Order[]
  }
  findBySlotAndBuilding(
    deliverySlot: string,
    buildingId: number,
    restaurantId: number,
    orderDate: string,
  ): Order[] {
    return this.db
      .prepare(`
        SELECT * FROM orders
        WHERE delivery_slot = ?
          AND building_id = ?
          AND restaurant_id = ?
          AND status IN ('pending', 'restaurant_confirmed', 'preparing', 'ready', 'delivered')
          AND (order_date = ? OR (order_date IS NULL AND date(created_at) = ?))
        ORDER BY created_at DESC
      `)
      .all(deliverySlot, buildingId, restaurantId, orderDate, orderDate) as Order[]
  }

  /** Заказы для агрегации при дедлайне: pending по слоту/зданию/ресторану на дату [ВРЕМЕННО без оплаты] */
  findPendingForGroup(
    deliverySlot: string,
    buildingId: number,
    restaurantId: number,
    orderDate: string,
  ): Order[] {
    return this.db
      .prepare(`
        SELECT * FROM orders
        WHERE delivery_slot = ?
          AND building_id = ?
          AND restaurant_id = ?
          AND status = 'pending'
          AND (order_date = ? OR (order_date IS NULL AND date(created_at) = ?))
        ORDER BY created_at DESC
      `)
      .all(deliverySlot, buildingId, restaurantId, orderDate, orderDate) as Order[]
  }

  updateStatusBatch(orderIds: number[], status: OrderStatus): void {
    const stmt = this.db.prepare('UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    for (const id of orderIds) {
      stmt.run(status, id)
    }
  }

  /**
   * Найти активный заказ пользователя для конкретного слота/здания/ресторана.
   * Активные статусы: pending, confirmed, preparing, ready.
   * Используется для предотвращения повторного создания одинаковых заказов
   * при повторных нажатиях на кнопку подтверждения.
   */
  findActiveByUserAndSlot(
    userId: number,
    buildingId: number,
    restaurantId: number,
    deliverySlot: string,
    orderDate: string,
  ): Order | undefined {
    return this.db
      .prepare(
        `
        SELECT * FROM orders
        WHERE user_id = ?
          AND building_id = ?
          AND restaurant_id = ?
          AND delivery_slot = ?
          AND status IN ('pending', 'confirmed', 'restaurant_confirmed', 'preparing', 'ready')
          AND (order_date = ? OR (order_date IS NULL AND date(created_at) = ?))
        ORDER BY created_at DESC
        LIMIT 1
      `,
      )
      .get(userId, buildingId, restaurantId, deliverySlot, orderDate, orderDate) as Order | undefined
  }

  /** Слоты, где у пользователя есть заказ (любой статус кроме cancelled, для просмотра) */
  findUserOrderSlotsByBuildingRestaurant(
    userId: number,
    buildingId: number,
    restaurantId: number,
    orderDate: string,
  ): string[] {
    const rows = this.db
      .prepare(
        `
        SELECT DISTINCT delivery_slot FROM orders
        WHERE user_id = ?
          AND building_id = ?
          AND restaurant_id = ?
          AND status != 'cancelled'
          AND (order_date = ? OR (order_date IS NULL AND date(created_at) = ?))
      `,
      )
      .all(userId, buildingId, restaurantId, orderDate, orderDate) as { delivery_slot: string }[]
    return rows.map((r) => r.delivery_slot)
  }

  updateStatus(id: number, status: OrderStatus): void {
    this.db
      .prepare('UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(status, id)
  }

  // Получить заказы ресторана по статусу
  findByRestaurantIdAndStatus(restaurantId: number, status: OrderStatus): Order[] {
    return this.db
      .prepare('SELECT * FROM orders WHERE restaurant_id = ? AND status = ? ORDER BY created_at DESC')
      .all(restaurantId, status) as Order[]
  }

  // Получить активные заказы ресторана (не delivered и не cancelled)
  findActiveByRestaurantId(restaurantId: number): Order[] {
    return this.db
      .prepare(`
        SELECT * FROM orders 
        WHERE restaurant_id = ? AND status NOT IN ('delivered', 'cancelled')
        ORDER BY created_at DESC
      `)
      .all(restaurantId) as Order[]
  }
}

export class GroupOrderRepository {
  constructor(private db: Database.Database) {}

  create(data: Omit<GroupOrder, 'id' | 'created_at'>): GroupOrder {
    const result = this.db
      .prepare(
        `
        INSERT INTO group_orders (restaurant_id, building_id, delivery_slot, order_date, status)
        VALUES (?, ?, ?, ?, ?)
      `,
      )
      .run(data.restaurant_id, data.building_id, data.delivery_slot, data.order_date, data.status)
    return {
      ...data,
      id: result.lastInsertRowid as number,
      created_at: new Date().toISOString(),
    }
  }

  findById(id: number): GroupOrder | undefined {
    return this.db.prepare('SELECT * FROM group_orders WHERE id = ?').get(id) as GroupOrder | undefined
  }

  findByRestaurantAndSlot(
    restaurantId: number,
    buildingId: number,
    deliverySlot: string,
    orderDate: string,
  ): GroupOrder | undefined {
    return this.db
      .prepare(
        'SELECT * FROM group_orders WHERE restaurant_id = ? AND building_id = ? AND delivery_slot = ? AND order_date = ?',
      )
      .get(restaurantId, buildingId, deliverySlot, orderDate) as GroupOrder | undefined
  }

  findPendingByRestaurant(restaurantId: number): GroupOrder[] {
    return this.db
      .prepare(
        `SELECT * FROM group_orders WHERE restaurant_id = ? AND status = 'pending_restaurant' ORDER BY created_at DESC`,
      )
      .all(restaurantId) as GroupOrder[]
  }

  updateStatus(id: number, status: GroupOrderStatus): void {
    this.db.prepare('UPDATE group_orders SET status = ? WHERE id = ?').run(status, id)
  }
}

export class RestaurantBuildingRepository {
  constructor(private db: Database.Database) {}

  link(restaurantId: number, buildingId: number): RestaurantBuilding {
    const result = this.db
      .prepare('INSERT INTO restaurant_buildings (restaurant_id, building_id) VALUES (?, ?)')
      .run(restaurantId, buildingId)

    return {
      id: result.lastInsertRowid as number,
      restaurant_id: restaurantId,
      building_id: buildingId,
      created_at: new Date().toISOString(),
    }
  }

  unlink(restaurantId: number, buildingId: number): void {
    this.db
      .prepare('DELETE FROM restaurant_buildings WHERE restaurant_id = ? AND building_id = ?')
      .run(restaurantId, buildingId)
  }

  findRestaurantsByBuildingId(buildingId: number): Restaurant[] {
    return this.db
      .prepare(`
        SELECT r.* FROM restaurants r
        JOIN restaurant_buildings rb ON r.id = rb.restaurant_id
        WHERE rb.building_id = ?
        ORDER BY r.name
      `)
      .all(buildingId) as Restaurant[]
  }

  findBuildingsByRestaurantId(restaurantId: number): Building[] {
    return this.db
      .prepare(`
        SELECT b.* FROM buildings b
        JOIN restaurant_buildings rb ON b.id = rb.building_id
        WHERE rb.restaurant_id = ?
        ORDER BY b.name
      `)
      .all(restaurantId) as Building[]
  }
}

export class LobbyRepository {
  constructor(private db: Database.Database) {}

  addReservation(
    buildingId: number,
    restaurantId: number,
    deliverySlot: string,
    orderDate: string,
    userId: number,
  ): void {
    this.db
      .prepare(
        `
        INSERT OR IGNORE INTO slot_lobby_reservations (building_id, restaurant_id, delivery_slot, order_date, user_id)
        VALUES (?, ?, ?, ?, ?)
      `,
      )
      .run(buildingId, restaurantId, deliverySlot, orderDate, userId)
  }

  removeReservation(
    buildingId: number,
    restaurantId: number,
    deliverySlot: string,
    orderDate: string,
    userId: number,
  ): void {
    this.db
      .prepare(
        `
        DELETE FROM slot_lobby_reservations
        WHERE building_id = ? AND restaurant_id = ? AND delivery_slot = ? AND order_date = ? AND user_id = ?
      `,
      )
      .run(buildingId, restaurantId, deliverySlot, orderDate, userId)
  }

  countReservations(
    buildingId: number,
    restaurantId: number,
    deliverySlot: string,
    orderDate: string,
  ): number {
    const row = this.db
      .prepare(
        `
        SELECT COUNT(*) as count FROM slot_lobby_reservations
        WHERE building_id = ? AND restaurant_id = ? AND delivery_slot = ? AND order_date = ?
      `,
      )
      .get(buildingId, restaurantId, deliverySlot, orderDate) as { count: number }
    return row.count
  }

  hasUserReservation(
    telegramUserId: number,
    buildingId: number,
    restaurantId: number,
    deliverySlot: string,
    orderDate: string,
  ): boolean {
    const row = this.db
      .prepare(
        `
        SELECT COUNT(*) as count FROM slot_lobby_reservations r
        JOIN users u ON r.user_id = u.id
        WHERE u.telegram_user_id = ? AND r.building_id = ? AND r.restaurant_id = ? AND r.delivery_slot = ? AND r.order_date = ?
      `,
      )
      .get(telegramUserId, buildingId, restaurantId, deliverySlot, orderDate) as { count: number }
    return row.count > 0
  }

  deleteReservationsForSlot(
    buildingId: number,
    restaurantId: number,
    deliverySlot: string,
    orderDate: string,
  ): number[] {
    const rows = this.db
      .prepare(
        `
        SELECT u.telegram_user_id FROM slot_lobby_reservations r
        JOIN users u ON r.user_id = u.id
        WHERE r.building_id = ? AND r.restaurant_id = ? AND r.delivery_slot = ? AND r.order_date = ?
      `,
      )
      .all(buildingId, restaurantId, deliverySlot, orderDate) as { telegram_user_id: number }[]
    const telegramIds = rows.map((r) => r.telegram_user_id)
    this.db
      .prepare(
        `
        DELETE FROM slot_lobby_reservations
        WHERE building_id = ? AND restaurant_id = ? AND delivery_slot = ? AND order_date = ?
      `,
      )
      .run(buildingId, restaurantId, deliverySlot, orderDate)
    return telegramIds
  }
}
