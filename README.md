# Обед в Офис - Server

Backend для сервиса предзаказа корпоративных обедов.

## Что включает:

- **Telegram боты** (админский для ресторанов, клиентский для пользователей)
- **REST API** (для Mini App)
- **База данных SQLite** (с миграцией на PostgreSQL позже)
- **Интеграция с DeepSeek Vision API** (распознавание меню)

## Технологии

- Node.js + TypeScript
- grammy (Telegram Bot Framework)
- better-sqlite3 (SQLite)
- Express (API сервер, будет добавлен)
- OpenAI SDK (для DeepSeek)

## Запуск локально

```bash
# Установка зависимостей
npm install

# Настройка .env (скопировать из корня проекта)
cp ../.env .env

# Разработка
npm run dev

# Production build
npm run build
npm start
```

## Деплой на Railway

1. Создать проект на Railway
2. Подключить этот репозиторий
3. Добавить Volume для SQLite
4. Настроить переменные окружения:
   - `BOT_TOKEN`
   - `DEEPSEEK_API_KEY`
   - `DATABASE_PATH=/data/database.db`

## API Endpoints (будут добавлены)

- `GET /api/restaurants` - список ресторанов
- `GET /api/restaurants/:id/menu` - меню ресторана
- `POST /api/orders` - создать заказ

## Структура

```
server/
├── src/
│   ├── bot/          # Telegram боты
│   ├── api/          # REST API (будет добавлено)
│   ├── db/           # База данных
│   ├── services/     # Сервисы (DeepSeek, и т.д.)
│   ├── types/        # TypeScript типы
│   └── utils/        # Утилиты
├── package.json
└── tsconfig.json
```

## Environment Variables

См. `.env.example` в корне проекта.
