-- Fix bi_sales: insert missing sales + clean up test data
-- Run this in Supabase SQL Editor

-- 1. Delete test record (from debugging)
DELETE FROM bi_sales WHERE email = 'teste@test.com';

-- 2. Insert the 2 real sales from HeroSpark (March 2026)
INSERT INTO bi_sales (revenue, sale_at, product_name, buyer_name, email, payment_method, status)
VALUES
  (1921.00, '2026-03-20 06:02:00-03', 'Programa de Aceleração VDB - 6 meses', 'Jefferson Aparecido Da Silva', 'jeapsilva635@gmail.com', 'credit_card', 'approved'),
  (1921.00, '2026-03-24 11:45:00-03', 'Programa de Aceleração VDB - 6 meses', 'Rosemary Espindola Rocha', 'roseamofoto@gmail.com', 'credit_card', 'approved');
