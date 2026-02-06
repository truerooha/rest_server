import type Database from 'better-sqlite3'

export type UserCredit = {
  id: number
  user_id: number
  amount: number
  created_at: string
  updated_at: string
}

export type CreditTransaction = {
  id: number
  user_id: number
  amount: number
  type: 'earn' | 'spend' | 'refund'
  description: string | null
  order_id: number | null
  created_at: string
}

export class CreditRepository {
  private db: Database.Database

  constructor(db: Database.Database) {
    this.db = db
  }

  findByUserId(userId: number): UserCredit | null {
    const stmt = this.db.prepare('SELECT * FROM user_credits WHERE user_id = ?')
    return stmt.get(userId) as UserCredit | null
  }

  initializeForUser(userId: number): UserCredit {
    const existing = this.findByUserId(userId)
    if (existing) {
      return existing
    }

    const stmt = this.db.prepare(`
      INSERT INTO user_credits (user_id, amount)
      VALUES (?, 0)
    `)
    stmt.run(userId)
    return this.findByUserId(userId) as UserCredit
  }

  adjustBalance(
    userId: number,
    amount: number,
    type: 'earn' | 'spend' | 'refund',
    description: string,
    orderId?: number,
  ): UserCredit {
    const credit = this.initializeForUser(userId)

    // Обновляем баланс
    const newAmount = credit.amount + amount
    if (newAmount < 0) {
      throw new Error('Insufficient credits')
    }

    const updateStmt = this.db.prepare(`
      UPDATE user_credits
      SET amount = ?, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `)
    updateStmt.run(newAmount, userId)

    // Записываем транзакцию
    const transactionStmt = this.db.prepare(`
      INSERT INTO credit_transactions (user_id, amount, type, description, order_id)
      VALUES (?, ?, ?, ?, ?)
    `)
    transactionStmt.run(userId, amount, type, description, orderId ?? null)

    return this.findByUserId(userId) as UserCredit
  }

  getTransactions(userId: number, limit: number = 50): CreditTransaction[] {
    const stmt = this.db.prepare(`
      SELECT * FROM credit_transactions
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `)
    return stmt.all(userId, limit) as CreditTransaction[]
  }
}
