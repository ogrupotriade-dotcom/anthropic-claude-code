-- Map existing sales to their leads and add today's sale
-- Run via Supabase Management API

-- 1. Update sale for jeapsilva635@gmail.com (20/03) - map to lead
UPDATE bi_sales
SET lead_id = (SELECT id FROM bi_leads WHERE email = 'jeapsilva635@gmail.com' LIMIT 1),
    utm_source = 'ig',
    utm_medium = 'paid',
    utm_campaign = '[CONVERSÃO]+[COMPRA]+[QUENTE]+Posicionamento+antigo'
WHERE email = 'jeapsilva635@gmail.com'
  AND lead_id IS NULL;

-- 2. Update sale for roseamofoto@gmail.com (24/03) - map to lead
UPDATE bi_sales
SET lead_id = (SELECT id FROM bi_leads WHERE email = 'roseamofoto@gmail.com' LIMIT 1),
    utm_source = 'ig',
    utm_medium = 'paid',
    utm_campaign = '[CONVERSÃO]+[COMPRA]+[QUENTE]+Posicionamento+antigo'
WHERE email = 'roseamofoto@gmail.com'
  AND lead_id IS NULL;

-- 3. Insert today's sale (28/03) from esnetuno@gmail.com
INSERT INTO bi_sales (revenue, sale_at, product_name, buyer_name, email, payment_method, status, lead_id, utm_source, utm_medium, utm_campaign)
SELECT
  2000.00,
  '2026-03-28 11:33:26-03',
  'Programa de Aceleração VDB - 6 meses',
  l.name,
  'esnetuno@gmail.com',
  'credit_card',
  'approved',
  l.id,
  l.utm_source,
  l.utm_medium,
  l.utm_campaign
FROM bi_leads l
WHERE l.email = 'esnetuno@gmail.com'
LIMIT 1
ON CONFLICT DO NOTHING;

-- 4. Delete the orphan sale record (revenue=2000, no email) if it exists
DELETE FROM bi_sales
WHERE sale_at::date = '2026-03-28'
  AND revenue = 2000
  AND (email IS NULL OR email = '');
