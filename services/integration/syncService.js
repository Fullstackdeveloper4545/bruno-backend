const { createExternalClient } = require('./client');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HTML_TAG_REGEX = /<[^>]*>/g;
const WORDPRESS_PRODUCTS_PATH_REGEX = /\/wp-json\/wc\/v3\/products/i;

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

function toText(value) {
  if (value == null) return '';
  return String(value).trim();
}

function stripHtml(value) {
  return toText(value).replace(HTML_TAG_REGEX, ' ').replace(/\s+/g, ' ').trim();
}

function toNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeCurrency(value) {
  const normalized = toText(value).toUpperCase();
  return normalized || 'EUR';
}

function resolveSku(item) {
  const existing = toText(item?.sku);
  if (existing) return existing;
  const base = slugify(item?.name_pt || item?.name_es || item?.name || item?.title || 'product');
  return `${base || 'product'}-${Date.now()}`;
}

function resolveBasePrice(item) {
  const price = toNumber(item?.price, null);
  if (price != null) return price;
  const fallback = toNumber(item?.regular_price, 0);
  return fallback != null ? fallback : 0;
}

function normalizeCompareAtPrice(compareAt, price) {
  const parsed = toNumber(compareAt, null);
  if (parsed == null || parsed <= Number(price || 0)) return null;
  return parsed;
}

function normalizeAttributeValues(rawValue) {
  if (rawValue == null) return {};

  if (typeof rawValue === 'string') {
    try {
      return normalizeAttributeValues(JSON.parse(rawValue));
    } catch (_) {
      return {};
    }
  }

  if (Array.isArray(rawValue)) {
    const output = {};
    for (const item of rawValue) {
      if (!item || typeof item !== 'object') continue;
      const key = toText(item.name || item.slug);
      if (!key) continue;
      if (Array.isArray(item.options) && item.options.length > 0) {
        output[key] = toText(item.options.join(', '));
        continue;
      }
      const value = toText(item.option || item.value);
      if (value) output[key] = value;
    }
    return output;
  }

  if (typeof rawValue === 'object') {
    return Object.entries(rawValue).reduce((acc, [key, value]) => {
      const normalizedKey = toText(key);
      if (!normalizedKey) return acc;
      const normalizedValue = toText(value);
      if (!normalizedValue) return acc;
      acc[normalizedKey] = normalizedValue;
      return acc;
    }, {});
  }

  return {};
}

function normalizeImageEntries(rawImages) {
  if (!Array.isArray(rawImages)) return undefined;

  return rawImages
    .map((item, index) => {
      if (typeof item === 'string') {
        const imageUrl = toText(item);
        if (!imageUrl) return null;
        return { image_url: imageUrl, alt_text: '', position: index };
      }
      if (!item || typeof item !== 'object') return null;

      const imageUrl = toText(item.image_url || item.src || item.url);
      if (!imageUrl) return null;

      return {
        image_url: imageUrl,
        alt_text: toText(item.alt_text || item.alt || item.name || ''),
        position: Number.isInteger(Number(item.position)) ? Number(item.position) : index,
      };
    })
    .filter(Boolean);
}

function normalizeInventoryEntries(rawEntries) {
  if (!Array.isArray(rawEntries)) return [];

  return rawEntries
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const storeId = toText(entry.store_id);
      if (!UUID_REGEX.test(storeId)) return null;
      const stockQuantity = toNumber(entry.stock_quantity, 0);
      return {
        store_id: storeId,
        stock_quantity: Math.max(0, Number(stockQuantity || 0)),
      };
    })
    .filter(Boolean);
}

function isWordPressProduct(item) {
  if (!item || typeof item !== 'object') return false;
  if ('regular_price' in item || 'sale_price' in item || 'stock_status' in item || 'on_sale' in item) return true;
  return Array.isArray(item.images) && Array.isArray(item.categories) && ('type' in item || 'permalink' in item);
}

function normalizeWordPressProduct(item) {
  const sku = resolveSku(item);
  const price = toNumber(item?.price, null) ?? toNumber(item?.sale_price, null) ?? toNumber(item?.regular_price, 0) ?? 0;
  const compareAt = normalizeCompareAtPrice(item?.regular_price, price);
  const category = Array.isArray(item?.categories) ? item.categories.find((entry) => entry && typeof entry === 'object') : null;
  const categoryName = toText(category?.name);
  const categorySlug = slugify(category?.slug || categoryName);
  const status = toText(item?.status).toLowerCase();
  const isActive = !['draft', 'pending', 'private', 'trash'].includes(status);

  const explicitInventory = normalizeInventoryEntries(item?.inventory);
  if (explicitInventory.length === 0) {
    const stockQuantity = toNumber(item?.stock_quantity, null);
    const storeId = toText(item?.store_id || item?.default_store_id);
    if (stockQuantity != null && UUID_REGEX.test(storeId)) {
      explicitInventory.push({ store_id: storeId, stock_quantity: Math.max(0, stockQuantity) });
    }
  }

  return {
    sku,
    name_pt: toText(item?.name) || 'Unnamed',
    name_es: toText(item?.name) || 'Sin nombre',
    description_pt: stripHtml(item?.description || item?.short_description),
    description_es: stripHtml(item?.description || item?.short_description),
    price,
    compare_at_price: compareAt,
    currency: normalizeCurrency(item?.currency),
    attribute_values: normalizeAttributeValues(item?.attributes),
    is_promoted: Boolean(item?.on_sale || (compareAt != null && compareAt > price)),
    is_active: isActive,
    category_slug: categorySlug || null,
    category_name_pt: categoryName || null,
    category_name_es: categoryName || null,
    images: normalizeImageEntries(item?.images),
    inventory: explicitInventory,
  };
}

function normalizeNativeProduct(item) {
  const sku = resolveSku(item);
  const price = resolveBasePrice(item);
  const compareAt = normalizeCompareAtPrice(item?.compare_at_price, price);
  const categoryNamePt = toText(item?.category_name_pt || item?.category_name);
  const categoryNameEs = toText(item?.category_name_es || item?.category_name || categoryNamePt);

  return {
    sku,
    name_pt: toText(item?.name_pt || item?.name) || 'Unnamed',
    name_es: toText(item?.name_es || item?.name) || 'Sin nombre',
    description_pt: toText(item?.description_pt || item?.description),
    description_es: toText(item?.description_es || item?.description),
    price,
    compare_at_price: compareAt,
    currency: normalizeCurrency(item?.currency),
    attribute_values: normalizeAttributeValues(item?.attribute_values),
    is_promoted: Boolean(item?.is_promoted),
    is_active: item?.is_active !== false,
    category_id: toText(item?.category_id) || null,
    category_slug: slugify(item?.category_slug || item?.category_name || ''),
    category_name_pt: categoryNamePt || null,
    category_name_es: categoryNameEs || null,
    images: normalizeImageEntries(item?.images),
    inventory: normalizeInventoryEntries(item?.inventory),
  };
}

function normalizeIncomingProduct(item) {
  if (!item || typeof item !== 'object') return null;
  if (isWordPressProduct(item)) return normalizeWordPressProduct(item);
  return normalizeNativeProduct(item);
}

function extractRawProducts(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    if (Array.isArray(payload.products)) return payload.products;
    if (Array.isArray(payload.items)) return payload.items;
    if (payload.product && typeof payload.product === 'object') return [payload.product];
    if (payload.data && Array.isArray(payload.data.products)) return payload.data.products;
    if (Array.isArray(payload.data)) return payload.data;
    return [payload];
  }
  return [];
}

function normalizeProductsPayload(payload) {
  const rawProducts = extractRawProducts(payload);
  return rawProducts
    .map((item) => normalizeIncomingProduct(item))
    .filter((item) => item && item.sku);
}

function isWordPressBaseUrl(baseUrl) {
  const normalized = toText(baseUrl).toLowerCase();
  if (!normalized) return false;
  return normalized.includes('/wp-json/') || normalized.includes('wordpress');
}

function buildWordPressAuthHeader(apiKey) {
  const raw = toText(apiKey);
  if (!raw) return null;
  if (/^bearer\s+/i.test(raw)) return raw;
  if (raw.includes(':')) {
    return `Basic ${Buffer.from(raw).toString('base64')}`;
  }
  return `Bearer ${raw}`;
}

function buildWordPressProductsEndpoint(baseUrl) {
  const normalized = toText(baseUrl).replace(/\/+$/, '');
  if (!normalized) {
    throw new Error('Integration base URL is not configured');
  }
  if (WORDPRESS_PRODUCTS_PATH_REGEX.test(normalized)) return normalized;
  if (/\/wp-json\/wc\/v3$/i.test(normalized)) return `${normalized}/products`;
  if (/\/wp-json$/i.test(normalized)) return `${normalized}/wc/v3/products`;
  return `${normalized}/wp-json/wc/v3/products`;
}

async function fetchWordPressProducts(settings) {
  const endpoint = buildWordPressProductsEndpoint(settings.base_url);
  const perPage = 100;
  const maxPages = 20;
  const authHeader = buildWordPressAuthHeader(settings.api_key);
  const allRows = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL(endpoint);
    if (!url.searchParams.has('per_page')) {
      url.searchParams.set('per_page', String(perPage));
    }
    url.searchParams.set('page', String(page));

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
    });

    if (response.status === 400 && page > 1) {
      break;
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`WordPress API GET ${url.pathname} failed: ${response.status} ${text}`);
    }

    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      break;
    }

    allRows.push(...rows);

    const headerPages = toNumber(response.headers.get('x-wp-totalpages'), null);
    if (headerPages != null && page >= headerPages) {
      break;
    }

    const currentPerPage = toNumber(url.searchParams.get('per_page'), perPage) || perPage;
    if (rows.length < currentPerPage) {
      break;
    }
  }

  return { data: { products: allRows }, source: 'wordpress' };
}

async function fetchProductsFromIntegration(settings) {
  const baseUrl = toText(settings?.base_url);
  if (!baseUrl) {
    throw new Error('Integration base URL is not configured');
  }

  if (isWordPressBaseUrl(baseUrl)) {
    return fetchWordPressProducts(settings);
  }

  const client = createExternalClient(baseUrl, settings.api_key);
  try {
    const data = await client.get('/products-sync');
    return { data, source: 'products-sync' };
  } catch (error) {
    try {
      return await fetchWordPressProducts(settings);
    } catch (fallbackError) {
      throw new Error(`${error.message}; WordPress fallback failed: ${fallbackError.message}`);
    }
  }
}

async function getSettings(pool) {
  const result = await pool.query(`SELECT * FROM integration_settings WHERE id = 1`);
  return result.rows[0];
}

async function resolveCategoryId(pool, item) {
  const rawCategoryId = toText(item?.category_id);
  if (rawCategoryId && UUID_REGEX.test(rawCategoryId)) {
    return rawCategoryId;
  }

  const namePt = toText(item?.category_name_pt || item?.category_name);
  const nameEs = toText(item?.category_name_es || item?.category_name || namePt);
  const slug = slugify(item?.category_slug || namePt || nameEs);

  if (slug) {
    const existingBySlug = await pool.query(`SELECT id FROM categories WHERE slug = $1 LIMIT 1`, [slug]);
    if (existingBySlug.rows[0]?.id) {
      return existingBySlug.rows[0].id;
    }
  }

  const lookupName = namePt || nameEs;
  if (lookupName) {
    const existingByName = await pool.query(
      `SELECT id
       FROM categories
       WHERE LOWER(COALESCE(name_pt, '')) = LOWER($1)
          OR LOWER(COALESCE(name_es, '')) = LOWER($1)
       LIMIT 1`,
      [lookupName]
    );
    if (existingByName.rows[0]?.id) {
      return existingByName.rows[0].id;
    }
  }

  if (!slug && !lookupName) {
    return null;
  }

  const safeSlug = slug || `category-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const inserted = await pool.query(
    `INSERT INTO categories (slug, name_pt, name_es, is_active, updated_at)
     VALUES ($1, $2, $3, true, NOW())
     ON CONFLICT (slug)
     DO UPDATE SET
       name_pt = COALESCE(EXCLUDED.name_pt, categories.name_pt),
       name_es = COALESCE(EXCLUDED.name_es, categories.name_es),
       updated_at = NOW()
     RETURNING id`,
    [safeSlug, namePt || lookupName || null, nameEs || lookupName || null]
  );

  return inserted.rows[0]?.id || null;
}

async function upsertProduct(pool, item) {
  const sku = resolveSku(item);
  const basePrice = resolveBasePrice(item);
  const categoryId = await resolveCategoryId(pool, item);
  const isActive = item?.is_active !== false;
  const product = await pool.query(
    `INSERT INTO products (sku, base_price, category_id, name_pt, name_es, description_pt, description_es, is_active, is_promoted)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, false))
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      sku,
      basePrice,
      categoryId,
      item.name_pt || item.name || 'Unnamed',
      item.name_es || item.name || 'Sin nombre',
      item.description_pt || '',
      item.description_es || '',
      isActive,
      item.is_promoted || false,
    ]
  );

  if (product.rows[0]?.id) return product.rows[0].id;

  const existingByProductSku = await pool.query(`SELECT id FROM products WHERE sku = $1 LIMIT 1`, [sku]);
  if (existingByProductSku.rows[0]?.id) {
    await pool.query(
      `UPDATE products
       SET category_id = COALESCE($1, category_id),
           base_price = COALESCE($2, base_price),
           name_pt = $3,
           name_es = $4,
           description_pt = $5,
           description_es = $6,
           is_active = COALESCE($7, is_active),
           is_promoted = COALESCE($8, is_promoted),
           updated_at = NOW()
       WHERE id = $9`,
      [
        categoryId,
        basePrice,
        item.name_pt || item.name || 'Unnamed',
        item.name_es || item.name || 'Sin nombre',
        item.description_pt || '',
        item.description_es || '',
        isActive,
        item.is_promoted || false,
        existingByProductSku.rows[0].id,
      ]
    );
    return existingByProductSku.rows[0].id;
  }

  const existingByVariantSku = await pool.query(
    `SELECT p.id
     FROM products p
     JOIN product_variants pv ON pv.product_id = p.id
     WHERE pv.sku = $1
     LIMIT 1`,
    [sku]
  );

  if (existingByVariantSku.rows[0]?.id) {
    await pool.query(
      `UPDATE products
       SET sku = COALESCE($1, sku),
           category_id = COALESCE($2, category_id),
           base_price = COALESCE($3, base_price),
           name_pt = $4,
           name_es = $5,
           description_pt = $6,
           description_es = $7,
           is_active = COALESCE($8, is_active),
           is_promoted = COALESCE($9, is_promoted),
           updated_at = NOW()
       WHERE id = $10`,
      [
        sku,
        categoryId,
        basePrice,
        item.name_pt || item.name || 'Unnamed',
        item.name_es || item.name || 'Sin nombre',
        item.description_pt || '',
        item.description_es || '',
        isActive,
        item.is_promoted || false,
        existingByVariantSku.rows[0].id,
      ]
    );
    return existingByVariantSku.rows[0].id;
  }

  const created = await pool.query(
    `INSERT INTO products (sku, base_price, category_id, name_pt, name_es, description_pt, description_es, is_active, is_promoted)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, false))
     RETURNING id`,
    [
      sku,
      basePrice,
      categoryId,
      item.name_pt || item.name || 'Unnamed',
      item.name_es || item.name || 'Sin nombre',
      item.description_pt || '',
      item.description_es || '',
      isActive,
      item.is_promoted || false,
    ]
  );

  return created.rows[0].id;
}

async function upsertVariant(pool, productId, item) {
  const sku = resolveSku(item);
  const price = resolveBasePrice(item);
  const compareAtPrice = normalizeCompareAtPrice(item.compare_at_price, price);
  const variant = await pool.query(
    `INSERT INTO product_variants (product_id, sku, price, compare_at_price, currency, attribute_values, is_active, updated_at)
     VALUES ($1, $2, $3, $4, COALESCE($5, 'EUR'), COALESCE($6::jsonb, '{}'::jsonb), COALESCE($7, true), NOW())
     ON CONFLICT (sku)
     DO UPDATE SET
       product_id = EXCLUDED.product_id,
       price = EXCLUDED.price,
       compare_at_price = EXCLUDED.compare_at_price,
       currency = EXCLUDED.currency,
       attribute_values = EXCLUDED.attribute_values,
       is_active = EXCLUDED.is_active,
       updated_at = NOW()
     RETURNING id`,
    [
      productId,
      sku,
      price,
      compareAtPrice,
      normalizeCurrency(item.currency),
      JSON.stringify(normalizeAttributeValues(item.attribute_values)),
      item.is_active !== false,
    ]
  );

  return variant.rows[0].id;
}

async function upsertProductImages(pool, productId, images) {
  if (!Array.isArray(images)) return;
  const normalized = normalizeImageEntries(images) || [];

  await pool.query(`DELETE FROM product_images WHERE product_id = $1`, [productId]);
  for (const image of normalized) {
    await pool.query(
      `INSERT INTO product_images (product_id, image_url, alt_text, position)
       VALUES ($1, $2, $3, $4)`,
      [productId, image.image_url, image.alt_text || '', image.position || 0]
    );
  }
}

async function upsertInventory(pool, variantId, entries) {
  const normalized = normalizeInventoryEntries(entries);
  for (const entry of normalized) {
    await pool.query(
      `INSERT INTO store_inventory (store_id, variant_id, stock_quantity, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (store_id, variant_id)
       DO UPDATE SET stock_quantity = EXCLUDED.stock_quantity, updated_at = NOW()`,
      [entry.store_id, variantId, entry.stock_quantity]
    );
  }
}

async function performSync(pool, mode, payload) {
  const settings = await getSettings(pool);
  if (!settings?.is_active) {
    throw new Error('Integration is disabled');
  }

  let data = payload;
  let source = 'payload';
  if (!data) {
    const fetched = await fetchProductsFromIntegration(settings);
    data = fetched.data;
    source = fetched.source;
  }

  const products = normalizeProductsPayload(data);
  for (const item of products) {
    const productId = await upsertProduct(pool, item);
    const variantId = await upsertVariant(pool, productId, item);
    await upsertInventory(pool, variantId, item.inventory || []);
    await upsertProductImages(pool, productId, item.images);
  }

  await pool.query(
    `UPDATE integration_settings SET last_sync_at = NOW(), updated_at = NOW() WHERE id = 1`
  );

  await pool.query(
    `INSERT INTO sync_logs (mode, status, details) VALUES ($1, 'success', $2::jsonb)`,
    [mode, JSON.stringify({ count: products.length, source })]
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
