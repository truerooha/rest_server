-- Минимальная сумма заказа для бесплатной доставки / сбора по слоту (настройка ресторана)
ALTER TABLE restaurants ADD COLUMN min_order_amount REAL DEFAULT 0;
