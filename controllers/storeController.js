const pool = require('../config/db');

function parseStoreId(value) {
  if (value == null) return '';
  return String(value).trim();
}

function parseRegions(value) {
  if (!Array.isArray(value)) return [];
  const unique = new Set();
  value
    .map((item) => String(item || '').trim().toLowerCase())
    .filter((item) => Boolean(item))
    .forEach((item) => unique.add(item));
  return Array.from(unique);
}

async function listStores(req, res) {
  try {
    const stores = await pool.query(`SELECT * FROM stores ORDER BY COALESCE(priority_level, 1) ASC, id ASC`);

    const result = [];
    for (const store of stores.rows) {
      const regions = await pool.query(
        `SELECT region FROM store_regions WHERE store_id::text = $1::text ORDER BY id ASC`,
        [store.id]
      );
      result.push({ ...store, regions: regions.rows.map((r) => r.region) });
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function createStore(req, res) {
  const client = await pool.connect();
  try {
    const {
      name,
      region_district,
      priority_level = 1,
      address,
      is_active = true,
      regions = [],
    } = req.body;

    const normalizedName = String(name || '').trim();
    const normalizedDistrict = String(region_district || '').trim();
    const normalizedAddress = String(address || '').trim();
    const normalizedPriority = Number(priority_level);
    const normalizedRegions = parseRegions(regions);

    if (!normalizedName) {
      return res.status(400).json({ message: 'Store name is required' });
    }
    if (!normalizedDistrict) {
      return res.status(400).json({ message: 'region_district is required' });
    }
    if (!normalizedAddress) {
      return res.status(400).json({ message: 'address is required' });
    }
    if (!Number.isInteger(normalizedPriority) || normalizedPriority < 1) {
      return res.status(400).json({ message: 'priority_level must be an integer greater than 0' });
    }

    await client.query('BEGIN');
    const storeResult = await client.query(
      `INSERT INTO stores (name, region_district, priority_level, address, is_active)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [normalizedName, normalizedDistrict, normalizedPriority, normalizedAddress, Boolean(is_active)]
    );

    const store = storeResult.rows[0];

    for (const region of normalizedRegions) {
      await client.query(
        `INSERT INTO store_regions (store_id, region) VALUES ($1::text, $2) ON CONFLICT DO NOTHING`,
        [store.id, region]
      );
    }

    await client.query('COMMIT');
    res.status(201).json(store);
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: error.message });
  } finally {
    client.release();
  }
}

async function updateStore(req, res) {
  const client = await pool.connect();
  try {
    const id = parseStoreId(req.params.id);
    if (!id) {
      return res.status(400).json({ message: 'Invalid store id' });
    }

    const { name, region_district, priority_level, address, is_active, regions } = req.body;
    const normalizedRegions = Array.isArray(regions) ? parseRegions(regions) : null;

    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE stores
       SET name = COALESCE($1, name),
           region_district = COALESCE($2, region_district),
           priority_level = COALESCE($3, priority_level),
           address = COALESCE($4, address),
           is_active = COALESCE($5, is_active)
       WHERE id::text = $6::text
       RETURNING *`,
      [name, region_district, priority_level, address, is_active, id]
    );

    if (!result.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Store not found' });
    }

    if (normalizedRegions) {
      await client.query(`DELETE FROM store_regions WHERE store_id::text = $1::text`, [id]);
      for (const region of normalizedRegions) {
        await client.query(
          `INSERT INTO store_regions (store_id, region) VALUES ($1::text, $2) ON CONFLICT DO NOTHING`,
          [id, region]
        );
      }
    }

    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: error.message });
  } finally {
    client.release();
  }
}

async function deleteStore(req, res) {
  try {
    const id = parseStoreId(req.params.id);
    if (!id) {
      return res.status(400).json({ message: 'Invalid store id' });
    }
    await pool.query(`DELETE FROM stores WHERE id::text = $1::text`, [id]);
    await pool.query(`DELETE FROM store_regions WHERE store_id::text = $1::text`, [id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function getRoutingConfig(req, res) {
  try {
    const result = await pool.query(`SELECT value FROM app_settings WHERE key = 'routing_mode'`);
    const raw = result.rows[0]?.value;
    const mode = typeof raw === 'string' ? raw : raw?.mode || 'region';
    res.json({ mode });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function setRoutingConfig(req, res) {
  try {
    const { mode } = req.body;
    if (!['region', 'quantity'].includes(mode)) {
      return res.status(400).json({ message: 'mode must be region or quantity' });
    }

    await pool.query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('routing_mode', $1::jsonb, NOW())
       ON CONFLICT (key)
       DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify(mode)]
    );

    res.json({ mode });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

module.exports = {
  listStores,
  createStore,
  updateStore,
  deleteStore,
  getRoutingConfig,
  setRoutingConfig,
};
