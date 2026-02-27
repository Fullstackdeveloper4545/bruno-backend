const pool = require('../config/db');
const featureFlags = require('../config/featureFlags');

const SETTINGS_KEY = 'module_activation';
const CACHE_TTL_MS = 5000;

const MODULE_KEYS = [
  'auth',
  'product',
  'store',
  'order',
  'payment',
  'shipping',
  'discount',
  'invoice',
  'integration',
  'report',
  'language',
  'customers',
];

let cache = {
  loadedAt: 0,
  overrides: {},
};

function toBool(value, fallback = false) {
  if (value == null) return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return fallback;
}

function getDefaultModules() {
  return {
    auth: featureFlags.modules.auth,
    product: featureFlags.modules.product,
    store: featureFlags.modules.store,
    order: featureFlags.modules.order,
    payment: featureFlags.modules.payment,
    shipping: featureFlags.modules.shipping,
    discount: featureFlags.modules.discount,
    invoice: featureFlags.modules.invoice,
    integration: featureFlags.modules.integration,
    report: featureFlags.modules.report,
    language: featureFlags.modules.language,
    customers: true,
  };
}

function sanitizeOverrides(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const normalized = {};
  for (const key of MODULE_KEYS) {
    if (value[key] != null) {
      normalized[key] = toBool(value[key], true);
    }
  }
  return normalized;
}

async function loadOverrides(force = false) {
  const isFresh = Date.now() - cache.loadedAt < CACHE_TTL_MS;
  if (!force && isFresh) {
    return cache.overrides;
  }

  const result = await pool.query(
    `SELECT value
     FROM app_settings
     WHERE key = $1
     LIMIT 1`,
    [SETTINGS_KEY]
  );

  const overrides = sanitizeOverrides(result.rows[0]?.value);
  cache = {
    loadedAt: Date.now(),
    overrides,
  };
  return overrides;
}

function mergeModules(overrides) {
  const defaults = getDefaultModules();
  return {
    ...defaults,
    ...overrides,
  };
}

async function getModuleSettings() {
  const overrides = await loadOverrides();
  return {
    modules: mergeModules(overrides),
  };
}

async function setModuleEnabled(moduleKey, enabled) {
  if (!MODULE_KEYS.includes(moduleKey)) {
    const error = new Error('Invalid module key');
    error.status = 400;
    throw error;
  }

  const overrides = await loadOverrides(true);
  const nextOverrides = {
    ...overrides,
    [moduleKey]: Boolean(enabled),
  };

  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key)
     DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [SETTINGS_KEY, JSON.stringify(nextOverrides)]
  );

  cache = {
    loadedAt: Date.now(),
    overrides: nextOverrides,
  };

  return {
    module: moduleKey,
    enabled: Boolean(enabled),
    modules: mergeModules(nextOverrides),
  };
}

async function isModuleEnabled(moduleKey) {
  const settings = await getModuleSettings();
  return settings.modules[moduleKey] !== false;
}

module.exports = {
  MODULE_KEYS,
  getModuleSettings,
  setModuleEnabled,
  isModuleEnabled,
};
