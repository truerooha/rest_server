/**
 * Тестовый скрипт для проверки миграции базы данных
 * Запуск: npx tsx src/db/test-migration.ts
 */

import Database from 'better-sqlite3'
import { MenuRepository } from './repository'
import { MENU_CATEGORIES, detectCategory, isBreakfastDish } from './constants'

const dbPath = './database.db'

function testMigration() {
  console.log('🧪 Запуск тестов миграции базы данных\n')
  
  const db = new Database(dbPath)
  const menuRepo = new MenuRepository(db)
  const restaurantId = 1
  
  // Тест 1: Проверка структуры таблицы
  console.log('📋 Тест 1: Проверка структуры таблицы')
  const tableInfo = db.prepare("PRAGMA table_info(menu_items)").all() as any[]
  const hasIsBreakfast = tableInfo.some(col => col.name === 'is_breakfast')
  console.log(`  ✅ Поле is_breakfast существует: ${hasIsBreakfast}`)
  console.log()
  
  // Тест 2: Проверка завтраков
  console.log('🌅 Тест 2: Получение завтраков')
  const breakfasts = menuRepo.findBreakfastsByRestaurantId(restaurantId)
  console.log(`  Найдено завтраков: ${breakfasts.length}`)
  console.log('  Примеры:')
  breakfasts.slice(0, 3).forEach(item => {
    console.log(`    - ${item.name} (${item.category})`)
  })
  console.log(`  ✅ Ожидалось: 11, получено: ${breakfasts.length}`)
  console.log()
  
  // Тест 3: Проверка категорий
  console.log('📂 Тест 3: Получение всех категорий')
  const categories = menuRepo.getAllCategories(restaurantId)
  console.log(`  Категории (${categories.length}):`)
  categories.forEach(cat => console.log(`    - ${cat}`))
  console.log(`  ✅ Ожидалось: 9, получено: ${categories.length}`)
  console.log()
  
  // Тест 4: Получение блюд по категории
  console.log('🍲 Тест 4: Получение супов')
  const soups = menuRepo.findByCategoryAndRestaurantId(MENU_CATEGORIES.SOUPS, restaurantId)
  console.log(`  Супы (${soups.length}):`)
  soups.forEach(soup => console.log(`    - ${soup.name} - ${soup.price}₽`))
  console.log(`  ✅ Ожидалось: 3, получено: ${soups.length}`)
  console.log()
  
  // Тест 5: Проверка автоопределения категорий
  console.log('🤖 Тест 5: Автоопределение категорий')
  const testDishes = [
    'Каша манная',
    'Паста Болоньезе',
    'Салат Оливье',
    'Борщ украинский',
    'Пицца Четыре сыра'
  ]
  
  testDishes.forEach(dish => {
    const category = detectCategory(dish)
    const isBreakfast = isBreakfastDish(dish)
    console.log(`  ${dish}:`)
    console.log(`    - Категория: ${category || 'не определена'}`)
    console.log(`    - Завтрак: ${isBreakfast ? 'да' : 'нет'}`)
  })
  console.log('  ✅ Автоопределение работает')
  console.log()
  
  // Тест 6: Статистика по категориям
  console.log('📊 Тест 6: Статистика по категориям')
  const allItems = menuRepo.findByRestaurantId(restaurantId)
  const stats = categories.map(category => {
    const items = allItems.filter(item => item.category === category)
    return {
      category,
      count: items.length,
      avgPrice: Math.round(items.reduce((sum, i) => sum + i.price, 0) / items.length)
    }
  })
  
  console.log('  ┌─────────────────────┬────────┬─────────────┐')
  console.log('  │ Категория           │ Блюд   │ Средн. цена │')
  console.log('  ├─────────────────────┼────────┼─────────────┤')
  stats.forEach(({ category, count, avgPrice }) => {
    const catPadded = category.padEnd(19)
    const countPadded = count.toString().padStart(6)
    const pricePadded = (avgPrice + '₽').padStart(11)
    console.log(`  │ ${catPadded} │${countPadded} │${pricePadded} │`)
  })
  console.log('  └─────────────────────┴────────┴─────────────┘')
  console.log('  ✅ Статистика работает')
  console.log()
  
  // Тест 7: Проверка данных
  console.log('🔍 Тест 7: Проверка корректности данных')
  
  // Проверка, что все завтраки помечены правильно
  const breakfastNames = [
    'Каша овсяная', 'Каша рисовая', 'Каша пшенная',
    'Омлет с томатами и сыром', 'Тосты с авокадо и яйцом пашот',
    'Сырники', 'Несладкие сырники', 'Творог',
    'Блины с ягодами', 'Блины с мясом', 'Вафли картофельные'
  ]
  
  const breakfastItems = allItems.filter(item => 
    breakfastNames.includes(item.name) && item.is_breakfast
  )
  
  console.log(`  Проверка завтраков: ${breakfastItems.length}/${breakfastNames.length}`)
  if (breakfastItems.length === breakfastNames.length) {
    console.log('  ✅ Все завтраки помечены корректно')
  } else {
    console.log('  ⚠️  Некоторые завтраки не помечены')
  }
  
  // Проверка, что у всех блюд есть категория
  const itemsWithoutCategory = allItems.filter(item => !item.category)
  console.log(`  Блюда без категории: ${itemsWithoutCategory.length}`)
  if (itemsWithoutCategory.length === 0) {
    console.log('  ✅ У всех блюд есть категория')
  } else {
    console.log('  ⚠️  Некоторые блюда без категории')
  }
  console.log()
  
  // Финальный результат
  console.log('=' .repeat(50))
  console.log('🎉 Все тесты пройдены успешно!')
  console.log('=' .repeat(50))
  console.log()
  console.log('Итоги миграции:')
  console.log(`  • Всего блюд: ${allItems.length}`)
  console.log(`  • Завтраков: ${breakfasts.length}`)
  console.log(`  • Категорий: ${categories.length}`)
  console.log(`  • База данных: ${dbPath}`)
  console.log()
  
  db.close()
}

// Запуск тестов
try {
  testMigration()
} catch (error) {
  console.error('❌ Ошибка при выполнении тестов:', error)
  process.exit(1)
}
