const pool = require('../config/db');

function parseNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

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

async function resolveCategoryNames(categoryId) {
  if (!categoryId) return { category_name_pt: null, category_name_es: null };
  const result = await pool.query(`SELECT name_pt, name_es FROM categories WHERE id = $1`, [categoryId]);
  return {
    category_name_pt: result.rows[0]?.name_pt ?? null,
    category_name_es: result.rows[0]?.name_es ?? null,
  };
}

async function getProducts(req, res) {
  try {
    const result = await pool.query(`
      SELECT
        p.*,
        COALESCE(c.name_pt, p.category_name_pt) AS category_name_pt,
        COALESCE(c.name_es, p.category_name_es) AS category_name_es,
        c.slug AS category_slug
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      ORDER BY p.created_at DESC NULLS LAST, p.id DESC
    `);

    const products = [];
    for (const product of result.rows) {
      const variants = await pool.query(`SELECT * FROM product_variants WHERE product_id = $1 ORDER BY created_at ASC, id ASC`, [product.id]);
      const images = await pool.query(`SELECT * FROM product_images WHERE product_id = $1 ORDER BY position ASC, id ASC`, [product.id]);
      products.push({ ...product, variants: variants.rows, images: images.rows });
    }

    res.json(products);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function createProduct(req, res) {
  try {
    const {
      category_id,
      sku,
      base_price,
      name_pt,
      name_es,
      description_pt,
      description_es,
      specifications = [],
      is_active = true,
      is_promoted = false,
      variants = [],
      images = [],
    } = req.body;

    if (!name_pt && !name_es) {
      return res.status(400).json({ message: 'name_pt or name_es is required' });
    }

    const resolvedNamePt = name_pt || name_es;
    const resolvedNameEs = name_es || name_pt;

    const primaryVariant = Array.isArray(variants) ? variants[0] : null;
    const resolvedSku = sku || primaryVariant?.sku || `${slugify(resolvedNamePt || resolvedNameEs)}-${Date.now()}`;
    const resolvedBasePrice = parseNumber(base_price ?? primaryVariant?.price, 0);
    const { category_name_pt, category_name_es } = await resolveCategoryNames(category_id || null);

    const productResult = await pool.query(
      `INSERT INTO products (sku, category_id, category_name_pt, category_name_es, base_price, name_pt, name_es, description_pt, description_es, specifications, is_active, is_promoted, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,NOW())
       RETURNING *`,
      [
        resolvedSku,
        category_id || null,
        category_name_pt,
        category_name_es,
        resolvedBasePrice,
        resolvedNamePt,
        resolvedNameEs,
        description_pt || '',
        description_es || '',
        JSON.stringify(Array.isArray(specifications) ? specifications : []),
        is_active,
        is_promoted,
      ]
    );

    const product = productResult.rows[0];

    for (const variant of variants) {
      await pool.query(
        `INSERT INTO product_variants (product_id, sku, price, compare_at_price, currency, attribute_values, is_active, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,NOW())`,
        [
          product.id,
          variant.sku,
          parseNumber(variant.price),
          variant.compare_at_price != null ? parseNumber(variant.compare_at_price) : null,
          variant.currency || 'EUR',
          JSON.stringify(variant.attribute_values || {}),
          variant.is_active ?? true,
        ]
      );
    }

    for (let i = 0; i < images.length; i += 1) {
      const image = images[i];
      await pool.query(
        `INSERT INTO product_images (product_id, image_url, alt_text, position)
         VALUES ($1,$2,$3,$4)`,
        [product.id, image.image_url, image.alt_text || '', image.position ?? i]
      );
    }

    res.status(201).json(product);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function updateProduct(req, res) {
  try {
    const id = req.params.id;
    const {
      category_id,
      sku,
      base_price,
      name_pt,
      name_es,
      description_pt,
      description_es,
      specifications,
      is_active,
      is_promoted,
    } = req.body;

    const resolvedBasePrice = base_price != null ? parseNumber(base_price) : null;
    const hasCategoryId = Object.prototype.hasOwnProperty.call(req.body, 'category_id');
    const resolvedCategory =
      hasCategoryId ? await resolveCategoryNames(category_id || null) : { category_name_pt: null, category_name_es: null };

    const query = hasCategoryId
      ? `UPDATE products
         SET sku = COALESCE($1, sku),
             category_id = $2,
             category_name_pt = $3,
             category_name_es = $4,
             base_price = COALESCE($5, base_price),
             name_pt = COALESCE($6, name_pt),
             name_es = COALESCE($7, name_es),
             description_pt = COALESCE($8, description_pt),
             description_es = COALESCE($9, description_es),
             specifications = COALESCE($10::jsonb, specifications),
             is_active = COALESCE($11, is_active),
             is_promoted = COALESCE($12, is_promoted),
             updated_at = NOW()
         WHERE id = $13
         RETURNING *`
      : `UPDATE products
         SET sku = COALESCE($1, sku),
             base_price = COALESCE($2, base_price),
             name_pt = COALESCE($3, name_pt),
             name_es = COALESCE($4, name_es),
             description_pt = COALESCE($5, description_pt),
             description_es = COALESCE($6, description_es),
             specifications = COALESCE($7::jsonb, specifications),
             is_active = COALESCE($8, is_active),
             is_promoted = COALESCE($9, is_promoted),
             updated_at = NOW()
         WHERE id = $10
         RETURNING *`;

    const params = hasCategoryId
      ? [
          sku,
          category_id || null,
          resolvedCategory.category_name_pt,
          resolvedCategory.category_name_es,
          resolvedBasePrice,
          name_pt,
          name_es,
          description_pt,
          description_es,
          specifications ? JSON.stringify(specifications) : null,
          is_active,
          is_promoted,
          id,
        ]
      : [
          sku,
          resolvedBasePrice,
          name_pt,
          name_es,
          description_pt,
          description_es,
          specifications ? JSON.stringify(specifications) : null,
          is_active,
          is_promoted,
          id,
        ];

    const result = await pool.query(query, params);

    if (!result.rows[0]) {
      return res.status(404).json({ message: 'Product not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function deleteProduct(req, res) {
  const client = await pool.connect();
  try {
    const id = req.params.id;

    await client.query('BEGIN');

    await client.query(`DELETE FROM product_images WHERE product_id = $1`, [id]);
    await client.query(`DELETE FROM product_variants WHERE product_id = $1`, [id]);

    const storeInventory = await client.query(`SELECT to_regclass('public.store_inventory') AS name`);
    if (storeInventory.rows[0]?.name) {
      await client.query(
        `DELETE FROM store_inventory
         WHERE variant_id::text IN (SELECT id::text FROM product_variants WHERE product_id = $1)`,
        [id]
      );
    }

    const storeStock = await client.query(`SELECT to_regclass('public.store_stock') AS name`);
    if (storeStock.rows[0]?.name) {
      await client.query(
        `DELETE FROM store_stock
         WHERE product_id = $1
            OR variant_id::text IN (SELECT id::text FROM product_variants WHERE product_id = $1)`,
        [id]
      );
    }

    const result = await client.query(`DELETE FROM products WHERE id = $1`, [id]);
    await client.query('COMMIT');

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }

    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: error.message });
  } finally {
    client.release();
  }
}

async function addProductImage(req, res) {
  try {
    const productId = req.params.id;
    const { image_url, alt_text = '', position = 0 } = req.body;

    const result = await pool.query(
      `INSERT INTO product_images (product_id, image_url, alt_text, position)
       VALUES ($1,$2,$3,$4)
       RETURNING *`,
      [productId, image_url, alt_text, position]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function deleteProductImage(req, res) {
  try {
    const productId = req.params.id;
    const imageId = req.params.imageId;

    await pool.query(`DELETE FROM product_images WHERE id = $1 AND product_id = $2`, [imageId, productId]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function createVariant(req, res) {
  try {
    const productId = req.params.id;
    const { sku, price, compare_at_price, currency = 'EUR', attribute_values = {}, is_active = true } = req.body;

    const result = await pool.query(
      `INSERT INTO product_variants (product_id, sku, price, compare_at_price, currency, attribute_values, is_active, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,NOW())
       RETURNING *`,
      [productId, sku, parseNumber(price), compare_at_price != null ? parseNumber(compare_at_price) : null, currency, JSON.stringify(attribute_values), is_active]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function updateVariant(req, res) {
  try {
    const variantId = req.params.variantId;
    const { sku, price, compare_at_price, currency, attribute_values, is_active } = req.body;

    const result = await pool.query(
      `UPDATE product_variants
       SET sku = COALESCE($1, sku),
           price = COALESCE($2, price),
           compare_at_price = COALESCE($3, compare_at_price),
           currency = COALESCE($4, currency),
           attribute_values = COALESCE($5::jsonb, attribute_values),
           is_active = COALESCE($6, is_active),
           updated_at = NOW()
       WHERE id = $7
       RETURNING *`,
      [sku, price != null ? parseNumber(price) : null, compare_at_price != null ? parseNumber(compare_at_price) : null, currency, attribute_values ? JSON.stringify(attribute_values) : null, is_active, variantId]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ message: 'Variant not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function deleteVariant(req, res) {
  try {
    const variantId = req.params.variantId;
    await pool.query(`DELETE FROM product_variants WHERE id = $1`, [variantId]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function getCategories(req, res) {
  try {
    const result = await pool.query(`
      SELECT
        c.*,
        COALESCE(pc.product_count, 0) AS product_count
      FROM categories c
      LEFT JOIN (
        SELECT category_id, COUNT(*)::int AS product_count
        FROM products
        GROUP BY category_id
      ) pc ON pc.category_id = c.id
      ORDER BY c.created_at DESC NULLS LAST, c.slug ASC
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function createCategory(req, res) {
  try {
    const { name_pt, name_es, parent_id, is_active = true, slug, image_url } = req.body;
    const resolvedSlug = slugify(slug || name_pt || name_es);
    if (!resolvedSlug) {
      return res.status(400).json({ message: 'name_pt or name_es is required' });
    }
    const result = await pool.query(
      `INSERT INTO categories (slug, name_pt, name_es, parent_id, image_url, is_active, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW())
       RETURNING *`,
      [resolvedSlug, name_pt || null, name_es || null, parent_id || null, image_url || null, is_active]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function updateCategory(req, res) {
  try {
    const id = req.params.id;
    const { name_pt, name_es, parent_id, is_active, slug, image_url } = req.body;
    const resolvedSlug = slug ? slugify(slug) : null;
    if (slug && !resolvedSlug) {
      return res.status(400).json({ message: 'slug is invalid' });
    }
    const result = await pool.query(
      `UPDATE categories
       SET name_pt = COALESCE($1, name_pt),
           name_es = COALESCE($2, name_es),
           slug = COALESCE($3, slug),
           parent_id = COALESCE($4, parent_id),
           image_url = COALESCE($5, image_url),
           is_active = COALESCE($6, is_active),
           updated_at = NOW()
       WHERE id = $7
       RETURNING *`,
      [name_pt, name_es, resolvedSlug, parent_id, image_url, is_active, id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ message: 'Category not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function deleteCategory(req, res) {
  try {
    const id = req.params.id;
    await pool.query(`DELETE FROM categories WHERE id = $1`, [id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function getAttributes(req, res) {
  try {
    const result = await pool.query(`SELECT * FROM product_attributes ORDER BY id DESC`);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function createAttribute(req, res) {
  try {
    const { name_pt, name_es } = req.body;
    const result = await pool.query(
      `INSERT INTO product_attributes (name_pt, name_es)
       VALUES ($1, $2)
       RETURNING *`,
      [name_pt, name_es]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function updateAttribute(req, res) {
  try {
    const id = Number(req.params.id);
    const { name_pt, name_es } = req.body;
    const result = await pool.query(
      `UPDATE product_attributes
       SET name_pt = COALESCE($1, name_pt),
           name_es = COALESCE($2, name_es)
       WHERE id = $3
       RETURNING *`,
      [name_pt, name_es, id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ message: 'Attribute not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function deleteAttribute(req, res) {
  try {
    const id = Number(req.params.id);
    await pool.query(`DELETE FROM product_attributes WHERE id = $1`, [id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function getInventory(req, res) {
  try {
    const productId = String(req.params.id || '').trim();
    if (!productId) {
      return res.status(400).json({ message: 'Invalid product id' });
    }

    const source = await pool.query(
      `SELECT
         to_regclass('public.store_inventory') IS NOT NULL AS has_store_inventory,
         to_regclass('public.store_stock') IS NOT NULL AS has_store_stock`
    );
    const hasStoreInventory = Boolean(source.rows[0]?.has_store_inventory);
    const hasStoreStock = Boolean(source.rows[0]?.has_store_stock);

    let rows = [];
    if (hasStoreInventory) {
      const result = await pool.query(
        `SELECT
           si.store_id,
           si.variant_id,
           si.stock_quantity,
           si.updated_at,
           s.name AS store_name,
           pv.sku,
           pv.product_id
         FROM store_inventory si
         JOIN stores s ON s.id::text = si.store_id::text
         JOIN product_variants pv ON pv.id::text = si.variant_id::text
         WHERE pv.product_id::text = $1::text
         ORDER BY COALESCE(s.priority_level, 1) ASC, s.name ASC`,
        [productId]
      );
      rows = result.rows;
    } else if (hasStoreStock) {
      const result = await pool.query(
        `SELECT
           ss.store_id,
           ss.variant_id,
           ss.quantity AS stock_quantity,
           ss.updated_at,
           s.name AS store_name,
           pv.sku,
           COALESCE(pv.product_id, ss.product_id) AS product_id
         FROM store_stock ss
         JOIN stores s ON s.id::text = ss.store_id::text
         LEFT JOIN product_variants pv ON pv.id::text = ss.variant_id::text
         WHERE COALESCE(pv.product_id::text, ss.product_id::text) = $1::text
         ORDER BY COALESCE(s.priority_level, 1) ASC, s.name ASC`,
        [productId]
      );
      rows = result.rows;
    }

    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function updateInventory(req, res) {
  try {
    const variantId = String(req.params.variantId || '').trim();
    const storeId = String(req.params.storeId || '').trim();
    const { stock_quantity } = req.body;
    if (!variantId || !storeId) {
      return res.status(400).json({ message: 'Invalid variant/store id' });
    }

    const integration = await pool.query(`SELECT is_active FROM integration_settings WHERE id = 1`);
    if (integration.rows[0]?.is_active) {
      return res.status(403).json({ message: 'Stock is managed by integration and cannot be edited manually.' });
    }

    const safeStock = Math.max(0, parseNumber(stock_quantity));
    const source = await pool.query(
      `SELECT
         to_regclass('public.store_inventory') IS NOT NULL AS has_store_inventory,
         to_regclass('public.store_stock') IS NOT NULL AS has_store_stock`
    );
    const hasStoreInventory = Boolean(source.rows[0]?.has_store_inventory);
    const hasStoreStock = Boolean(source.rows[0]?.has_store_stock);

    let result;
    if (hasStoreInventory) {
      result = await pool.query(
        `INSERT INTO store_inventory (store_id, variant_id, stock_quantity, updated_at)
         VALUES ($1,$2,$3,NOW())
         ON CONFLICT (store_id, variant_id)
         DO UPDATE SET stock_quantity = EXCLUDED.stock_quantity, updated_at = NOW()
         RETURNING *`,
        [storeId, variantId, safeStock]
      );
    } else if (hasStoreStock) {
      const variant = await pool.query(`SELECT product_id FROM product_variants WHERE id::text = $1::text LIMIT 1`, [variantId]);
      const productId = variant.rows[0]?.product_id;
      if (!productId) {
        return res.status(404).json({ message: 'Variant not found' });
      }
      result = await pool.query(
        `INSERT INTO store_stock (store_id, product_id, variant_id, quantity, updated_at)
         VALUES ($1,$2,$3,$4,NOW())
         ON CONFLICT (store_id, product_id, variant_id)
         DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = NOW()
         RETURNING *, quantity AS stock_quantity`,
        [storeId, productId, variantId, safeStock]
      );
    } else {
      return res.status(500).json({ message: 'No inventory table found (store_inventory/store_stock).' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

module.exports = {
  getProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  addProductImage,
  deleteProductImage,
  createVariant,
  updateVariant,
  deleteVariant,
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getAttributes,
  createAttribute,
  updateAttribute,
  deleteAttribute,
  getInventory,
  updateInventory,
};
