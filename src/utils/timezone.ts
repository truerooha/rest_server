/**
 * Централизованная работа с часовым поясом приложения.
 * Все заказы, дедлайны и даты используют единый timezone из env (DEFAULT_TIMEZONE).
 */

const DEFAULT_APP_TIMEZONE = 'Europe/Moscow'

function getAppTimezone(): string {
  const tz = process.env.DEFAULT_TIMEZONE?.trim()
  return tz || DEFAULT_APP_TIMEZONE
}

/** Текущая дата в формате YYYY-MM-DD в часовом поясе приложения */
export function getTodayInAppTz(): string {
  const tz = getAppTimezone()
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return formatter.format(new Date())
}

/** Текущее время в минутах (часы * 60 + минуты) в часовом поясе приложения */
export function getNowMinutesInAppTz(): number {
  const tz = getAppTimezone()
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(new Date())
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10)
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10)
  return hour * 60 + minute
}

/** IANA timezone приложения (для передачи клиенту) */
export function getAppTimezoneId(): string {
  return getAppTimezone()
}
