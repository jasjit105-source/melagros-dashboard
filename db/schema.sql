-- Melagros Centro Dashboard — Neon Postgres schema
-- Replaces the Excel workbook: TIENDA, CAJA, CAJA FUERTE, Nomina, PRESTAMOS, Valle Control

-- STORES reference
CREATE TABLE IF NOT EXISTS stores (
  id    SERIAL PRIMARY KEY,
  name  TEXT UNIQUE NOT NULL,
  active BOOLEAN DEFAULT TRUE
);
INSERT INTO stores (name) VALUES ('Circunvalacion'), ('Leona Vicario')
ON CONFLICT (name) DO NOTHING;

-- DAILY_SALES — replaces the TIENDA tab
-- One row per store per day. Auto-populated from Corte or manual entry.
CREATE TABLE IF NOT EXISTS daily_sales (
  id              BIGSERIAL PRIMARY KEY,
  sale_date       DATE NOT NULL,
  store           TEXT NOT NULL,
  cb              NUMERIC DEFAULT 0,     -- carry-forward from previous day
  venta           NUMERIC DEFAULT 0,     -- sales
  otro_venta      NUMERIC DEFAULT 0,     -- other sales
  total_venta     NUMERIC DEFAULT 0,     -- computed: cb + venta + otro_venta
  gastos          NUMERIC DEFAULT 0,     -- expenses
  abono1          NUMERIC DEFAULT 0,     -- cash deposit 1
  abono2          NUMERIC DEFAULT 0,     -- cash deposit 2
  abono3          NUMERIC DEFAULT 0,     -- cash deposit 3
  tarjeta         NUMERIC DEFAULT 0,     -- card payments
  mayoreo         NUMERIC DEFAULT 0,     -- wholesale
  cb_next         NUMERIC DEFAULT 0,     -- carry-forward to next day
  deposito        NUMERIC DEFAULT 0,     -- total deposit (sum of abonos)
  source          TEXT DEFAULT 'manual', -- 'corte' or 'manual'
  corte_raw       JSONB,                 -- raw corte data from SQL Server
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(sale_date, store)
);
CREATE INDEX IF NOT EXISTS idx_ds_date ON daily_sales(sale_date);
CREATE INDEX IF NOT EXISTS idx_ds_store ON daily_sales(store);

-- CAJA — replaces the CAJA tab (main cashbox ledger)
CREATE TABLE IF NOT EXISTS caja (
  id              BIGSERIAL PRIMARY KEY,
  tx_date         DATE NOT NULL,
  category        TEXT NOT NULL,          -- Abono, Gasto, Nomina, Renta, Prestamo, Deposito, Ahorro, Vacation
  account         TEXT,                   -- sub-category: Tienda Centro, Caja Fuerte, Oyamil, etc.
  description     TEXT,
  abono           NUMERIC DEFAULT 0,     -- income
  gasto           NUMERIC DEFAULT 0,     -- expense
  saldo           NUMERIC DEFAULT 0,     -- running balance (computed on insert)
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_caja_date ON caja(tx_date);
CREATE INDEX IF NOT EXISTS idx_caja_cat ON caja(category);

-- CAJA_FUERTE — replaces the CAJA FUERTE tab (safe)
CREATE TABLE IF NOT EXISTS caja_fuerte (
  id              BIGSERIAL PRIMARY KEY,
  tx_date         DATE NOT NULL,
  description     TEXT,
  deposit         NUMERIC DEFAULT 0,
  debit           NUMERIC DEFAULT 0,
  saldo           NUMERIC DEFAULT 0,     -- running balance
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cf_date ON caja_fuerte(tx_date);

-- NOMINA — replaces the Nomina tab (payroll)
CREATE TABLE IF NOT EXISTS employees (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  store           TEXT,
  salary          NUMERIC DEFAULT 0,
  start_date      DATE,
  active          BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS nomina (
  id              BIGSERIAL PRIMARY KEY,
  pay_date        DATE NOT NULL,
  employee_id     INTEGER REFERENCES employees(id),
  employee_name   TEXT NOT NULL,
  store           TEXT,
  amount          NUMERIC DEFAULT 0,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_nom_date ON nomina(pay_date);

-- PRESTAMOS — replaces PRESTAMOS tab (JJ Ahorro loan tracking)
CREATE TABLE IF NOT EXISTS prestamos (
  id              BIGSERIAL PRIMARY KEY,
  account_name    TEXT NOT NULL DEFAULT 'JJ Ahorro',
  tx_date         DATE NOT NULL,
  description     TEXT,
  abono           NUMERIC DEFAULT 0,
  gasto           NUMERIC DEFAULT 0,
  saldo           NUMERIC DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_prest_date ON prestamos(tx_date);

-- VALLE_CONTROL — replaces Valle Control tab
CREATE TABLE IF NOT EXISTS valle_control (
  id              BIGSERIAL PRIMARY KEY,
  tx_date         DATE NOT NULL,
  description     TEXT,
  abono           NUMERIC DEFAULT 0,
  gasto           NUMERIC DEFAULT 0,
  saldo           NUMERIC DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_valle_date ON valle_control(tx_date);

-- ACCOUNT_CATEGORIES — for dropdown validation in CAJA
CREATE TABLE IF NOT EXISTS account_categories (
  id              SERIAL PRIMARY KEY,
  category        TEXT NOT NULL,
  sub_account     TEXT NOT NULL,
  UNIQUE(category, sub_account)
);
INSERT INTO account_categories (category, sub_account) VALUES
  ('Abono', 'Tienda Centro'), ('Abono', 'Caja Fuerte'), ('Abono', 'proyecto valle'),
  ('Abono', 'JJ Ahorro'), ('Abono', 'Seva'), ('Abono', 'Oyamel'),
  ('Gasto', 'Centro Tienda'), ('Gasto', 'Oyamil'), ('Gasto', 'TELEFONOS'),
  ('Gasto', 'ABOGADO'), ('Gasto', 'FACTURAS'), ('Gasto', 'DEPARTAMENTO'),
  ('Gasto', 'Jasjit Singh'), ('Gasto', 'vacaciones'),
  ('Renta', 'Circumvalacion'), ('Renta', 'Oyamil'), ('Renta', 'IZAZAGA'),
  ('Nomina', 'Centro Tienda'), ('Nomina', 'Oyamil'), ('Nomina', 'Solares'),
  ('Prestamo', 'Milagros'), ('Prestamo', 'Horacio'), ('Prestamo', 'Juana'),
  ('Deposito', 'Caja Fuerte'), ('Deposito', 'Banco'), ('Deposito', 'OXXO'),
  ('Ahorro', 'JJ Freadom Account'), ('Ahorro', 'Valle Project'), ('Ahorro', 'AMX Jasjit'),
  ('Vacation', 'Milagros'), ('Vacation', 'Yoana'), ('Vacation', 'Nancy'), ('Vacation', 'Horacio')
ON CONFLICT (category, sub_account) DO NOTHING;
