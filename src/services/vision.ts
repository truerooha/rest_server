import OpenAI from 'openai'
import { MenuRecognitionResult } from '../types'

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
Извлеки все блюда, их цены и описания (если есть).
Верни результат СТРОГО в JSON формате:
{
  "items": [
    {"name": "Название блюда", "price": 180, "description": "Описание (опционально)"}
  ]
}

Цены указывай числом без символа рубля. Если цена не указана - пропусти блюдо.
Если на изображении несколько блюд, верни все.`,
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
        max_tokens: 2000,
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

      return result
    } catch (error) {
      console.error('Ошибка распознавания меню:', error)
      throw new Error(
        'Не удалось распознать меню. Попробуйте другое фото или проверьте что на нём чётко видны названия блюд и цены.'
      )
    }
  }
}
