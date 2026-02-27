const pool = require('../config/db');
const { getSettings, performSync } = require('../services/integration/syncService');

async function getIntegrationSettings(req, res) {
  try {
    const settings = await getSettings(pool);
    res.json(settings);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function updateIntegrationSettings(req, res) {
  try {
    const { base_url, api_key, webhook_secret, is_active, sync_invoices } = req.body;
    const result = await pool.query(
      `UPDATE integration_settings
       SET base_url = COALESCE($1, base_url),
           api_key = COALESCE($2, api_key),
           webhook_secret = COALESCE($3, webhook_secret),
           is_active = COALESCE($4, is_active),
           sync_invoices = COALESCE($5, sync_invoices),
           updated_at = NOW()
       WHERE id = 1
       RETURNING *`,
      [base_url, api_key, webhook_secret, is_active, sync_invoices]
    );

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function manualSync(req, res) {
  try {
    const output = await performSync(pool, 'manual', null);
    res.json(output);
  } catch (error) {
    await pool.query(
      `INSERT INTO sync_logs (mode, status, details) VALUES ('manual', 'failed', $1::jsonb)`,
      [JSON.stringify({ message: error.message })]
    );
    res.status(500).json({ message: error.message });
  }
}

async function webhookSync(req, res) {
  try {
    const settings = await getSettings(pool);
    if (settings?.webhook_secret && req.headers['x-webhook-secret'] !== settings.webhook_secret) {
      return res.status(401).json({ message: 'Invalid webhook secret' });
    }

    const output = await performSync(pool, 'webhook', req.body);
    res.json(output);
  } catch (error) {
    await pool.query(
      `INSERT INTO sync_logs (mode, status, details) VALUES ('webhook', 'failed', $1::jsonb)`,
      [JSON.stringify({ message: error.message })]
    );
    res.status(500).json({ message: error.message });
  }
}

async function getSyncLogs(req, res) {
  try {
    const result = await pool.query(`SELECT * FROM sync_logs ORDER BY created_at DESC LIMIT 50`);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function getMockProductsSync(req, res) {
  try {
    const storesResult = await pool.query(
      `SELECT id::text AS id
       FROM stores
       WHERE is_active = true
       ORDER BY COALESCE(priority_level, 1) ASC, id ASC`
    );
    const activeStores = storesResult.rows.map((row) => row.id);

    const variantsResult = await pool.query(
      `SELECT
         pv.id::text AS variant_id,
         pv.sku,
         pv.price,
         pv.compare_at_price,
         pv.currency,
         pv.attribute_values,
         p.name_pt,
         p.name_es,
         p.description_pt,
         p.description_es,
         p.is_promoted,
         p.category_id::text AS category_id
       FROM product_variants pv
       JOIN products p ON p.id = pv.product_id
       WHERE pv.is_active = true AND p.is_active = true
       ORDER BY pv.updated_at DESC
       LIMIT 100`
    );

    const products = [];
    for (const variant of variantsResult.rows) {
      let inventory = [];
      if (activeStores.length > 0) {
        const inventoryResult = await pool.query(
          `SELECT store_id::text AS store_id, stock_quantity
           FROM store_inventory
           WHERE variant_id::text = $1::text
             AND store_id::text = ANY($2::text[])`,
          [variant.variant_id, activeStores]
        );
        inventory = inventoryResult.rows.map((entry) => ({
          store_id: entry.store_id,
          stock_quantity: Number(entry.stock_quantity) || 0,
        }));
      }

      if (inventory.length === 0 && activeStores[0]) {
        inventory = [{ store_id: activeStores[0], stock_quantity: 0 }];
      }

      products.push({
        sku: variant.sku,
        name_pt: variant.name_pt || 'Unnamed',
        name_es: variant.name_es || 'Sin nombre',
        description_pt: variant.description_pt || '',
        description_es: variant.description_es || '',
        price: Number(variant.price) || 0,
        compare_at_price: variant.compare_at_price != null ? Number(variant.compare_at_price) : null,
        currency: variant.currency || 'EUR',
        attribute_values: variant.attribute_values || {},
        is_promoted: Boolean(variant.is_promoted),
        category_id: variant.category_id || null,
        inventory,
      });
    }

    res.json({ products });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

module.exports = {
  getIntegrationSettings,
  updateIntegrationSettings,
  manualSync,
  webhookSync,
  getSyncLogs,
  getMockProductsSync,
};
