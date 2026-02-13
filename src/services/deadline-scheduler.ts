import Database from 'better-sqlite3'
import {
  OrderRepository,
  GroupOrderRepository,
  RestaurantRepository,
  BuildingRepository,
  LobbyRepository,
} from '../db/repository'
import { ORDER_CONFIG } from '../utils/order-config'
import { logger } from '../utils/logger'
import { getTodayInAppTz, getNowMinutesInAppTz } from '../utils/timezone'

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

const lobbyLeadMinutes = ORDER_CONFIG.lobbyLeadMinutes ?? ORDER_CONFIG.orderLeadMinutes
const minLobbyParticipants = ORDER_CONFIG.minLobbyParticipants ?? 1

/** Проверяет, прошёл ли дедлайн лобби для слота */
function isLobbyDeadlinePassed(slotId: string, nowMinutes: number): boolean {
  const slotMinutes = toMinutes(slotId)
  const lobbyDeadlineMinutes = Math.max(slotMinutes - lobbyLeadMinutes, 0)
  return nowMinutes > lobbyDeadlineMinutes
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

export type NotifyLobbyCancelledFn = (telegramUserId: number, slotTime: string) => Promise<void>

/**
 * Запускает периодическую проверку дедлайнов слотов.
 * При наступлении дедлайна агрегирует confirmed-заказы в group_order
 * и отправляет в админ-бот соответствующему ресторану.
 * Также обрабатывает дедлайн лобби: при недоборе минимума снимает брони и уведомляет участников.
 */
export function startDeadlineScheduler(
  db: Database.Database,
  sendGroupOrder: SendGroupOrderFn,
  intervalMs = 60_000,
  notifyLobbyCancelled?: NotifyLobbyCancelledFn,
): () => void {
  const orderRepo = new OrderRepository(db)
  const groupOrderRepo = new GroupOrderRepository(db)
  const restaurantRepo = new RestaurantRepository(db)
  const buildingRepo = new BuildingRepository(db)
  const lobbyRepo = new LobbyRepository(db)

  function processLobbyDeadlines(): void {
    const nowMinutes = getNowMinutesInAppTz()
    const today = getTodayInAppTz()

    const pairs = db
      .prepare('SELECT DISTINCT building_id, restaurant_id FROM restaurant_buildings')
      .all() as Array<{ building_id: number; restaurant_id: number }>

    for (const slot of ORDER_CONFIG.deliverySlots) {
      if (!isLobbyDeadlinePassed(slot.id, nowMinutes)) continue

      for (const { building_id, restaurant_id } of pairs) {
        const count = lobbyRepo.countReservations(building_id, restaurant_id, slot.id, today)
        if (count >= minLobbyParticipants) continue
        if (count === 0) continue

        const telegramIds = lobbyRepo.deleteReservationsForSlot(
          building_id,
          restaurant_id,
          slot.id,
          today,
        )
        logger.info('Лобби слота отменено по недобору', {
          slot: slot.id,
          buildingId: building_id,
          restaurantId: restaurant_id,
          hadParticipants: count,
          minRequired: minLobbyParticipants,
        })
        for (const tgId of telegramIds) {
          notifyLobbyCancelled?.(tgId, slot.time).catch((err) => {
            logger.error('Не удалось уведомить об отмене лобби', { telegramUserId: tgId, error: err })
          })
        }
      }
    }
  }

  async function processSlotDeadlines(): Promise<void> {
    const nowMinutes = getNowMinutesInAppTz()
    const today = getTodayInAppTz()

    for (const slot of ORDER_CONFIG.deliverySlots) {
      if (!isDeadlinePassedForSlot(slot.id, nowMinutes)) continue

      const distinctGroups = db
        .prepare(
          `
          SELECT DISTINCT restaurant_id, building_id
          FROM orders
          WHERE delivery_slot = ? AND status = 'pending' AND (order_date = ? OR (order_date IS NULL AND date(created_at) = ?))
        `,
        )
        .all(slot.id, today, today) as Array<{ restaurant_id: number; building_id: number }>

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

  function runAll(): void {
    processLobbyDeadlines()
    processSlotDeadlines().catch((err) => {
      logger.error('Ошибка в deadline scheduler', { error: err })
    })
  }

  const timer = setInterval(runAll, intervalMs)

  runAll()

  return () => clearInterval(timer)
}
