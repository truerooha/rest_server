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
