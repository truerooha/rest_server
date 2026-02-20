import { Request, Response, NextFunction } from 'express'
import { verifyTelegramInitData, TelegramInitDataResult } from '../../utils/telegram-auth'
import { config } from '../../utils/config'
import { logger } from '../../utils/logger'

const HEADER_NAME = 'x-telegram-init-data'
const MAX_AGE_SECONDS = 86400 // 24 часа (initData не обновляется пока Mini App открыт)

/**
 * Middleware: верифицирует Telegram initData из заголовка X-Telegram-Init-Data.
 *
 * Режимы работы:
 * - non-production (dev/test): пропускает без проверки
 * - production, REQUIRE_TELEGRAM_AUTH=true: strict — 401 без initData
 * - production, REQUIRE_TELEGRAM_AUTH не задан: soft — верифицирует если есть, пропускает если нет
 *
 * При успешной верификации: res.locals.telegramUser = TelegramInitDataResult.
 */
export function requireTelegramAuth(req: Request, res: Response, next: NextFunction): void {
  if (config.nodeEnv !== 'production') {
    return next()
  }

  const initData = req.headers[HEADER_NAME]

  // Нет заголовка → в strict-режиме блокируем, иначе пропускаем
  if (typeof initData !== 'string' || !initData) {
    if (config.requireTelegramAuth) {
      res.status(401).json({ success: false, error: 'missing_init_data' })
      return
    }
    return next()
  }

  // Заголовок есть, но нет токена для проверки
  if (!config.clientBotToken) {
    logger.error('CLIENT_BOT_TOKEN не настроен, невозможно проверить initData')
    // В soft-режиме пропускаем, в strict — 500
    if (config.requireTelegramAuth) {
      res.status(500).json({ success: false, error: 'server_config_error' })
      return
    }
    return next()
  }

  const result = verifyTelegramInitData(initData, config.clientBotToken, MAX_AGE_SECONDS)
  if (!result) {
    logger.warn('Невалидный initData', { path: req.path })
    res.status(401).json({ success: false, error: 'invalid_init_data' })
    return
  }

  res.locals = { ...res.locals, telegramUser: result }
  next()
}

/** Тип-хелпер для извлечения верифицированного пользователя из res.locals */
export function getTelegramUser(res: Response): TelegramInitDataResult | undefined {
  return (res.locals as { telegramUser?: TelegramInitDataResult }).telegramUser
}
