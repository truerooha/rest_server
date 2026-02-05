-- Миграция: Добавление признака завтрака и категорий
-- Дата: 2026-02-05

-- Шаг 1: Добавляем колонку is_breakfast
ALTER TABLE menu_items ADD COLUMN is_breakfast INTEGER DEFAULT 0;

-- Шаг 2: Обновляем категории и признаки завтрака для существующих блюд

-- Завтраки - Каши
UPDATE menu_items SET category = 'Завтраки', is_breakfast = 1 
WHERE name IN ('Каша овсяная', 'Каша рисовая', 'Каша пшенная');

-- Завтраки - Молочные блюда
UPDATE menu_items SET category = 'Завтраки', is_breakfast = 1 
WHERE name IN ('Творог', 'Сырники', 'Несладкие сырники');

-- Завтраки - Блюда с яйцами
UPDATE menu_items SET category = 'Завтраки', is_breakfast = 1 
WHERE name IN (
  'Тосты с авокадо и яйцом пашот', 
  'Омлет с томатами и сыром'
);

-- Завтраки - Блины
UPDATE menu_items SET category = 'Завтраки', is_breakfast = 1 
WHERE name IN ('Блины с ягодами', 'Блины с мясом');

-- Завтраки - Вафли
UPDATE menu_items SET category = 'Завтраки', is_breakfast = 1 
WHERE name = 'Вафли картофельные';

-- Закуски - Брускетты
UPDATE menu_items SET category = 'Закуски' 
WHERE name LIKE 'Брускетта%';

-- Салаты
UPDATE menu_items SET category = 'Салаты' 
WHERE name LIKE 'Салат%';

-- Супы
UPDATE menu_items SET category = 'Супы' 
WHERE name LIKE 'Суп%';

-- Пицца
UPDATE menu_items SET category = 'Пицца' 
WHERE name LIKE 'Пицца%';

-- Паста
UPDATE menu_items SET category = 'Паста' 
WHERE name LIKE 'Паста%';

-- Ризотто
UPDATE menu_items SET category = 'Ризотто' 
WHERE name LIKE 'Ризотто%';

-- Горячие блюда (Мясо и рыба)
UPDATE menu_items SET category = 'Горячие блюда' 
WHERE name IN (
  'Стейк из лосося', 
  'Стейк из говядины', 
  'Курица гриль'
);

-- Десерты
UPDATE menu_items SET category = 'Десерты' 
WHERE name LIKE 'Десерт%';
