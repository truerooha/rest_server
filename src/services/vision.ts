import OpenAI from 'openai'
import { MenuRecognitionResult } from '../types'
import { MENU_CATEGORIES, detectCategory, isBreakfastDish } from '../db/constants'

export class VisionService {
  private client: OpenAI

  constructor(apiKey: string) {
    this.client = new OpenAI({
      apiKey,
    })
  }

  async recognizeMenuFromImage(imageUrl: string): Promise<MenuRecognitionResult> {
    try {
      const response = await this.client.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Распознай меню ресторана на этой фотографии. 
Извлеки все блюда, их цены, описания и категории (если указаны).

Стандартные категории меню:
- Завтраки (каши, яичницы, омлеты, сырники, блины)
- Закуски (брускетты, холодные/горячие закуски)
- Салаты
- Супы
- Пицца
- Паста
- Ризотто
- Горячие блюда (стейки, мясо, рыба)
- Десерты

Верни результат СТРОГО в JSON формате:
{
  "items": [
    {
      "name": "Название блюда", 
      "price": 180, 
      "description": "Описание (если есть)",
      "category": "Категория (если указана на фото или можно определить)"
    }
  ]
}

ВАЖНО:
- Цены указывай числом без символа рубля
- Если цена не указана - пропусти блюдо
- Если категория указана на фото (например, "Завтраки", "Супы") - используй её
- Если категория НЕ указана явно, но можно определить по названию блюда - укажи подходящую категорию
- Если на изображении несколько блюд, верни все`,
              },
              {
                type: 'image_url',
                image_url: {
                  url: imageUrl,
                },
              },
            ],
          },
        ],
        max_tokens: 3000,
        temperature: 0.3,
      })

      const content = response.choices[0]?.message?.content
      if (!content) {
        throw new Error('GPT-4 Vision вернул пустой ответ')
      }

      // Парсим JSON из ответа
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        throw new Error('GPT-4 Vision не вернул JSON: ' + content)
      }

      const result = JSON.parse(jsonMatch[0]) as MenuRecognitionResult

      if (!result.items || !Array.isArray(result.items)) {
        throw new Error('Неверный формат ответа от GPT-4 Vision')
      }

      // Постобработка: если категория не определена, используем автоопределение
      result.items = result.items.map(item => ({
        ...item,
        category: item.category || detectCategory(item.name) || undefined
      }))

      return result
    } catch (error) {
      console.error('Ошибка распознавания меню:', error)
      throw new Error(
        'Не удалось распознать меню. Попробуйте другое фото или проверьте что на нём чётко видны названия блюд и цены.'
      )
    }
  }

  /**
   * Определяет категории для блюд с помощью AI
   * Используется как fallback, когда автоопределение не сработало
   */
  async enrichWithCategories(items: Array<{ name: string; description?: string }>): Promise<Array<{ name: string; category: string }>> {
    try {
      const itemsList = items.map((item, idx) => 
        `${idx + 1}. ${item.name}${item.description ? ` (${item.description})` : ''}`
      ).join('\n')

      const response = await this.client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Ты - эксперт по классификации блюд ресторанного меню.
Твоя задача - определить категорию для каждого блюда.

Используй только эти категории:
- Завтраки (каши, яичницы, омлеты, сырники, блины, творог)
- Закуски (брускетты, холодные/горячие закуски, антипасти)
- Салаты
- Супы (любые первые блюда)
- Пицца
- Паста (спагетти, пенне, феттучине и т.д.)
- Ризотто
- Горячие блюда (стейки, мясо, рыба, птица на гриле)
- Десерты

Верни результат СТРОГО в JSON формате:
{
  "items": [
    {"name": "Название блюда", "category": "Категория"}
  ]
}`
          },
          {
            role: 'user',
            content: `Определи категории для этих блюд:\n\n${itemsList}`
          }
        ],
        max_tokens: 1500,
        temperature: 0.2,
      })

      const content = response.choices[0]?.message?.content
      if (!content) {
        throw new Error('AI не вернул ответ')
      }

      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        throw new Error('AI не вернул JSON')
      }

      const result = JSON.parse(jsonMatch[0]) as { items: Array<{ name: string; category: string }> }
      return result.items || []
    } catch (error) {
      console.error('Ошибка определения категорий через AI:', error)
      // Fallback: используем автоопределение
      return items.map(item => ({
        name: item.name,
        category: detectCategory(item.name) || 'Горячие блюда'
      }))
    }
  }

  /**
   * Обогащает данные блюд категориями и признаком завтрака
   */
  enrichMenuItems(items: MenuRecognitionResult['items']): Array<{
    name: string
    price: number
    description?: string
    category: string
    is_breakfast: boolean
  }> {
    return items.map(item => {
      const category = item.category || detectCategory(item.name) || 'Горячие блюда'
      const isBreakfast = isBreakfastDish(item.name) || category === MENU_CATEGORIES.BREAKFAST

      return {
        name: item.name,
        price: item.price,
        description: item.description,
        category,
        is_breakfast: isBreakfast
      }
    })
  }
}
