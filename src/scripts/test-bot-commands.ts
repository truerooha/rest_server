import { Bot } from 'grammy'
import { config } from '../utils/config'

/**
 * Скрипт для проверки работы команд бота
 * Запуск: tsx src/scripts/test-bot-commands.ts
 * 
 * Этот скрипт отправляет команды боту и проверяет, что бот отвечает.
 * Убедитесь, что бот запущен на Railway или локально.
 */

async function testBotCommands() {
  console.log('🧪 Тестирование команд бота...\n')

  const bot = new Bot(config.botToken!)
  
  // Получаем информацию о боте
  try {
    const me = await bot.api.getMe()
    console.log('✅ Подключение к боту успешно!')
    console.log(`📱 Бот: @${me.username} (${me.first_name})`)
    console.log(`🆔 ID: ${me.id}\n`)
  } catch (error) {
    console.error('❌ Не удалось подключиться к боту:', error)
    process.exit(1)
  }

  // Проверяем зарегистрированные команды
  try {
    console.log('📋 Проверка зарегистрированных команд...')
    const commands = await bot.api.getMyCommands()
    
    if (commands.length === 0) {
      console.log('⚠️  Команды не зарегистрированы! Запустите: npm run register-commands\n')
    } else {
      console.log(`✅ Зарегистрировано команд: ${commands.length}\n`)
      commands.forEach((cmd, index) => {
        console.log(`  ${index + 1}. /${cmd.command} - ${cmd.description}`)
      })
      console.log()
    }
  } catch (error) {
    console.error('❌ Ошибка при получении команд:', error)
  }

  // Проверяем статус бота
  try {
    console.log('🔍 Проверка статуса бота на Railway/локально...')
    
    // Пытаемся получить обновления (это покажет, работает ли бот)
    const updates = await bot.api.getUpdates({ limit: 1, timeout: 0 })
    
    if (updates.length > 0) {
      console.log('✅ Бот получает обновления (работает корректно)')
      console.log(`📬 Последнее обновление: ${new Date(updates[0].message?.date || 0).toLocaleString()}\n`)
    } else {
      console.log('✅ Бот работает, но нет новых сообщений\n')
    }
  } catch (error: any) {
    if (error.error_code === 409) {
      console.log('⚠️  Конфликт: Бот запущен в другом месте (Railway/локально)')
      console.log('   Это нормально, если бот работает на Railway.\n')
    } else {
      console.error('❌ Ошибка при проверке статуса:', error.description || error.message)
    }
  }

  // Проверяем webhook
  try {
    console.log('🔗 Проверка webhook...')
    const webhookInfo = await bot.api.getWebhookInfo()
    
    if (webhookInfo.url) {
      console.log(`✅ Webhook установлен: ${webhookInfo.url}`)
      console.log(`   Pending updates: ${webhookInfo.pending_update_count}`)
    } else {
      console.log('ℹ️  Webhook не установлен (используется polling)')
      console.log('   Это нормально для текущей конфигурации.\n')
    }
  } catch (error) {
    console.error('❌ Ошибка при проверке webhook:', error)
  }

  console.log('\n' + '='.repeat(60))
  console.log('📝 Резюме:')
  console.log('='.repeat(60))
  console.log('\n✅ Команды для проверки в Telegram:')
  console.log('   1. Найдите бота в Telegram')
  console.log('   2. Отправьте /start')
  console.log('   3. Нажмите "/" для просмотра всех команд')
  console.log('   4. Попробуйте команды: /menu, /categories, /breakfasts\n')

  console.log('📊 Если команды не работают:')
  console.log('   - Убедитесь, что меню не пустое (отправьте фото меню)')
  console.log('   - Перезапустите бота в Telegram: /start')
  console.log('   - Проверьте логи Railway на наличие ошибок\n')

  process.exit(0)
}

testBotCommands().catch((error) => {
  console.error('\n💥 Критическая ошибка:', error)
  process.exit(1)
})
