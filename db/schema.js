const pool = require('../config/db');

const schemaSql = `
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(150) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    password TEXT,
    password_hash TEXT,
    is_verified BOOLEAN DEFAULT TRUE,
    role VARCHAR(50) NOT NULL DEFAULT 'admin' CHECK (role IN ('super_admin', 'admin', 'store_manager')),
    store_id INTEGER,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(150) NOT NULL,
    email VARCHAR(150),
    phone VARCHAR(50),
    address TEXT,
    region_district VARCHAR(100),
    priority_level INTEGER DEFAULT 1,
    city VARCHAR(100),
    district VARCHAR(100),
    region_code VARCHAR(50),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS regions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(150) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS geocode_cache (
    query_key TEXT PRIMARY KEY,
    query_raw TEXT,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    provider TEXT DEFAULT 'nominatim',
    updated_at TIMESTAMP DEFAULT NOW()
);


CREATE TABLE IF NOT EXISTS store_regions (
  id SERIAL PRIMARY KEY,
  store_id TEXT NOT NULL,
  region TEXT NOT NULL,
  UNIQUE (store_id, region)
);

CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    slug VARCHAR(200) UNIQUE NOT NULL,
    name_pt VARCHAR(150),
    name_es VARCHAR(150),
    image_url TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku VARCHAR(100) UNIQUE NOT NULL,
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  category_name_pt VARCHAR(150),
  category_name_es VARCHAR(150),
  name_pt VARCHAR(255),
  name_es VARCHAR(255),
  description_pt TEXT,
  description_es TEXT,
  specifications JSONB DEFAULT '[]'::jsonb,
  base_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  is_promoted BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  
  CREATE TABLE IF NOT EXISTS product_translations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    language_code VARCHAR(10) NOT NULL CHECK (language_code IN ('pt', 'es')),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    UNIQUE(product_id, language_code)
);

  
CREATE TABLE IF NOT EXISTS product_attributes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
  
CREATE TABLE IF NOT EXISTS product_attribute_values (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attribute_id UUID NOT NULL REFERENCES product_attributes(id) ON DELETE CASCADE,
    value VARCHAR(100) NOT NULL,
    UNIQUE(attribute_id, value)
);

CREATE TABLE IF NOT EXISTS product_variants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    sku VARCHAR(100) UNIQUE NOT NULL,
    price DECIMAL(12,2) NOT NULL,
    compare_at_price DECIMAL(12,2),
    currency VARCHAR(10) DEFAULT 'EUR',
    attribute_values JSONB DEFAULT '{}'::jsonb,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS variant_attribute_values (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
    attribute_value_id UUID NOT NULL REFERENCES product_attribute_values(id) ON DELETE CASCADE,
    UNIQUE(variant_id, attribute_value_id)
);

CREATE TABLE IF NOT EXISTS product_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    alt_text TEXT,
    position INTEGER DEFAULT 0,
    is_primary BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS store_stock (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    variant_id UUID REFERENCES product_variants(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(store_id, product_id, variant_id)
);

CREATE TABLE IF NOT EXISTS store_inventory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
    stock_quantity INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(store_id, variant_id)
);

CREATE TABLE IF NOT EXISTS integration_settings (
  id SERIAL PRIMARY KEY,
  base_url TEXT,
  api_key TEXT,
  webhook_secret TEXT,
  is_active BOOLEAN DEFAULT false,
  sync_invoices BOOLEAN DEFAULT true,
  last_sync_at TIMESTAMP,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sync_logs (
  id SERIAL PRIMARY KEY,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS coupons (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('percentage','fixed')),
  value NUMERIC(12,2) NOT NULL,
  expiration TIMESTAMP,
  usage_limit INTEGER,
  usage_count INTEGER NOT NULL DEFAULT 0,
  restriction_type TEXT NOT NULL DEFAULT 'global' CHECK (restriction_type IN ('global','product','category')),
  restriction_id TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  order_number TEXT UNIQUE NOT NULL,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  shipping_address TEXT NOT NULL,
  shipping_region TEXT,
  assigned_store_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  subtotal NUMERIC(12,2) NOT NULL,
  discount_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'pending',
  shipping_status TEXT NOT NULL DEFAULT 'not_created',
  shipping_tracking_code TEXT,
  shipping_label_url TEXT,
  stock_committed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  sku TEXT,
  quantity INTEGER NOT NULL,
  unit_price NUMERIC(12,2) NOT NULL,
  line_total NUMERIC(12,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'manual',
  provider_method TEXT,
  provider_payment_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  amount NUMERIC(12,2) NOT NULL,
  transaction_ref TEXT,
  payment_url TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  webhook_payload JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_webhook_logs (
  id SERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  event_type TEXT,
  payload JSONB NOT NULL,
  processed BOOLEAN DEFAULT false,
  processing_error TEXT,
  received_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shipments (
  id SERIAL PRIMARY KEY,
  order_id INTEGER UNIQUE NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'ctt',
  status TEXT NOT NULL DEFAULT 'created',
  tracking_code TEXT UNIQUE,
  label_url TEXT,
  payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shipment_tracking_events (
  id SERIAL PRIMARY KEY,
  shipment_id INTEGER NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  location TEXT,
  description TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  occurred_at TIMESTAMP NOT NULL DEFAULT NOW(),
  raw_payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shipment_tracking_events_order_id
  ON shipment_tracking_events(order_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_shipment_tracking_events_shipment_id
  ON shipment_tracking_events(shipment_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY,
  invoice_number TEXT UNIQUE NOT NULL,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  pdf_base64 TEXT NOT NULL,
  synced BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS report_schedules (
  id SERIAL PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  report_type TEXT NOT NULL DEFAULT 'pending_orders',
  send_time_utc TEXT NOT NULL DEFAULT '09:00',
  recipient_email TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  last_sent_date DATE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_status TEXT NOT NULL DEFAULT 'not_created';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_tracking_code TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_label_url TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stock_committed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_method TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_payment_id TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_url TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS webhook_payload JSONB;
`;

async function ensureSchema() {
  await pool.query(schemaSql);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS sku VARCHAR(100)`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS category_name_pt VARCHAR(150)`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS category_name_es VARCHAR(150)`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS name_pt VARCHAR(255)`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS name_es VARCHAR(255)`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS description_pt TEXT`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS description_es TEXT`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS specifications JSONB DEFAULT '[]'::jsonb`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS base_price DECIMAL(12,2) DEFAULT 0`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS is_promoted BOOLEAN DEFAULT FALSE`);
  await pool.query(`ALTER TABLE products ALTER COLUMN base_price SET DEFAULT 0`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);

  await pool.query(`ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS compare_at_price DECIMAL(12,2)`);
  await pool.query(`ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'EUR'`);
  await pool.query(`ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS attribute_values JSONB DEFAULT '{}'::jsonb`);
  await pool.query(`ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE`);
  await pool.query(`ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);

  await pool.query(`ALTER TABLE product_images ADD COLUMN IF NOT EXISTS alt_text TEXT`);
  await pool.query(`ALTER TABLE product_images ADD COLUMN IF NOT EXISTS position INTEGER DEFAULT 0`);
  await pool.query(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS name_pt VARCHAR(150)`);
  await pool.query(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS name_es VARCHAR(150)`);
  await pool.query(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS image_url TEXT`);
  await pool.query(`ALTER TABLE shipment_tracking_events ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION`);
  await pool.query(`ALTER TABLE shipment_tracking_events ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION`);
  // Upgrade legacy FK column types to UUID so they match current primary keys.
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'order_items'
          AND column_name = 'product_id'
          AND data_type <> 'uuid'
      ) THEN
        ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_product_id_fkey;
        ALTER TABLE order_items
        ALTER COLUMN product_id TYPE UUID
        USING CASE
          WHEN product_id IS NULL THEN NULL
          WHEN product_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN product_id::text::uuid
          ELSE NULL
        END;
      END IF;
    END $$;
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'order_items'
          AND column_name = 'variant_id'
          AND data_type <> 'uuid'
      ) THEN
        ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_variant_id_fkey;
        ALTER TABLE order_items
        ALTER COLUMN variant_id TYPE UUID
        USING CASE
          WHEN variant_id IS NULL THEN NULL
          WHEN variant_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN variant_id::text::uuid
          ELSE NULL
        END;
      END IF;
    END $$;
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'report_schedules'
          AND column_name = 'store_id'
          AND data_type <> 'uuid'
      ) THEN
        ALTER TABLE report_schedules DROP CONSTRAINT IF EXISTS report_schedules_store_id_fkey;
        ALTER TABLE report_schedules
        ALTER COLUMN store_id TYPE UUID
        USING CASE
          WHEN store_id IS NULL THEN NULL
          WHEN store_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN store_id::text::uuid
          ELSE NULL
        END;
      END IF;
    END $$;
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'order_items_product_id_fkey'
      ) THEN
        ALTER TABLE order_items
        ADD CONSTRAINT order_items_product_id_fkey
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'order_items_variant_id_fkey'
      ) THEN
        ALTER TABLE order_items
        ADD CONSTRAINT order_items_variant_id_fkey
        FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE SET NULL;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'report_schedules_store_id_fkey'
      ) THEN
        ALTER TABLE report_schedules
        ADD CONSTRAINT report_schedules_store_id_fkey
        FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE;
      END IF;
    END $$;
  `);
  // Ensure store routing columns exist across legacy DBs.
  await pool.query(`ALTER TABLE stores ADD COLUMN IF NOT EXISTS region_district VARCHAR(100)`);
  await pool.query(`ALTER TABLE stores ADD COLUMN IF NOT EXISTS priority_level INTEGER DEFAULT 1`);
  await pool.query(`UPDATE stores SET priority_level = 1 WHERE priority_level IS NULL`);
  // Normalize legacy store_inventory table shapes (older DBs used INTEGER ids).
  await pool.query(`
    DO $$
    BEGIN
      IF to_regclass('public.store_inventory') IS NOT NULL THEN
        ALTER TABLE store_inventory DROP CONSTRAINT IF EXISTS store_inventory_store_id_variant_id_key;
        ALTER TABLE store_inventory DROP CONSTRAINT IF EXISTS store_inventory_store_id_fkey;
        ALTER TABLE store_inventory DROP CONSTRAINT IF EXISTS store_inventory_variant_id_fkey;

        -- Legacy integer identifiers cannot be mapped to UUID ids, so drop unmigratable rows.
        DELETE FROM store_inventory
        WHERE store_id::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           OR variant_id::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'store_inventory'
            AND column_name = 'store_id'
            AND data_type <> 'uuid'
        ) THEN
          ALTER TABLE store_inventory
          ALTER COLUMN store_id TYPE UUID
          USING store_id::text::uuid;
        END IF;

        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'store_inventory'
            AND column_name = 'variant_id'
            AND data_type <> 'uuid'
        ) THEN
          ALTER TABLE store_inventory
          ALTER COLUMN variant_id TYPE UUID
          USING variant_id::text::uuid;
        END IF;

        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'store_inventory'
            AND column_name = 'id'
            AND data_type <> 'uuid'
        ) THEN
          ALTER TABLE store_inventory DROP CONSTRAINT IF EXISTS store_inventory_pkey;
          ALTER TABLE store_inventory ALTER COLUMN id DROP DEFAULT;
          ALTER TABLE store_inventory
          ALTER COLUMN id TYPE UUID
          USING gen_random_uuid();
          ALTER TABLE store_inventory
          ALTER COLUMN id SET DEFAULT gen_random_uuid();
          ALTER TABLE store_inventory
          ADD CONSTRAINT store_inventory_pkey PRIMARY KEY (id);
        END IF;

        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'store_inventory_store_id_variant_id_key'
        ) THEN
          ALTER TABLE store_inventory
          ADD CONSTRAINT store_inventory_store_id_variant_id_key UNIQUE (store_id, variant_id);
        END IF;

        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'store_inventory_store_id_fkey'
        ) THEN
          ALTER TABLE store_inventory
          ADD CONSTRAINT store_inventory_store_id_fkey
          FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE;
        END IF;

        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'store_inventory_variant_id_fkey'
        ) THEN
          ALTER TABLE store_inventory
          ADD CONSTRAINT store_inventory_variant_id_fkey
          FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE CASCADE;
        END IF;
      END IF;
    END $$;
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'store_regions'
          AND column_name = 'store_id'
          AND data_type <> 'text'
      ) THEN
        ALTER TABLE store_regions
        ALTER COLUMN store_id TYPE TEXT USING store_id::text;
      END IF;
    END $$;
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'stores'
          AND column_name = 'district'
      ) THEN
        UPDATE stores
        SET region_district = district
        WHERE region_district IS NULL AND district IS NOT NULL;
      END IF;
    END $$;
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'orders'
          AND column_name = 'assigned_store_id'
          AND data_type <> 'text'
      ) THEN
        ALTER TABLE orders
        ALTER COLUMN assigned_store_id TYPE TEXT USING assigned_store_id::text;
      END IF;
    END $$;
  `);
  // Migrate legacy users table shape to the latest columns without dropping data.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT TRUE`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_code VARCHAR(10)`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_expires_at TIMESTAMP`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(50)`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS store_id INTEGER`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'password'
      ) AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'password_hash'
      ) THEN
        EXECUTE 'UPDATE users SET password_hash = password WHERE password_hash IS NULL AND password IS NOT NULL';
      END IF;
    END $$;
  `);
  await pool.query(`UPDATE users SET role = 'admin' WHERE role IS NULL`);
  await pool.query(`UPDATE users SET is_verified = TRUE WHERE is_verified IS NULL`);
  await pool.query(`UPDATE users SET is_active = TRUE WHERE is_active IS NULL`);
  await pool.query(`UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE updated_at IS NULL`);
  await pool.query(`ALTER TABLE users ALTER COLUMN role SET DEFAULT 'admin'`);
  await pool.query(`ALTER TABLE users ALTER COLUMN role SET NOT NULL`);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'users_role_check'
      ) THEN
        ALTER TABLE users
        ADD CONSTRAINT users_role_check
        CHECK (role IN ('super_admin', 'admin', 'store_manager'));
      END IF;
    END $$;
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'users_store_id_fkey'
      ) THEN
        ALTER TABLE users
        ADD CONSTRAINT users_store_id_fkey
        FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE SET NULL;
      END IF;
    EXCEPTION
      WHEN datatype_mismatch THEN
        -- Keep startup resilient if an older DB has incompatible store_id type.
        NULL;
    END $$;
  `);
  // Migrate legacy stores table shape to latest columns used by routing/bootstrap.
  await pool.query(`INSERT INTO integration_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
  await pool.query(`INSERT INTO app_settings (key, value) VALUES ('routing_mode', '"region"'::jsonb) ON CONFLICT (key) DO NOTHING`);
  await pool.query(`INSERT INTO app_settings (key, value) VALUES ('languages', '["pt","es"]'::jsonb) ON CONFLICT (key) DO NOTHING`);
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'coupons'
          AND column_name = 'restriction_id'
          AND data_type <> 'text'
      ) THEN
        ALTER TABLE coupons
        ALTER COLUMN restriction_id TYPE TEXT USING restriction_id::text;
      END IF;
    END $$;
  `);
  await pool.query(
    `INSERT INTO app_settings (key, value)
     VALUES ('payment_methods', '{"mbway":true,"mb_reference":true,"klarna":true}'::jsonb)
     ON CONFLICT (key)
     DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`
  );

  // Bootstrap default stores, adapting to the existing DB schema (no forced column assumptions).
  const storeCount = await pool.query(`SELECT COUNT(*)::int AS count FROM stores`);
  if (storeCount.rows[0]?.count === 0) {
    const storeColumnsResult = await pool.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'stores'`
    );
    const storeColumns = new Set(storeColumnsResult.rows.map((row) => row.column_name));

    const insertStore = async ({ name, region, priority, address }) => {
      const cols = [];
      const vals = [];
      const params = [];
      let idx = 1;

      if (storeColumns.has('name')) {
        cols.push('name');
        vals.push(`$${idx++}`);
        params.push(name);
      }

      if (storeColumns.has('region_district')) {
        cols.push('region_district');
        vals.push(`$${idx++}`);
        params.push(region);
      }

      if (storeColumns.has('priority_level')) {
        cols.push('priority_level');
        vals.push(`$${idx++}`);
        params.push(priority);
      }

      if (storeColumns.has('address')) {
        cols.push('address');
        vals.push(`$${idx++}`);
        params.push(address);
      }

      if (storeColumns.has('district') && !storeColumns.has('region_district')) {
        cols.push('district');
        vals.push(`$${idx++}`);
        params.push(region);
      }

      if (storeColumns.has('city')) {
        cols.push('city');
        vals.push(`$${idx++}`);
        params.push(name.split(' ')[0]);
      }

      if (storeColumns.has('region_code')) {
        cols.push('region_code');
        vals.push(`$${idx++}`);
        params.push(region);
      }

      if (storeColumns.has('is_active')) {
        cols.push('is_active');
        vals.push(`$${idx++}`);
        params.push(true);
      }

      if (cols.length === 0) {
        return null;
      }

      const created = await pool.query(
        `INSERT INTO stores (${cols.join(', ')})
         VALUES (${vals.join(', ')})
         RETURNING id`,
        params
      );
      return created.rows[0]?.id || null;
    };

    const lisbonId = await insertStore({
      name: 'Lisbon Central',
      region: 'lisbon',
      priority: 1,
      address: 'Lisbon - PT',
    });
    const portoId = await insertStore({
      name: 'Porto Hub',
      region: 'porto',
      priority: 2,
      address: 'Porto - PT',
    });
    const madridId = await insertStore({
      name: 'Madrid Norte',
      region: 'madrid',
      priority: 3,
      address: 'Madrid - ES',
    });

    const storeRegionsColumnsResult = await pool.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'store_regions'`
    );
    const storeRegionsColumns = new Set(storeRegionsColumnsResult.rows.map((row) => row.column_name));

    if (
      lisbonId &&
      portoId &&
      madridId &&
      storeRegionsColumns.has('store_id') &&
      storeRegionsColumns.has('region')
    ) {
      await pool.query(
        `INSERT INTO store_regions (store_id, region)
         VALUES
           ($1, 'lisbon'),
           ($1, 'setubal'),
           ($2, 'porto'),
           ($2, 'braga'),
           ($3, 'madrid')
         ON CONFLICT DO NOTHING`,
        [lisbonId, portoId, madridId]
      );
    }
  }
}

module.exports = { ensureSchema };
