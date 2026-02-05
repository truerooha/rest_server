// Типы для проекта "Обед в Офис"

export interface Restaurant {
  id: number
  name: string
  chat_id: number
  created_at: string
}

export interface MenuItem {
  id: number
  restaurant_id: number
  name: string
  price: number
  description?: string
  category?: string
  is_available: boolean
  created_at: string
}

export interface MenuRecognitionResult {
  items: Array<{
    name: string
    price: number
    description?: string
  }>
}
