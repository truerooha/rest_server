// Типы для проекта "Обед в Офис"

export interface Restaurant {
  id: number
  name: string
  chat_id: number
  min_order_amount?: number
  created_at: string
}

export interface MenuItem {
  id: number
  restaurant_id: number
  name: string
  price: number
  description?: string
  category?: string
  is_breakfast: boolean
  is_available: boolean
  created_at: string
}

export interface Building {
  id: number
  name: string
  address: string
  created_at: string
}

export interface User {
  id: number
  telegram_user_id: number
  username?: string
  first_name?: string
  last_name?: string
  building_id?: number
  created_at: string
}

export interface Order {
  id: number
  user_id: number
  restaurant_id: number
  building_id: number
  items: string // JSON строка с массивом блюд
  total_price: number
  delivery_slot: string
  status: OrderStatus
  created_at: string
  updated_at: string
}

export type OrderStatus = 'pending' | 'confirmed' | 'preparing' | 'ready' | 'delivered' | 'cancelled'

export interface OrderItem {
  id: number
  name: string
  price: number
  quantity: number
}

export interface RestaurantBuilding {
  id: number
  restaurant_id: number
  building_id: number
  created_at: string
}

export interface MenuRecognitionResult {
  items: Array<{
    name: string
    price: number
    description?: string
    category?: string
  }>
}
