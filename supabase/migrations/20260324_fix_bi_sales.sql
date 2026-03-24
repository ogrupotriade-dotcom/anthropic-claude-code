-- Fix bi_sales table: add missing columns for HeroSpark integration
-- Run this in Supabase SQL Editor

-- Add columns if they don't exist (safe to run multiple times)
DO $$
BEGIN
  -- Ensure table exists
  CREATE TABLE IF NOT EXISTS bi_sales (
    id bigint generated always as identity primary key,
    revenue numeric default 0,
    sale_at timestamptz default now(),
    product text,
    customer_name text,
    customer_email text,
    payment_method text,
    status text default 'approved',
    source text default 'manual',
    external_id text,
    created_at timestamptz default now()
  );

  -- Add columns that might be missing
  BEGIN ALTER TABLE bi_sales ADD COLUMN product text; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE bi_sales ADD COLUMN customer_name text; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE bi_sales ADD COLUMN customer_email text; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE bi_sales ADD COLUMN payment_method text; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE bi_sales ADD COLUMN status text DEFAULT 'approved'; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE bi_sales ADD COLUMN source text DEFAULT 'manual'; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE bi_sales ADD COLUMN external_id text; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE bi_sales ADD COLUMN created_at timestamptz DEFAULT now(); EXCEPTION WHEN duplicate_column THEN NULL; END;
END $$;

-- Create unique index on external_id for upsert support
CREATE UNIQUE INDEX IF NOT EXISTS bi_sales_external_id_idx ON bi_sales(external_id) WHERE external_id IS NOT NULL;

-- Insert the 2 existing sales from HeroSpark (March 2026)
INSERT INTO bi_sales (revenue, sale_at, product, customer_name, customer_email, payment_method, status, source)
VALUES
  (1921.00, '2026-03-20 06:02:00-03', 'Programa de Aceleração VDB - 6 meses', 'Jefferson Aparecido Da Silva', 'jeapsilva635@gmail.com', 'credit_card', 'approved', 'herospark'),
  (1921.00, '2026-03-24 11:45:00-03', 'Programa de Aceleração VDB - 6 meses', 'Rosemary Espindola Rocha', 'roseamofoto@gmail.com', 'credit_card', 'approved', 'herospark')
ON CONFLICT DO NOTHING;
