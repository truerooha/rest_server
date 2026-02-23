import { describe, it, expect } from 'vitest'
import {
  detectCategory,
  isBreakfastDish,
  isValidCategory,
  MENU_CATEGORIES,
} from '../constants'

describe('detectCategory', () => {
  it('должен определять категорию "Супы"', () => {
    expect(detectCategory('Борщ украинский')).toBe(MENU_CATEGORIES.SOUPS)
    expect(detectCategory('Суп-харчо')).toBe(MENU_CATEGORIES.SOUPS)
    expect(detectCategory('Солянка мясная')).toBe(MENU_CATEGORIES.SOUPS)
    expect(detectCategory('Бульон куриный')).toBe(MENU_CATEGORIES.SOUPS)
  })

  it('должен определять категорию "Салаты"', () => {
    expect(detectCategory('Салат Цезарь')).toBe(MENU_CATEGORIES.SALADS)
    expect(detectCategory('Греческий салат')).toBe(MENU_CATEGORIES.SALADS)
  })

  it('должен определять категорию "Пицца"', () => {
    expect(detectCategory('Пицца Маргарита')).toBe(MENU_CATEGORIES.PIZZA)
    expect(detectCategory('Пицца 4 сыра')).toBe(MENU_CATEGORIES.PIZZA)
  })

  it('должен определять категорию "Паста"', () => {
    expect(detectCategory('Спагетти Карбонара')).toBe(MENU_CATEGORIES.PASTA)
    expect(detectCategory('Паста Болоньезе')).toBe(MENU_CATEGORIES.PASTA)
    expect(detectCategory('Феттучине Альфредо')).toBe(MENU_CATEGORIES.PASTA)
  })

  it('должен определять категорию "Горячие блюда"', () => {
    expect(detectCategory('Стейк рибай')).toBe(MENU_CATEGORIES.HOT_DISHES)
    expect(detectCategory('Курица запечённая')).toBe(MENU_CATEGORIES.HOT_DISHES)
    expect(detectCategory('Говядина тушёная')).toBe(MENU_CATEGORIES.HOT_DISHES)
  })

  it('должен определять категорию "Рыбные блюда"', () => {
    expect(detectCategory('Рыба на пару')).toBe(MENU_CATEGORIES.FISH)
    expect(detectCategory('Лосось на гриле')).toBe(MENU_CATEGORIES.FISH)
    expect(detectCategory('Форель запечённая')).toBe(MENU_CATEGORIES.FISH)
  })

  it('должен определять категорию "Блюда на гриле"', () => {
    expect(detectCategory('Шашлык из баранины')).toBe(MENU_CATEGORIES.GRILL)
    expect(detectCategory('Кебаб')).toBe(MENU_CATEGORIES.GRILL)
  })

  it('должен определять категорию "Напитки"', () => {
    expect(detectCategory('Кофе латте')).toBe(MENU_CATEGORIES.DRINKS)
    expect(detectCategory('Чай зелёный')).toBe(MENU_CATEGORIES.DRINKS)
    expect(detectCategory('Лимонад')).toBe(MENU_CATEGORIES.DRINKS)
  })

  it('должен определять категорию "Десерты"', () => {
    expect(detectCategory('Тирамису')).toBe(MENU_CATEGORIES.DESSERTS)
    expect(detectCategory('Чизкейк')).toBe(MENU_CATEGORIES.DESSERTS)
    expect(detectCategory('Торт Наполеон')).toBe(MENU_CATEGORIES.DESSERTS)
    expect(detectCategory('Мороженое')).toBe(MENU_CATEGORIES.DESSERTS)
  })

  it('должен определять категорию "Завтраки"', () => {
    expect(detectCategory('Овсяная каша')).toBe(MENU_CATEGORIES.BREAKFAST)
    expect(detectCategory('Омлет с сыром')).toBe(MENU_CATEGORIES.BREAKFAST)
    expect(detectCategory('Сырники')).toBe(MENU_CATEGORIES.BREAKFAST)
    expect(detectCategory('Блины')).toBe(MENU_CATEGORIES.BREAKFAST)
  })

  it('должен возвращать null для неизвестных блюд', () => {
    expect(detectCategory('Непонятное блюдо')).toBeNull()
    expect(detectCategory('Абракадабра')).toBeNull()
  })

  it('должен быть регистронезависимым', () => {
    expect(detectCategory('БОРЩ')).toBe(MENU_CATEGORIES.SOUPS)
    expect(detectCategory('пИццА')).toBe(MENU_CATEGORIES.PIZZA)
  })
})

describe('isBreakfastDish', () => {
  it('должен определять завтраки по ключевым словам', () => {
    // Каши
    expect(isBreakfastDish('Овсяная каша')).toBe(true)
    expect(isBreakfastDish('Рисовая каша')).toBe(true)
    expect(isBreakfastDish('Пшенная каша')).toBe(true)

    // Яйца
    expect(isBreakfastDish('Омлет')).toBe(true)
    expect(isBreakfastDish('Яичница')).toBe(true)
    expect(isBreakfastDish('Шакшука')).toBe(true)

    // Творог
    expect(isBreakfastDish('Сырники')).toBe(true)
    expect(isBreakfastDish('Творог с медом')).toBe(true)

    // Блины
    expect(isBreakfastDish('Блины с вареньем')).toBe(true)
    expect(isBreakfastDish('Оладьи')).toBe(true)
    expect(isBreakfastDish('Вафли')).toBe(true)
    expect(isBreakfastDish('Панкейки')).toBe(true)
  })

  it('не должен определять не-завтраки как завтраки', () => {
    expect(isBreakfastDish('Борщ')).toBe(false)
    expect(isBreakfastDish('Пицца')).toBe(false)
    expect(isBreakfastDish('Стейк')).toBe(false)
    expect(isBreakfastDish('Салат')).toBe(false)
  })

  it('должен быть регистронезависимым', () => {
    expect(isBreakfastDish('ОМЛЕТ')).toBe(true)
    expect(isBreakfastDish('овсянка')).toBe(true)
  })
})

describe('isValidCategory', () => {
  it('должен проверять валидные категории', () => {
    expect(isValidCategory('Завтраки')).toBe(true)
    expect(isValidCategory('Салаты')).toBe(true)
    expect(isValidCategory('Супы')).toBe(true)
    expect(isValidCategory('Пицца')).toBe(true)
    expect(isValidCategory('Паста')).toBe(true)
    expect(isValidCategory('Ризотто')).toBe(true)
    expect(isValidCategory('Горячие блюда')).toBe(true)
    expect(isValidCategory('Десерты')).toBe(true)
    expect(isValidCategory('Закуски')).toBe(true)
  })

  it('должен отклонять невалидные категории', () => {
    expect(isValidCategory('Непонятная категория')).toBe(false)
    expect(isValidCategory('Что-то странное')).toBe(false)
    expect(isValidCategory('')).toBe(false)
  })

  it('должен принимать новые категории', () => {
    expect(isValidCategory('Напитки')).toBe(true)
    expect(isValidCategory('Блюда на гриле')).toBe(true)
    expect(isValidCategory('Рыбные блюда')).toBe(true)
    expect(isValidCategory('Гарниры')).toBe(true)
    expect(isValidCategory('Сэндвичи')).toBe(true)
    expect(isValidCategory('Роллы')).toBe(true)
  })
})
