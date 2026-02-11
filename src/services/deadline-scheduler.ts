import Database from 'better-sqlite3'
import { OrderRepository, GroupOrderRepository, RestaurantRepository, BuildingRepository } from '../db/repository'
import { ORDER_CONFIG } from '../utils/order-config'
import { logger } from '../utils/logger'

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

/** Проверяет, прошёл ли дедлайн для слота на текущую дату */
function isDeadlinePassedForSlot(slotId: string, nowMinutes: number): boolean {
  const slotMinutes = toMinutes(slotId)
  const deadlineMinutes = Math.max(slotMinutes - ORDER_CONFIG.orderLeadMinutes, 0)
  return nowMinutes > deadlineMinutes
}

/** Получить дату в локальном формате YYYY-MM-DD */
function getTodayLocal(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export type SendGroupOrderFn = (params: {
  restaurantChatId: number
  restaurantName: string
  buildingName: string
  deliverySlot: string
  groupOrderId: number
  orders: Array<{
    id: number
    userId: number
    totalPrice: number
    items: string
    userName?: string
  }>
  totalAmount: number
  participantCount: number
}) => Promise<void>

/**
 * Запускает периодическую проверку дедлайнов слотов.
 * При наступлении дедлайна агрегирует confirmed-заказы в group_order
 * и отправляет в админ-бот соответствующему ресторану.
 */
export function startDeadlineScheduler(
  db: Database.Database,
  sendGroupOrder: SendGroupOrderFn,
  intervalMs = 60_000,
): () => void {
  const orderRepo = new OrderRepository(db)
  const groupOrderRepo = new GroupOrderRepository(db)
  const restaurantRepo = new RestaurantRepository(db)
  const buildingRepo = new BuildingRepository(db)

  async function processSlotDeadlines(): Promise<void> {
    const now = new Date()
    const nowMinutes = now.getHours() * 60 + now.getMinutes()
    const today = getTodayLocal()

    for (const slot of ORDER_CONFIG.deliverySlots) {
      if (!isDeadlinePassedForSlot(slot.id, nowMinutes)) continue

      const distinctGroups = db
        .prepare(
          `
          SELECT DISTINCT restaurant_id, building_id
          FROM orders
          WHERE delivery_slot = ? AND status = 'pending' AND date(created_at) = ?
        `,
        )
        .all(slot.id, today) as Array<{ restaurant_id: number; building_id: number }>

      for (const { restaurant_id, building_id } of distinctGroups) {
        const existing = groupOrderRepo.findByRestaurantAndSlot(
          restaurant_id,
          building_id,
          slot.id,
          today,
        )
        if (existing) continue

        const orders = orderRepo.findPendingForGroup(slot.id, building_id, restaurant_id, today)
        if (orders.length === 0) continue

        const restaurant = restaurantRepo.findById(restaurant_id)
        const building = buildingRepo.findById(building_id)
        if (!restaurant || !building) continue

        const groupOrder = groupOrderRepo.create({
          restaurant_id,
          building_id,
          delivery_slot: slot.id,
          order_date: today,
          status: 'pending_restaurant',
        })

        logger.info('Создан общий заказ по дедлайну', {
          groupOrderId: groupOrder.id,
          slot: slot.id,
          restaurantId: restaurant_id,
          buildingId: building_id,
          orderCount: orders.length,
        })

        try {
          await sendGroupOrder({
            restaurantChatId: restaurant.chat_id,
            restaurantName: restaurant.name,
            buildingName: building.name,
            deliverySlot: slot.id,
            groupOrderId: groupOrder.id,
            orders: orders.map((o) => ({
              id: o.id,
              userId: o.user_id,
              totalPrice: o.total_price,
              items: o.items,
            })),
            totalAmount: orders.reduce((s, o) => s + o.total_price, 0),
            participantCount: orders.length,
          })
        } catch (err) {
          logger.error('Не удалось отправить общий заказ в админ-бот', {
            groupOrderId: groupOrder.id,
            error: err,
          })
        }
      }
    }
  }

  const timer = setInterval(() => {
    processSlotDeadlines().catch((err) => {
      logger.error('Ошибка в deadline scheduler', { error: err })
    })
  }, intervalMs)

  processSlotDeadlines().catch((err) => {
    logger.error('Ошибка при первом запуске deadline scheduler', { error: err })
  })

  return () => clearInterval(timer)
}
