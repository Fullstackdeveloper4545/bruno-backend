const REGION_COORDINATES = Object.freeze({
  // Portugal
  lisbon: { lat: 38.7223, lng: -9.1393 },
  lisboa: { lat: 38.7223, lng: -9.1393 },
  porto: { lat: 41.1579, lng: -8.6291 },
  setubal: { lat: 38.5244, lng: -8.8882 },
  coimbra: { lat: 40.2033, lng: -8.4103 },
  braga: { lat: 41.5454, lng: -8.4265 },
  aveiro: { lat: 40.6405, lng: -8.6538 },
  faro: { lat: 37.0194, lng: -7.9304 },
  leiria: { lat: 39.7436, lng: -8.8071 },
  viseu: { lat: 40.6566, lng: -7.9125 },
  evora: { lat: 38.571, lng: -7.9135 },
  guarda: { lat: 40.5373, lng: -7.2675 },
  santarem: { lat: 39.2367, lng: -8.685 },
  'castelo branco': { lat: 39.8222, lng: -7.4909 },
  portalegre: { lat: 39.2967, lng: -7.428 },
  beja: { lat: 38.014, lng: -7.8632 },
  'viana do castelo': { lat: 41.6932, lng: -8.8329 },
  'vila real': { lat: 41.301, lng: -7.7441 },
  braganca: { lat: 41.806, lng: -6.7567 },
  'ponta delgada': { lat: 37.7412, lng: -25.6756 },
  funchal: { lat: 32.6669, lng: -16.9241 },
  algarve: { lat: 37.0179, lng: -7.9308 },

  // Spain
  madrid: { lat: 40.4168, lng: -3.7038 },
  barcelona: { lat: 41.3874, lng: 2.1686 },
  valencia: { lat: 39.4699, lng: -0.3763 },
  seville: { lat: 37.3891, lng: -5.9845 },
  sevilla: { lat: 37.3891, lng: -5.9845 },
  zaragoza: { lat: 41.6488, lng: -0.8891 },
  malaga: { lat: 36.7213, lng: -4.4214 },
  murcia: { lat: 37.9922, lng: -1.1307 },
  bilbao: { lat: 43.263, lng: -2.935 },
  alicante: { lat: 38.3452, lng: -0.481 },
  valladolid: { lat: 41.6523, lng: -4.7245 },
  vigo: { lat: 42.2406, lng: -8.7207 },
  gijon: { lat: 43.5322, lng: -5.6611 },
  'a coruna': { lat: 43.3623, lng: -8.4115 },
  coruna: { lat: 43.3623, lng: -8.4115 },
  granada: { lat: 37.1773, lng: -3.5986 },
  cordoba: { lat: 37.8882, lng: -4.7794 },
  palma: { lat: 39.5696, lng: 2.6502 },
  pamplona: { lat: 42.8125, lng: -1.6458 },
  'san sebastian': { lat: 43.3183, lng: -1.9812 },
  salamanca: { lat: 40.9701, lng: -5.6635 },
  toledo: { lat: 39.8628, lng: -4.0273 },
  santander: { lat: 43.4623, lng: -3.80998 },
});

function normalizeId(value) {
  if (value == null) return '';
  return String(value).trim().toLowerCase();
}

function normalizeRegionName(value) {
  if (value == null) return '';
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9,\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
    `SELECT s.*
     FROM stores s
     ${activeOnly ? 'WHERE s.is_active = true' : ''}
     ORDER BY COALESCE(s.priority_level, 1) ASC, s.id ASC`
  );

  return result.rows.map((store) => ({
    ...store,
    normalized_region_district: normalizeRegionName(store.region_district || store.district || ''),
  }));
}

function parseCoordinates(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const match = text.match(/^(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

async function lookupCoordinates(pool, value) {
  const parsed = parseCoordinates(value);
  if (parsed) return parsed;

  const normalized = normalizeRegionName(value);
  if (!normalized) return null;

  if (REGION_COORDINATES[normalized]) {
    return REGION_COORDINATES[normalized];
  }

  const parts = normalized
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  for (const part of parts) {
    if (REGION_COORDINATES[part]) return REGION_COORDINATES[part];
  }

  const tokens = normalized
    .replace(/-/g, ' ')
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean);
  for (let size = Math.min(4, tokens.length); size >= 1; size -= 1) {
    for (let i = 0; i + size <= tokens.length; i += 1) {
      const chunk = tokens.slice(i, i + size).join(' ');
      if (REGION_COORDINATES[chunk]) return REGION_COORDINATES[chunk];
    }
  }

  try {
    const cached = await pool.query(
      `SELECT latitude, longitude
       FROM geocode_cache
       WHERE query_key = $1
       LIMIT 1`,
      [normalized]
    );
    if (cached.rows[0]) {
      return {
        lat: Number(cached.rows[0].latitude),
        lng: Number(cached.rows[0].longitude),
      };
    }
  } catch {
    // Geocode cache table may not exist yet; continue without cache.
  }

  try {
    const endpoint = process.env.GEOCODER_URL || 'https://nominatim.openstreetmap.org/search';
    const url = new URL(endpoint);
    url.searchParams.set('q', String(value || '').trim());
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '1');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(process.env.GEOCODER_TIMEOUT_MS || 4000));
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': process.env.GEOCODER_USER_AGENT || 'BrunoMarketplace/1.0 (routing geocoder)',
        Accept: 'application/json',
      },
    });
    clearTimeout(timeout);

    if (!response.ok) return null;
    const data = await response.json();
    const first = Array.isArray(data) ? data[0] : null;
    const lat = Number(first?.lat);
    const lng = Number(first?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    try {
      await pool.query(
        `INSERT INTO geocode_cache (query_key, query_raw, latitude, longitude, provider, updated_at)
         VALUES ($1, $2, $3, $4, 'nominatim', NOW())
         ON CONFLICT (query_key)
         DO UPDATE SET
           query_raw = EXCLUDED.query_raw,
           latitude = EXCLUDED.latitude,
           longitude = EXCLUDED.longitude,
           provider = EXCLUDED.provider,
           updated_at = NOW()`,
        [normalized, String(value || '').trim(), lat, lng]
      );
    } catch {
      // Cache insert should not block routing.
    }

    return { lat, lng };
  } catch {
    return null;
  }

  return null;
}

async function resolveStoreCoordinates(pool, store) {
  const candidates = [
    store?.region_district,
    store?.city,
    store?.district,
    store?.region_code,
    store?.address,
  ];
  for (const candidate of candidates) {
    const coords = await lookupCoordinates(pool, candidate);
    if (coords) return coords;
  }
  return null;
}

function haversineKm(from, to) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const earthKm = 6371;
  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthKm * c;
}

async function rankStoresByDistance(pool, stores, shippingRegion) {
  const customerCoords = await lookupCoordinates(pool, shippingRegion);
  const normalizedShippingRegion = normalizeRegionName(shippingRegion);

  const scoredStores = await Promise.all(
    stores.map(async (store) => {
      const storeCoords = await resolveStoreCoordinates(pool, store);
      const distanceKm =
        customerCoords && storeCoords
          ? haversineKm(customerCoords, storeCoords)
          : store.normalized_region_district && store.normalized_region_district === normalizedShippingRegion
            ? 0
            : Number.POSITIVE_INFINITY;

      return {
        ...store,
        _distance_km: distanceKm,
      };
    })
  );

  return scoredStores
    .sort((a, b) => {
      const aDistance = Number.isFinite(a._distance_km) ? a._distance_km : Number.MAX_SAFE_INTEGER;
      const bDistance = Number.isFinite(b._distance_km) ? b._distance_km : Number.MAX_SAFE_INTEGER;
      if (aDistance !== bDistance) return aDistance - bDistance;

      const aPriority = Number.isFinite(Number(a.priority_level)) ? Number(a.priority_level) : 1;
      const bPriority = Number.isFinite(Number(b.priority_level)) ? Number(b.priority_level) : 1;
      if (aPriority !== bPriority) return aPriority - bPriority;

      return String(a.id).localeCompare(String(b.id));
    });
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
  const normalizedItems = normalizeItems(items);
  const sources = await getInventorySources(pool);
  const activeStores = await listStores(pool, true);

  if (activeStores.length > 0) {
    const rankedStores = await rankStoresByDistance(pool, activeStores, shippingRegion);

    let bestPartial = null;
    for (const store of rankedStores) {
      const score = await scoreStoreAgainstItems(pool, store, normalizedItems, sources);

      // Distance-first routing: nearest store gets first chance.
      if (score.canFulfill || normalizedItems.length === 0) {
        return store;
      }

      if (!bestPartial) {
        bestPartial = { store, score };
        continue;
      }

      const betterByLines = score.fulfilledLines > bestPartial.score.fulfilledLines;
      const equalLinesMoreUnits =
        score.fulfilledLines === bestPartial.score.fulfilledLines &&
        score.availableUnits > bestPartial.score.availableUnits;
      const equalStockButNearer =
        score.fulfilledLines === bestPartial.score.fulfilledLines &&
        score.availableUnits === bestPartial.score.availableUnits &&
        (Number.isFinite(store._distance_km) ? store._distance_km : Number.MAX_SAFE_INTEGER) <
          (Number.isFinite(bestPartial.store._distance_km)
            ? bestPartial.store._distance_km
            : Number.MAX_SAFE_INTEGER);

      if (betterByLines || equalLinesMoreUnits || equalStockButNearer) {
        bestPartial = { store, score };
      }
    }

    // No store can fully fulfill; fallback to best partial match.
    if (bestPartial?.store) {
      return bestPartial.store;
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
