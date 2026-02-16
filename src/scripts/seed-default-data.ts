import { initDatabase } from '../db/schema'
import { 
  BuildingRepository, 
  RestaurantRepository, 
  RestaurantBuildingRepository 
} from '../db/repository'
import { config } from '../utils/config'

/**
 * Скрипт для создания дефолтных данных:
 * - Здание "Коворкинг"
 * - Связь ресторана "Фудкорнер" со зданием
 * 
 * Запуск: tsx src/scripts/seed-default-data.ts
 */

async function seedDefaultData() {
  console.log('🌱 Инициализация дефолтных данных...\n')

  const db = initDatabase(config.databasePath)
  const buildingRepo = new BuildingRepository(db)
  const restaurantRepo = new RestaurantRepository(db)
  const restaurantBuildingRepo = new RestaurantBuildingRepository(db)

  try {
    // 1. Проверяем/создаём здание "Коворкинг"
    console.log('🏢 Проверка здания "Коворкинг"...')
    let buildings = buildingRepo.findAll()
    let coworkingBuilding = buildings.find(b => b.name === 'Коворкинг')

    if (!coworkingBuilding) {
      coworkingBuilding = buildingRepo.create({
        name: 'Коворкинг',
        address: 'Дефолтный адрес коворкинга',
      })
      console.log(`✅ Здание "Коворкинг" создано (ID: ${coworkingBuilding.id})`)
    } else {
      console.log(`✅ Здание "Коворкинг" уже существует (ID: ${coworkingBuilding.id})`)
    }

    // 2. Находим первый ресторан и переименовываем в "Фудкорнер"
    console.log('\n🍽️  Проверка ресторана "Фудкорнер"...')
    let restaurants = db.prepare('SELECT * FROM restaurants').all() as any[]
    let restaurant: any

    if (restaurants.length === 0) {
      console.log('⚠️  Нет ресторанов. Создаём дефолтный ресторан "Фудкорнер"...')
      const result = restaurantRepo.create({
        name: 'Фудкорнер',
        chat_id: 123456789 // Dummy chat ID
      })
      restaurant = result
      console.log(`✅ Создан дефолтный ресторан (ID: ${restaurant.id})`)
    } else {
      restaurant = restaurants[0]
      // Переименовываем в "Фудкорнер" если нужно
      if (restaurant.name !== 'Фудкорнер') {
        db.prepare('UPDATE restaurants SET name = ? WHERE id = ?')
          .run('Фудкорнер', restaurant.id)
        console.log(`✅ Ресторан переименован: "${restaurant.name}" → "Фудкорнер"`)
      } else {
        console.log('✅ Ресторан "Фудкорнер" уже существует')
      }
    }

    // 3. Связываем ресторан со зданием
    console.log('\n🔗 Связывание ресторана со зданием...')
    const existingLink = db
      .prepare('SELECT * FROM restaurant_buildings WHERE restaurant_id = ? AND building_id = ?')
      .get(restaurant.id, coworkingBuilding.id)

    if (!existingLink) {
      restaurantBuildingRepo.link(restaurant.id, coworkingBuilding.id)
      console.log('✅ Ресторан "Фудкорнер" связан со зданием "Коворкинг"')
    } else {
      console.log('✅ Связь уже существует')
    }

    // 4. Итоговая информация
    console.log('\n' + '='.repeat(60))
    console.log('📊 Итоговая конфигурация:')
    console.log('='.repeat(60))
    console.log(`\n🏢 Здание: ${coworkingBuilding.name} (ID: ${coworkingBuilding.id})`)
    console.log(`   Адрес: ${coworkingBuilding.address}`)
    console.log(`\n🍽️  Ресторан: Фудкорнер (ID: ${restaurant.id})`)
    console.log(`   Chat ID: ${restaurant.chat_id}`)
    
    const menuItems = db.prepare('SELECT COUNT(*) as count FROM menu_items WHERE restaurant_id = ?')
      .get(restaurant.id) as any
    console.log(`   Блюд в меню: ${menuItems.count}`)

    console.log('\n✅ Дефолтные данные настроены!')
    console.log('\n💡 Теперь клиентский бот будет автоматически использовать:')
    console.log('   - Здание: Коворкинг')
    console.log('   - Ресторан: Фудкорнер\n')

  } catch (error) {
    console.error('❌ Ошибка:', error)
    process.exit(1)
  } finally {
    db.close()
  }
}

seedDefaultData()
