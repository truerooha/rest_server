type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const levelOrder: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

const resolveLogLevel = (): LogLevel => {
  const rawLevel = process.env.LOG_LEVEL?.toLowerCase()
  if (rawLevel === 'debug' || rawLevel === 'info' || rawLevel === 'warn' || rawLevel === 'error') {
    return rawLevel
  }

  return process.env.NODE_ENV === 'development' ? 'debug' : 'info'
}

const currentLevel = resolveLogLevel()

const shouldLog = (level: LogLevel): boolean => {
  return levelOrder[level] >= levelOrder[currentLevel]
}

const serializeError = (error: unknown): Record<string, unknown> => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    }
  }

  if (typeof error === 'object' && error !== null) {
    return {
      message: 'Non-Error exception',
      details: error,
    }
  }

  return { message: String(error) }
}

const sanitizeMeta = (meta: Record<string, unknown> = {}): Record<string, unknown> => {
  return Object.entries(meta).reduce<Record<string, unknown>>((acc, [key, value]) => {
    if (value === undefined) {
      return acc
    }
    return { ...acc, [key]: value }
  }, {})
}

const baseLog = (level: LogLevel, message: string, meta: Record<string, unknown> = {}): void => {
  if (!shouldLog(level)) {
    return
  }

  const payload = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    pid: process.pid,
    ...sanitizeMeta(meta),
  }

  if (level === 'error') {
    console.error(JSON.stringify(payload))
    return
  }

  if (level === 'warn') {
    console.warn(JSON.stringify(payload))
    return
  }

  console.log(JSON.stringify(payload))
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => baseLog('debug', message, meta),
  info: (message: string, meta?: Record<string, unknown>) => baseLog('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => baseLog('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => {
    const normalizedMeta = meta ?? {}
    const errorValue = normalizedMeta.error
    const payload = errorValue
      ? { ...normalizedMeta, error: serializeError(errorValue) }
      : normalizedMeta
    baseLog('error', message, payload)
  },
  serializeError,
  level: currentLevel,
}
