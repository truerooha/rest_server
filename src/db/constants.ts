/**
 * Стандартные категории меню ресторана
 * Используются для единообразной классификации блюд
 */
export const MENU_CATEGORIES = {
  BREAKFAST: 'Завтраки',
  APPETIZERS: 'Закуски',
  SALADS: 'Салаты',
  SOUPS: 'Супы',
  PIZZA: 'Пицца',
  PASTA: 'Паста',
  RISOTTO: 'Ризотто',
  HOT_DISHES: 'Горячие блюда',
  GRILL: 'Блюда на гриле',
  FISH: 'Рыбные блюда',
  SIDES: 'Гарниры',
  SANDWICHES: 'Сэндвичи',
  ROLLS: 'Роллы',
  DRINKS: 'Напитки',
  DESSERTS: 'Десерты',
} as const

/**
 * Тип для категорий меню
 */
export type MenuCategory = typeof MENU_CATEGORIES[keyof typeof MENU_CATEGORIES]

/**
 * Приоритет категорий для сортировки чипов в UI
 * 1 — основные блюда (показываются первыми)
 * 2 — второстепенное
 * 3 — напитки, десерты, прочее
 */
export const CATEGORY_PRIORITY: Record<string, number> = {
  [MENU_CATEGORIES.HOT_DISHES]: 1,
  [MENU_CATEGORIES.GRILL]: 1,
  [MENU_CATEGORIES.FISH]: 1,
  [MENU_CATEGORIES.SOUPS]: 1,
  [MENU_CATEGORIES.PIZZA]: 1,
  [MENU_CATEGORIES.PASTA]: 1,
  [MENU_CATEGORIES.RISOTTO]: 1,
  [MENU_CATEGORIES.BREAKFAST]: 1,

  [MENU_CATEGORIES.SALADS]: 2,
  [MENU_CATEGORIES.ROLLS]: 2,
  [MENU_CATEGORIES.SANDWICHES]: 2,
  [MENU_CATEGORIES.APPETIZERS]: 2,
  [MENU_CATEGORIES.SIDES]: 2,

  [MENU_CATEGORIES.DRINKS]: 3,
  [MENU_CATEGORIES.DESSERTS]: 3,
}

/**
 * Получить приоритет категории (1 — высший, 3 — низший)
 * Неизвестные категории получают приоритет 3
 */
export function getCategoryPriority(category: string): number {
  return CATEGORY_PRIORITY[category] ?? 3
}

/**
 * Массив всех категорий в порядке отображения (по приоритету)
 */
export const MENU_CATEGORIES_ORDER: MenuCategory[] = [
  // Приоритет 1 — основные блюда
  MENU_CATEGORIES.HOT_DISHES,
  MENU_CATEGORIES.GRILL,
  MENU_CATEGORIES.FISH,
  MENU_CATEGORIES.SOUPS,
  MENU_CATEGORIES.PIZZA,
  MENU_CATEGORIES.PASTA,
  MENU_CATEGORIES.RISOTTO,
  MENU_CATEGORIES.BREAKFAST,
  // Приоритет 2 — второстепенное
  MENU_CATEGORIES.SALADS,
  MENU_CATEGORIES.ROLLS,
  MENU_CATEGORIES.SANDWICHES,
  MENU_CATEGORIES.APPETIZERS,
  MENU_CATEGORIES.SIDES,
  // Приоритет 3 — напитки, десерты
  MENU_CATEGORIES.DRINKS,
  MENU_CATEGORIES.DESSERTS,
]

/**
 * Проверка, является ли строка валидной категорией
 */
export function isValidCategory(category: string): category is MenuCategory {
  return Object.values(MENU_CATEGORIES).includes(category as MenuCategory)
}

/**
 * Ключевые слова для автоматического определения категории блюда
 */
export const CATEGORY_KEYWORDS: Record<MenuCategory, string[]> = {
  [MENU_CATEGORIES.BREAKFAST]: [
    'каша', 'овсянка', 'омлет', 'яичница', 'шакшука',
    'сырник', 'творог', 'блин', 'оладь', 'вафл'
  ],
  [MENU_CATEGORIES.APPETIZERS]: [
    'брускетт', 'закуск', 'тапас', 'антипасти'
  ],
  [MENU_CATEGORIES.SALADS]: [
    'салат', 'цезарь', 'греческий'
  ],
  [MENU_CATEGORIES.SOUPS]: [
    'суп', 'борщ', 'солянка', 'бульон', 'харчо'
  ],
  [MENU_CATEGORIES.PIZZA]: [
    'пицца'
  ],
  [MENU_CATEGORIES.PASTA]: [
    'паста', 'спагетти', 'пенне', 'феттучине', 'лингвини'
  ],
  [MENU_CATEGORIES.RISOTTO]: [
    'ризотто'
  ],
  [MENU_CATEGORIES.HOT_DISHES]: [
    'стейк', 'курица', 'говядина',
    'свинина', 'баранина', 'утка', 'индейка'
  ],
  [MENU_CATEGORIES.GRILL]: [
    'гриль', 'шашлык', 'кебаб', 'люля', 'барбекю'
  ],
  [MENU_CATEGORIES.FISH]: [
    'рыба', 'лосось', 'сёмга', 'форель', 'дорадо', 'сибас',
    'тунец', 'окунь', 'судак', 'треска'
  ],
  [MENU_CATEGORIES.SIDES]: [
    'гарнир', 'картофель', 'пюре', 'рис', 'овощи на'
  ],
  [MENU_CATEGORIES.SANDWICHES]: [
    'сэндвич', 'сандвич', 'бургер', 'хот-дог', 'панини', 'тост'
  ],
  [MENU_CATEGORIES.ROLLS]: [
    'ролл', 'маки', 'суши', 'нигири', 'сашими'
  ],
  [MENU_CATEGORIES.DRINKS]: [
    'кофе', 'чай', 'сок', 'лимонад', 'смузи', 'коктейль',
    'вода', 'морс', 'компот', 'какао', 'латте', 'капучино',
    'американо', 'эспрессо', 'раф'
  ],
  [MENU_CATEGORIES.DESSERTS]: [
    'десерт', 'торт', 'пирожн', 'тирамису', 'чизкейк',
    'мороженое', 'панакотта', 'пана-котта'
  ],
}

/**
 * Автоматическое определение категории по названию блюда
 */
export function detectCategory(dishName: string): MenuCategory | null {
  const normalizedName = dishName.toLowerCase()

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some(keyword => normalizedName.includes(keyword))) {
      return category as MenuCategory
    }
  }

  return null
}

/**
 * Проверка, является ли блюдо завтраком на основе названия
 */
export function isBreakfastDish(dishName: string): boolean {
  const normalizedName = dishName.toLowerCase()

  const breakfastKeywords = [
    'каша', 'овсян', 'рисов', 'пшен',
    'омлет', 'яичниц', 'яйц', 'шакшук', 'фритатт',
    'сырник', 'творог',
    'блин', 'оладь', 'вафл', 'панкейк'
  ]

  return breakfastKeywords.some(keyword => normalizedName.includes(keyword))
}
