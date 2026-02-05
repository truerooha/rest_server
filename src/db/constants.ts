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
  DESSERTS: 'Десерты',
} as const

/**
 * Тип для категорий меню
 */
export type MenuCategory = typeof MENU_CATEGORIES[keyof typeof MENU_CATEGORIES]

/**
 * Массив всех категорий в порядке отображения
 */
export const MENU_CATEGORIES_ORDER: MenuCategory[] = [
  MENU_CATEGORIES.BREAKFAST,
  MENU_CATEGORIES.APPETIZERS,
  MENU_CATEGORIES.SALADS,
  MENU_CATEGORIES.SOUPS,
  MENU_CATEGORIES.PIZZA,
  MENU_CATEGORIES.PASTA,
  MENU_CATEGORIES.RISOTTO,
  MENU_CATEGORIES.HOT_DISHES,
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
    'стейк', 'гриль', 'курица', 'рыба', 'говядина', 
    'свинина', 'баранина', 'утка', 'индейка'
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
