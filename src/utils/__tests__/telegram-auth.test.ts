import { describe, it, expect } from 'vitest'
import { createHmac } from 'crypto'
import { verifyTelegramInitData } from '../telegram-auth'

const TEST_BOT_TOKEN = '7777777777:AAFtest-fake-token-for-unit-tests'

function generateInitData(
  user: { id: number; username?: string; first_name?: string },
  botToken: string,
  overrides?: { authDate?: number; extraParams?: Record<string, string>; tamperHash?: boolean },
): string {
  const params = new URLSearchParams()
  params.set('user', JSON.stringify(user))
  params.set('auth_date', String(overrides?.authDate ?? Math.floor(Date.now() / 1000)))
  if (overrides?.extraParams) {
    for (const [k, v] of Object.entries(overrides.extraParams)) {
      params.set(k, v)
    }
  }

  const entries = [...params.entries()].sort(([a], [b]) => a.localeCompare(b))
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n')

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest()
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex')

  params.set('hash', overrides?.tamperHash ? 'a'.repeat(64) : hash)
  return params.toString()
}

describe('verifyTelegramInitData', () => {
  const user = { id: 123456, username: 'testuser', first_name: 'Test' }

  it('верифицирует валидный initData и возвращает пользователя', () => {
    const initData = generateInitData(user, TEST_BOT_TOKEN)
    const result = verifyTelegramInitData(initData, TEST_BOT_TOKEN)

    expect(result).not.toBeNull()
    expect(result!.telegramUserId).toBe(123456)
    expect(result!.username).toBe('testuser')
    expect(result!.firstName).toBe('Test')
  })

  it('отклоняет initData с невалидным hash', () => {
    const initData = generateInitData(user, TEST_BOT_TOKEN, { tamperHash: true })
    const result = verifyTelegramInitData(initData, TEST_BOT_TOKEN)
    expect(result).toBeNull()
  })

  it('отклоняет initData подписанный другим токеном', () => {
    const initData = generateInitData(user, 'other-token:AAFwrong')
    const result = verifyTelegramInitData(initData, TEST_BOT_TOKEN)
    expect(result).toBeNull()
  })

  it('отклоняет устаревший initData при maxAgeSeconds', () => {
    const oldAuthDate = Math.floor(Date.now() / 1000) - 7200 // 2 часа назад
    const initData = generateInitData(user, TEST_BOT_TOKEN, { authDate: oldAuthDate })
    const result = verifyTelegramInitData(initData, TEST_BOT_TOKEN, 3600) // max 1 час
    expect(result).toBeNull()
  })

  it('принимает свежий initData при maxAgeSeconds', () => {
    const recentAuthDate = Math.floor(Date.now() / 1000) - 60 // 1 минуту назад
    const initData = generateInitData(user, TEST_BOT_TOKEN, { authDate: recentAuthDate })
    const result = verifyTelegramInitData(initData, TEST_BOT_TOKEN, 3600)
    expect(result).not.toBeNull()
    expect(result!.telegramUserId).toBe(123456)
  })

  it('возвращает null при отсутствии hash', () => {
    const params = new URLSearchParams()
    params.set('user', JSON.stringify(user))
    params.set('auth_date', String(Math.floor(Date.now() / 1000)))
    const result = verifyTelegramInitData(params.toString(), TEST_BOT_TOKEN)
    expect(result).toBeNull()
  })

  it('возвращает null при отсутствии user', () => {
    const params = new URLSearchParams()
    params.set('auth_date', String(Math.floor(Date.now() / 1000)))
    // Генерируем валидный hash, но без user
    const entries = [...params.entries()].sort(([a], [b]) => a.localeCompare(b))
    const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n')
    const secretKey = createHmac('sha256', 'WebAppData').update(TEST_BOT_TOKEN).digest()
    const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex')
    params.set('hash', hash)

    const result = verifyTelegramInitData(params.toString(), TEST_BOT_TOKEN)
    expect(result).toBeNull()
  })

  it('возвращает null при пустых аргументах', () => {
    expect(verifyTelegramInitData('', TEST_BOT_TOKEN)).toBeNull()
    expect(verifyTelegramInitData('some=data', '')).toBeNull()
  })

  it('корректно обрабатывает дополнительные параметры в initData', () => {
    const initData = generateInitData(user, TEST_BOT_TOKEN, {
      extraParams: { query_id: 'AAHtest', chat_type: 'sender' },
    })
    const result = verifyTelegramInitData(initData, TEST_BOT_TOKEN)
    expect(result).not.toBeNull()
    expect(result!.telegramUserId).toBe(123456)
  })
})
