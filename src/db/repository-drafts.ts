import type Database from 'better-sqlite3'

export type UserDraft = {
  telegram_user_id: number
  delivery_slot: string | null
  restaurant_id: number | null
  building_id: number | null
  items: string
  updated_at: string
}

export class DraftRepository {
  constructor(private db: Database.Database) {}

  findByTelegramId(telegramUserId: number): UserDraft | null {
    const row = this.db
      .prepare('SELECT * FROM user_drafts WHERE telegram_user_id = ?')
      .get(telegramUserId) as UserDraft | undefined
    return row ?? null
  }

  put(draft: {
    telegram_user_id: number
    delivery_slot?: string | null
    restaurant_id?: number | null
    building_id?: number | null
    items: string
  }): UserDraft {
    this.db
      .prepare(
        `
      INSERT INTO user_drafts (telegram_user_id, delivery_slot, restaurant_id, building_id, items, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(telegram_user_id) DO UPDATE SET
        delivery_slot = excluded.delivery_slot,
        restaurant_id = excluded.restaurant_id,
        building_id = excluded.building_id,
        items = excluded.items,
        updated_at = CURRENT_TIMESTAMP
      `,
      )
      .run(
        draft.telegram_user_id,
        draft.delivery_slot ?? null,
        draft.restaurant_id ?? null,
        draft.building_id ?? null,
        draft.items,
      )
    return this.findByTelegramId(draft.telegram_user_id)!
  }

  delete(telegramUserId: number): void {
    this.db.prepare('DELETE FROM user_drafts WHERE telegram_user_id = ?').run(telegramUserId)
  }
}
