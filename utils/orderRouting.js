function normalizeId(value) {
  if (value == null) return '';
  return String(value).trim().toLowerCase();
}

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function normalizeItems(items) {
  if (!Array.isArray(items)) return [];

  return items
    .map((item) => ({
      productId: normalizeId(item?.product_id),
      variantId: normalizeId(item?.variant_id),
      quantity: toPositiveInt(item?.quantity),
    }))
    .filter((item) => item.quantity > 0 && (item.productId || item.variantId));
}

async function listStores(pool, activeOnly) {
  const result = await pool.query(
    `SELECT s.*,
            COALESCE(
              ARRAY_AGG(DISTINCT LOWER(sr.region)) FILTER (WHERE sr.region IS NOT NULL),
              '{}'::text[]
            ) AS mapped_regions
     FROM stores s
     LEFT JOIN store_regions sr ON sr.store_id::text = s.id::text
     ${activeOnly ? 'WHERE s.is_active = true' : ''}
     GROUP BY s.id
     ORDER BY COALESCE(s.priority_level, 1) ASC, s.id ASC`
  );

  return result.rows.map((store) => ({
    ...store,
    mapped_regions: Array.isArray(store.mapped_regions) ? store.mapped_regions : [],
    normalized_region_district: normalizeId(store.region_district || store.district || ''),
  }));
}

async function getInventorySources(pool) {
  const result = await pool.query(
    `SELECT
      to_regclass('public.store_inventory') IS NOT NULL AS has_store_inventory,
      to_regclass('public.store_stock') IS NOT NULL AS has_store_stock`
  );

  const row = result.rows[0] || {};
  return {
    hasStoreInventory: Boolean(row.has_store_inventory),
    hasStoreStock: Boolean(row.has_store_stock),
  };
}

async function getStoreStockForItem(pool, storeId, item, sources) {
  const normalizedStoreId = normalizeId(storeId);
  if (!normalizedStoreId) return 0;

  let inventoryVariantQty = null;
  if (sources.hasStoreInventory && item.variantId) {
    const invResult = await pool.query(
      `SELECT COALESCE(MAX(stock_quantity), 0)::int AS qty
       FROM store_inventory
       WHERE store_id::text = $1::text
         AND variant_id::text = $2::text`,
      [normalizedStoreId, item.variantId]
    );
    inventoryVariantQty = Number(invResult.rows[0]?.qty || 0);
  }

  let stockVariantQty = null;
  if (sources.hasStoreStock && item.variantId) {
    const stockResult = await pool.query(
      `SELECT COALESCE(SUM(quantity), 0)::int AS qty
       FROM store_stock
       WHERE store_id::text = $1::text
         AND variant_id::text = $2::text`,
      [normalizedStoreId, item.variantId]
    );
    stockVariantQty = Number(stockResult.rows[0]?.qty || 0);
  }

  // Prefer store_inventory for variant-level stock when available, fallback to store_stock.
  if (inventoryVariantQty != null) return Math.max(0, inventoryVariantQty);
  if (stockVariantQty != null) return Math.max(0, stockVariantQty);

  if (sources.hasStoreStock && item.productId) {
    const productResult = await pool.query(
      `SELECT COALESCE(SUM(quantity), 0)::int AS qty
       FROM store_stock
       WHERE store_id::text = $1::text
         AND product_id::text = $2::text`,
      [normalizedStoreId, item.productId]
    );
    return Math.max(0, Number(productResult.rows[0]?.qty || 0));
  }

  return 0;
}

async function scoreStoreAgainstItems(pool, store, items, sources) {
  if (items.length === 0) {
    return { canFulfill: true, fulfilledLines: 0, availableUnits: 0 };
  }

  let fulfilledLines = 0;
  let availableUnits = 0;
  let canFulfill = true;

  for (const item of items) {
    const available = await getStoreStockForItem(pool, store.id, item, sources);
    availableUnits += Math.min(available, item.quantity);
    if (available >= item.quantity) {
      fulfilledLines += 1;
    } else {
      canFulfill = false;
    }
  }

  return { canFulfill, fulfilledLines, availableUnits };
}

async function findBestFulfillmentStore(pool, stores, items, sources) {
  if (stores.length === 0) return null;
  if (items.length === 0) return stores[0];

  let best = null;

  for (const store of stores) {
    const score = await scoreStoreAgainstItems(pool, store, items, sources);

    if (score.canFulfill) {
      return store;
    }

    if (!best) {
      best = { store, score };
      continue;
    }

    const betterByLines = score.fulfilledLines > best.score.fulfilledLines;
    const equalLinesMoreUnits =
      score.fulfilledLines === best.score.fulfilledLines &&
      score.availableUnits > best.score.availableUnits;

    if (betterByLines || equalLinesMoreUnits) {
      best = { store, score };
    }
  }

  return best?.store || null;
}

async function assignStoreForOrder(pool, shippingRegion, items) {
  const normalizedRegion = normalizeId(shippingRegion);
  const normalizedItems = normalizeItems(items);
  const sources = await getInventorySources(pool);
  const activeStores = await listStores(pool, true);

  if (activeStores.length > 0) {
    const regionMatchedStores = normalizedRegion
      ? activeStores.filter(
          (store) =>
            store.mapped_regions.includes(normalizedRegion) ||
            store.normalized_region_district === normalizedRegion
        )
      : [];

    // 1) Region-first routing.
    if (regionMatchedStores.length > 0) {
      const regionBest = await findBestFulfillmentStore(
        pool,
        regionMatchedStores,
        normalizedItems,
        sources
      );
      if (regionBest) {
        const regionBestScore = await scoreStoreAgainstItems(
          pool,
          regionBest,
          normalizedItems,
          sources
        );
        if (regionBestScore.canFulfill || normalizedItems.length === 0) {
          return regionBest;
        }
      }
    }

    // 2) If region store cannot fulfill full quantity, auto-switch to another store.
    const nonRegionStores = normalizedRegion
      ? activeStores.filter(
          (store) =>
            !store.mapped_regions.includes(normalizedRegion) &&
            store.normalized_region_district !== normalizedRegion
        )
      : activeStores;

    if (nonRegionStores.length > 0) {
      const redirectedStore = await findBestFulfillmentStore(
        pool,
        nonRegionStores,
        normalizedItems,
        sources
      );
      if (redirectedStore) {
        const redirectedScore = await scoreStoreAgainstItems(
          pool,
          redirectedStore,
          normalizedItems,
          sources
        );
        if (redirectedScore.canFulfill) {
          return redirectedStore;
        }
      }
    }

    // 3) If no store can fully fulfill, return the best available active store.
    const bestOverall = await findBestFulfillmentStore(
      pool,
      activeStores,
      normalizedItems,
      sources
    );
    if (bestOverall) {
      return bestOverall;
    }
  }

  // Fallback: no active stores available.
  const anyStore = await listStores(pool, false);
  if (anyStore[0]) {
    if (!anyStore[0].is_active) {
      const activated = await pool.query(
        `UPDATE stores SET is_active = true WHERE id::text = $1::text RETURNING *`,
        [anyStore[0].id]
      );
      return activated.rows[0];
    }
    return anyStore[0];
  }

  // Last-resort bootstrap.
  const created = await pool.query(
    `INSERT INTO stores (name, region_district, priority_level, address, is_active)
     VALUES ('Default Store', 'global', 1, 'Auto-created fallback', true)
     RETURNING *`
  );
  await pool.query(
    `INSERT INTO store_regions (store_id, region) VALUES ($1::text, 'global') ON CONFLICT DO NOTHING`,
    [created.rows[0].id]
  );
  return created.rows[0];
}

module.exports = { assignStoreForOrder };
