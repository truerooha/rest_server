import Database from 'better-sqlite3'
import { Restaurant, MenuItem } from '../types'

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

  findByChatId(chatId: number): Restaurant | undefined {
    return this.db
      .prepare('SELECT * FROM restaurants WHERE chat_id = ?')
      .get(chatId) as Restaurant | undefined
  }
}

export class MenuRepository {
  constructor(private db: Database.Database) {}

  createItem(item: Omit<MenuItem, 'id' | 'created_at'>): MenuItem {
    const result = this.db
      .prepare(`
        INSERT INTO menu_items (restaurant_id, name, price, description, category, is_available)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(
        item.restaurant_id,
        item.name,
        item.price,
        item.description || null,
        item.category || null,
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

  deleteAllByRestaurantId(restaurantId: number): void {
    this.db
      .prepare('DELETE FROM menu_items WHERE restaurant_id = ?')
      .run(restaurantId)
  }
}
