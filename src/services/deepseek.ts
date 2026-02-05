import OpenAI from 'openai'
import { MenuRecognitionResult } from '../types'

export class DeepSeekService {
  private client: OpenAI

  constructor(apiKey: string) {
    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://api.deepseek.com',
    })
  }

  async recognizeMenuFromImage(imageUrl: string): Promise<MenuRecognitionResult> {
    try {
      const response = await this.client.chat.completions.create({
        model: 'deepseek-chat',
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
                       Цены указывай числом без символа рубля. Если цена не указана - пропусти блюдо.`,
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
        temperature: 0.3,
      })

      const content = response.choices[0]?.message?.content
      if (!content) {
        throw new Error('DeepSeek вернул пустой ответ')
      }

      // Парсим JSON из ответа
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        throw new Error('DeepSeek не вернул JSON: ' + content)
      }

      const result = JSON.parse(jsonMatch[0]) as MenuRecognitionResult

      if (!result.items || !Array.isArray(result.items)) {
        throw new Error('Неверный формат ответа от DeepSeek')
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
