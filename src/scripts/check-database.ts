import { initDatabase } from '../db/schema'
import { RestaurantRepository, MenuRepository } from '../db/repository'
import { config } from '../utils/config'

/**
 * Скрипт для проверки состояния базы данных
 * Запуск: tsx src/scripts/check-database.ts
 */

async function checkDatabase() {
  console.log('🔍 Проверка базы данных...\n')

  const db = initDatabase(config.databasePath)
  const restaurantRepo = new RestaurantRepository(db)
  const menuRepo = new MenuRepository(db)

  try {
    // Получаем все рестораны
    const restaurants = db.prepare('SELECT * FROM restaurants').all()
    
    console.log(`📊 Статистика базы данных:\n`)
    console.log(`   Ресторанов: ${restaurants.length}`)
    
    if (restaurants.length === 0) {
      console.log('\n⚠️  База данных пуста!')
      console.log('   Причина: Бот ещё не получал данные о ресторанах')
      console.log('\n💡 Что делать:')
      console.log('   1. Откройте бота в Telegram')
      console.log('   2. Отправьте фото меню или используйте /add')
      console.log('   3. После этого команды /menu, /categories, /breakfasts заработают\n')
    } else {
      console.log()
      restaurants.forEach((restaurant: any, index: number) => {
        console.log(`   ${index + 1}. ${restaurant.name}`)
        console.log(`      Chat ID: ${restaurant.chat_id}`)
        console.log(`      Создан: ${new Date(restaurant.created_at).toLocaleString()}`)
        
        // Получаем меню для ресторана
        const menuItems = menuRepo.findByRestaurantId(restaurant.id)
        console.log(`      Блюд в меню: ${menuItems.length}`)
        
        if (menuItems.length > 0) {
          const categories = [...new Set(menuItems.map(item => item.category))]
          const breakfasts = menuItems.filter(item => item.is_breakfast)
          
          console.log(`      Категорий: ${categories.length}`)
          console.log(`      Завтраков: ${breakfasts.length}`)
          console.log(`      Доступно: ${menuItems.filter(item => item.is_available).length}`)
        } else {
          console.log(`      ⚠️  Меню пусто!`)
        }
        console.log()
      })
    }

    // Проверяем команды, которые зависят от данных
    console.log('🧪 Проверка доступности команд:\n')
    
    if (restaurants.length === 0) {
      console.log('   ❌ /menu - не работает (нет ресторанов)')
      console.log('   ❌ /categories - не работает (нет ресторанов)')
      console.log('   ❌ /breakfasts - не работает (нет ресторанов)')
      console.log('   ✅ /add - работает (для добавления первого блюда)')
      console.log('   ✅ /start - работает')
    } else {
      const hasMenu = restaurants.some((r: any) => {
        const items = menuRepo.findByRestaurantId(r.id)
        return items.length > 0
      })
      
      if (hasMenu) {
        console.log('   ✅ /menu - должна работать')
        console.log('   ✅ /categories - должна работать')
        console.log('   ✅ /breakfasts - должна работать')
        console.log('   ✅ /add - работает')
        console.log('   ✅ /edit - работает')
        console.log('   ✅ /delete - работает')
      } else {
        console.log('   ⚠️  /menu - скажет "меню пусто"')
        console.log('   ⚠️  /categories - скажет "меню пусто"')
        console.log('   ⚠️  /breakfasts - скажет "нет завтраков"')
        console.log('   ✅ /add - работает')
      }
    }

    console.log('\n' + '='.repeat(60))
    console.log('📝 Итог:')
    console.log('='.repeat(60))
    
    if (restaurants.length === 0 || !restaurants.some((r: any) => menuRepo.findByRestaurantId(r.id).length > 0)) {
      console.log('\n⚠️  Команды /menu, /categories, /breakfasts не будут работать')
      console.log('   потому что база данных пуста.\n')
      console.log('💡 Решение:')
      console.log('   Отправьте боту фото меню или добавьте блюда через /add\n')
    } else {
      console.log('\n✅ База данных содержит меню, команды должны работать!')
      console.log('   Если не работают - проверьте логи Railway на наличие ошибок.\n')
    }

  } catch (error) {
    console.error('❌ Ошибка при проверке базы данных:', error)
  } finally {
    db.close()
  }
}

checkDatabase().catch((error) => {
  console.error('\n💥 Критическая ошибка:', error)
  process.exit(1)
})
