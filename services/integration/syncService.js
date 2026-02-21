const { createExternalClient } = require('./client');

function slugify(value) {
  if (!value) return '';
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function resolveSku(item) {
  if (item?.sku) return String(item.sku);
  const base = slugify(item?.name_pt || item?.name_es || item?.name || 'product');
  return `${base || 'product'}-${Date.now()}`;
}

function resolveBasePrice(item) {
  const price = Number(item?.price);
  return Number.isFinite(price) ? price : 0;
}

async function getSettings(pool) {
  const result = await pool.query(`SELECT * FROM integration_settings WHERE id = 1`);
  return result.rows[0];
}

async function upsertProduct(pool, item) {
  const sku = resolveSku(item);
  const basePrice = resolveBasePrice(item);
  const product = await pool.query(
    `INSERT INTO products (sku, base_price, category_id, name_pt, name_es, description_pt, description_es, is_active, is_promoted)
     VALUES ($1, $2, $3, $4, $5, $6, $7, true, COALESCE($8, false))
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      sku,
      basePrice,
      item.category_id || null,
      item.name_pt || item.name || 'Unnamed',
      item.name_es || item.name || 'Sin nombre',
      item.description_pt || '',
      item.description_es || '',
      item.is_promoted || false,
    ]
  );

  if (product.rows[0]?.id) return product.rows[0].id;

  const existing = await pool.query(
    `SELECT p.id
     FROM products p
     JOIN product_variants pv ON pv.product_id = p.id
     WHERE pv.sku = $1
     LIMIT 1`,
    [item.sku]
  );

    if (existing.rows[0]?.id) {
      await pool.query(
        `UPDATE products
       SET sku = COALESCE($1, sku),
           base_price = COALESCE($2, base_price),
           name_pt = $3,
           name_es = $4,
           description_pt = $5,
           description_es = $6,
           is_promoted = COALESCE($7, is_promoted),
           updated_at = NOW()
       WHERE id = $8`,
      [
        sku,
        basePrice,
        item.name_pt || item.name || 'Unnamed',
        item.name_es || item.name || 'Sin nombre',
        item.description_pt || '',
        item.description_es || '',
        item.is_promoted || false,
        existing.rows[0].id,
      ]
    );
    return existing.rows[0].id;
  }

  const created = await pool.query(
    `INSERT INTO products (sku, base_price, category_id, name_pt, name_es, description_pt, description_es, is_active, is_promoted)
     VALUES ($1, $2, $3, $4, $5, $6, $7, true, COALESCE($8, false))
     RETURNING id`,
    [
      sku,
      basePrice,
      item.category_id || null,
      item.name_pt || item.name || 'Unnamed',
      item.name_es || item.name || 'Sin nombre',
      item.description_pt || '',
      item.description_es || '',
      item.is_promoted || false,
    ]
  );

  return created.rows[0].id;
}

async function upsertVariant(pool, productId, item) {
  const variant = await pool.query(
    `INSERT INTO product_variants (product_id, sku, price, compare_at_price, currency, attribute_values, is_active, updated_at)
     VALUES ($1, $2, $3, $4, COALESCE($5, 'EUR'), COALESCE($6::jsonb, '{}'::jsonb), true, NOW())
     ON CONFLICT (sku)
     DO UPDATE SET
       product_id = EXCLUDED.product_id,
       price = EXCLUDED.price,
       compare_at_price = EXCLUDED.compare_at_price,
       currency = EXCLUDED.currency,
       attribute_values = EXCLUDED.attribute_values,
       updated_at = NOW()
     RETURNING id`,
    [
      productId,
      item.sku,
      item.price || 0,
      item.compare_at_price || null,
      item.currency || 'EUR',
      JSON.stringify(item.attribute_values || {}),
    ]
  );

  return variant.rows[0].id;
}

async function upsertInventory(pool, variantId, entries) {
  for (const entry of entries || []) {
    await pool.query(
      `INSERT INTO store_inventory (store_id, variant_id, stock_quantity, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (store_id, variant_id)
       DO UPDATE SET stock_quantity = EXCLUDED.stock_quantity, updated_at = NOW()`,
      [entry.store_id, variantId, entry.stock_quantity || 0]
    );
  }
}

async function performSync(pool, mode, payload) {
  const settings = await getSettings(pool);
  if (!settings?.is_active) {
    throw new Error('Integration is disabled');
  }

  let data = payload;
  if (!data) {
    const client = createExternalClient(settings.base_url, settings.api_key);
    data = await client.get('/products-sync');
  }

  const products = data.products || [];
  for (const item of products) {
    const productId = await upsertProduct(pool, item);
    const variantId = await upsertVariant(pool, productId, item);
    await upsertInventory(pool, variantId, item.inventory || []);
  }

  await pool.query(
    `UPDATE integration_settings SET last_sync_at = NOW(), updated_at = NOW() WHERE id = 1`
  );

  await pool.query(
    `INSERT INTO sync_logs (mode, status, details) VALUES ($1, 'success', $2::jsonb)`,
    [mode, JSON.stringify({ count: products.length })]
  );

  return { synced_products: products.length };
}

async function syncInvoice(pool, invoice) {
  const settings = await getSettings(pool);
  if (!settings?.is_active || !settings.sync_invoices) {
    return { skipped: true };
  }

  const client = createExternalClient(settings.base_url, settings.api_key);
  await client.post('/invoices', invoice);

  return { synced: true };
}

module.exports = { getSettings, performSync, syncInvoice };
