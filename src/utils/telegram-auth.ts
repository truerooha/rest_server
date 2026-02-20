import { createHmac, timingSafeEqual } from 'crypto'

export type TelegramInitDataResult = {
  telegramUserId: number
  username?: string
  firstName?: string
  lastName?: string
  authDate: number
}

/**
 * Верифицирует initData из Telegram Mini App по HMAC-SHA256.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * @returns Распарсенные данные пользователя или null если верификация не прошла.
 */
export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds?: number,
): TelegramInitDataResult | null {
  if (!initData || !botToken) return null

  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash) return null

  // data-check-string: все параметры кроме hash, отсортированы, через \n
  params.delete('hash')
  const entries = [...params.entries()].sort(([a], [b]) => a.localeCompare(b))
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n')

  // HMAC: secret = HMAC-SHA256("WebAppData", botToken), check = HMAC-SHA256(secret, dataCheckString)
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest()
  const checkHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex')

  // Constant-time сравнение
  const hashBuffer = Buffer.from(hash, 'hex')
  const checkBuffer = Buffer.from(checkHash, 'hex')
  if (hashBuffer.length !== checkBuffer.length || !timingSafeEqual(hashBuffer, checkBuffer)) {
    return null
  }

  // Парсим user
  const userJson = params.get('user')
  if (!userJson) return null

  let user: { id: number; username?: string; first_name?: string; last_name?: string }
  try {
    user = JSON.parse(userJson)
  } catch {
    return null
  }

  if (typeof user.id !== 'number') return null

  const authDate = parseInt(params.get('auth_date') ?? '0', 10)

  // Проверка свежести
  if (maxAgeSeconds != null && maxAgeSeconds > 0) {
    const nowSec = Math.floor(Date.now() / 1000)
    if (nowSec - authDate > maxAgeSeconds) return null
  }

  return {
    telegramUserId: user.id,
    username: user.username,
    firstName: user.first_name,
    lastName: user.last_name,
    authDate,
  }
}
