const pool = require('../config/db');
const { getSettings, performSync } = require('../services/integration/syncService');
const crypto = require('crypto');

function firstText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function getPublicBaseUrl(req) {
  const configured = firstText(process.env.APP_PUBLIC_URL);
  if (configured) return configured.replace(/\/+$/, '');

  const forwardedProto = firstText(req.headers['x-forwarded-proto']);
  const forwardedHost = firstText(req.headers['x-forwarded-host']);
  const host = forwardedHost || firstText(req.headers.host) || 'localhost:5000';
  const proto = forwardedProto ? forwardedProto.split(',')[0].trim() : req.protocol || 'http';
  return `${proto}://${host}`.replace(/\/+$/, '');
}

function normalizeShopifyShop(value) {
  const raw = firstText(value);
  if (!raw) return null;
  const withoutProto = raw.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (!withoutProto) return null;
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(withoutProto)) return null;
  return withoutProto.toLowerCase();
}

function timingSafeEqualHex(a, b) {
  const left = Buffer.from(String(a || '').toLowerCase(), 'utf8');
  const right = Buffer.from(String(b || '').toLowerCase(), 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function parseRawQueryString(rawQueryString) {
  const raw = String(rawQueryString || '');
  if (!raw) return [];

  return raw
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const index = pair.indexOf('=');
      if (index === -1) return [pair, ''];
      return [pair.slice(0, index), pair.slice(index + 1)];
    });
}

function verifyShopifyHmacFromReq(req, clientSecret) {
  if (!clientSecret) return false;

  const rawQueryString = String(req?.originalUrl || '').split('?')[1] || '';
  const pairs = parseRawQueryString(rawQueryString);

  const provided = pairs.find(([key]) => key === 'hmac')?.[1] || '';
  if (!provided) return false;

  const rawMessage = pairs
    .filter(([key]) => key !== 'hmac' && key !== 'signature')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

  const rawDigest = crypto.createHmac('sha256', clientSecret).update(rawMessage).digest('hex');
  if (timingSafeEqualHex(rawDigest, provided)) return true;

  const decodedEntries = Object.entries(req.query || {})
    .filter(([key]) => key !== 'hmac' && key !== 'signature')
    .map(([key, value]) => [String(key), Array.isArray(value) ? value[0] : value])
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value ?? ''))}`)
    .join('&');

  const decodedDigest = crypto.createHmac('sha256', clientSecret).update(decodedEntries).digest('hex');
  return timingSafeEqualHex(decodedDigest, provided);
}

function emptyToNull(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function maskSettings(settings) {
  if (!settings || typeof settings !== 'object') return settings;
  return {
    ...settings,
    api_key: '',
    webhook_secret: '',
    has_api_key: Boolean(settings.api_key),
    has_webhook_secret: Boolean(settings.webhook_secret),
  };
}

async function getIntegrationSettings(req, res) {
  try {
    const settings = await getSettings(pool);
    res.json(maskSettings(settings));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function updateIntegrationSettings(req, res) {
  try {
    const { base_url, api_key, integration_name, webhook_secret, is_active, sync_invoices } = req.body;
    const result = await pool.query(
      `UPDATE integration_settings
       SET base_url = COALESCE($1, base_url),
           api_key = COALESCE($2, api_key),
           integration_name = COALESCE($3, integration_name),
           webhook_secret = COALESCE($4, webhook_secret),
           is_active = COALESCE($5, is_active),
           sync_invoices = COALESCE($6, sync_invoices),
           updated_at = NOW()
       WHERE id = 1
       RETURNING *`,
      [
        emptyToNull(base_url),
        emptyToNull(api_key),
        emptyToNull(integration_name),
        emptyToNull(webhook_secret),
        is_active,
        sync_invoices,
      ]
    );

    res.json(maskSettings(result.rows[0]));
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

async function getShopifyOAuthInfo(req, res) {
  try {
    const clientId = firstText(process.env.SHOPIFY_CLIENT_ID);
    const clientSecretConfigured = Boolean(firstText(process.env.SHOPIFY_CLIENT_SECRET));
    const scopes = firstText(process.env.SHOPIFY_SCOPES) || 'read_products';
    const appPublicUrl = firstText(process.env.APP_PUBLIC_URL) || null;
    const callbackUrl = `${getPublicBaseUrl(req)}/api/integration/shopify/oauth/callback`;

    const shop = normalizeShopifyShop(req.query?.shop);
    let authorizeUrl = null;
    if (shop && clientId) {
      const url = new URL(`https://${shop}/admin/oauth/authorize`);
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('scope', scopes);
      url.searchParams.set('redirect_uri', callbackUrl);
      url.searchParams.set('state', 'debug');
      authorizeUrl = url.toString();
    }

    res.json({
      shop,
      shop_expected_format: 'your-store.myshopify.com',
      callback_url: callbackUrl,
      app_public_url_env: appPublicUrl,
      shopify_client_id_configured: Boolean(clientId),
      shopify_client_id: clientId || null,
      shopify_client_secret_configured: clientSecretConfigured,
      shopify_scopes: scopes,
      authorize_url_preview: authorizeUrl,
      note:
        'Client secret is never returned. If authorize_url_preview client_id does not match your Shopify app Client ID, your backend env vars are pointing to a different app and HMAC verification will fail.',
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function startShopifyOAuth(req, res) {
  try {
    const clientId = firstText(process.env.SHOPIFY_CLIENT_ID);
    const clientSecret = firstText(process.env.SHOPIFY_CLIENT_SECRET);
    if (!clientId || !clientSecret) {
      return res.status(500).json({ message: 'Shopify OAuth is not configured (missing SHOPIFY_CLIENT_ID/SHOPIFY_CLIENT_SECRET).' });
    }

    const shop = normalizeShopifyShop(req.query?.shop);
    if (!shop) {
      return res.status(400).json({ message: 'Invalid Shopify shop domain. Use something like your-store.myshopify.com.' });
    }

    const returnTo = firstText(req.query?.return_to);
    const state = crypto.randomBytes(16).toString('hex');
    await pool.query(
      `UPDATE integration_settings
       SET oauth_state = $1,
           oauth_return_to = $2,
           shopify_shop = $3,
           updated_at = NOW()
       WHERE id = 1`,
      [state, returnTo || null, shop]
    );

    const callbackUrl = `${getPublicBaseUrl(req)}/api/integration/shopify/oauth/callback`;
    const scopes = firstText(process.env.SHOPIFY_SCOPES) || 'read_products';

    const url = new URL(`https://${shop}/admin/oauth/authorize`);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('scope', scopes);
    url.searchParams.set('redirect_uri', callbackUrl);
    url.searchParams.set('state', state);

    res.redirect(url.toString());
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function shopifyOAuthCallback(req, res) {
  try {
    const clientId = firstText(process.env.SHOPIFY_CLIENT_ID);
    const clientSecret = firstText(process.env.SHOPIFY_CLIENT_SECRET);
    if (!clientId || !clientSecret) {
      return res.status(500).json({ message: 'Shopify OAuth is not configured (missing SHOPIFY_CLIENT_ID/SHOPIFY_CLIENT_SECRET).' });
    }

    const shop = normalizeShopifyShop(req.query?.shop);
    const code = firstText(req.query?.code);
    const state = firstText(req.query?.state);
    if (!shop || !code || !state) {
      return res.status(400).json({
        message:
          'Missing shop/code/state in Shopify callback. Make sure you start the flow from Bruno via /api/integration/shopify/oauth/start (Connect Shopify button). If you opened the app inside Shopify admin, your Shopify App URL might be pointing to the callback URL; set App URL to your app frontend and keep the callback only in the allowed redirect URLs list.',
      });
    }

    if (!verifyShopifyHmacFromReq(req, clientSecret)) {
      return res.status(401).json({
        message:
          'Invalid Shopify HMAC signature. This usually means SHOPIFY_CLIENT_SECRET does not match the app Secret for this install (or the callback URL is routed through something that rewrites the query string).',
      });
    }

    const current = await getSettings(pool);
    if (!current?.oauth_state || current.oauth_state !== state) {
      return res.status(401).json({ message: 'Invalid OAuth state.' });
    }

    const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });

    const tokenText = await tokenResponse.text();
    if (!tokenResponse.ok) {
      return res.status(500).json({ message: `Shopify token exchange failed: ${tokenResponse.status} ${tokenText}` });
    }

    let tokenJson;
    try {
      tokenJson = JSON.parse(tokenText);
    } catch (_) {
      return res.status(500).json({ message: `Shopify token exchange returned invalid JSON: ${tokenText}` });
    }

    const accessToken = firstText(tokenJson?.access_token);
    if (!accessToken) {
      return res.status(500).json({ message: 'Shopify token exchange did not return an access_token.' });
    }

    await pool.query(
      `UPDATE integration_settings
       SET base_url = $1,
           api_key = $2,
           integration_name = 'shopify',
           is_active = true,
           oauth_state = NULL,
           updated_at = NOW()
       WHERE id = 1`,
      [`https://${shop}`, accessToken]
    );

    const redirectTarget = firstText(current?.oauth_return_to) || `${process.env.ADMIN_PUBLIC_URL || ''}`;
    if (redirectTarget) {
      const url = new URL(redirectTarget);
      url.searchParams.set('shopify', 'connected');
      return res.redirect(url.toString());
    }

    res.send('Shopify connected. You can close this window.');
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
  getShopifyOAuthInfo,
  startShopifyOAuth,
  shopifyOAuthCallback,
  getMockProductsSync,
};
