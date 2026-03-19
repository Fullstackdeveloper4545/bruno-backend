const { getModuleSettings, setModuleEnabled } = require('../services/moduleSettingsService');
const pool = require('../config/db');

const DEFAULT_ABOUT_US_CONTENT = {
  hero_title: 'Sobre Nos',
  hero_body:
    'Para muitos corredores, evoluir parece significar treinar mais e mais. A nossa abordagem combina equipamento certo, recuperacao e acompanhamento para melhorares de forma consistente e sustentavel.',
  section_title: 'A nossa missao',
  section_body:
    'Ajudar cada atleta, do iniciante ao competitivo, a correr com confianca. Selecionamos produtos tecnicos, partilhamos conhecimento pratico e criamos uma comunidade focada em progresso real.',
  section_images: {
    hero: '',
    left: '',
    right_top: '',
    right_bottom: '',
  },
  testimonials: [
    {
      quote:
        'Atendimento excelente e recomendacoes mesmo acertadas para o meu tipo de corrida.',
      author: 'Mariana S.',
      role: 'Runner',
    },
    {
      quote:
        'Comprei para trail e senti diferenca logo nos primeiros treinos.',
      author: 'Rui P.',
      role: 'Trail Runner',
    },
    {
      quote:
        'Equipe tecnica e muito disponivel. Experiencia de compra muito boa.',
      author: 'Ines R.',
      role: 'Amateur Athlete',
    },
  ],
};
const DEFAULT_GENERAL_SETTINGS = {
  site_name: 'Backoffice Admin',
  currency: 'EUR',
  vat_configuration: '23% VAT',
  email_settings: 'notifications@ecom.pt',
};
const DEFAULT_THEME_SETTINGS = {
  public_primary_color: '#6C939B',
  public_layout: 'classic',
};

function normalizeHexColor(value, fallback) {
  const raw = String(value || '').trim();
  if (!raw) return fallback;

  const hex = raw.startsWith('#') ? raw.slice(1) : raw;
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(hex)) return fallback;

  if (hex.length === 3) {
    const expanded = hex
      .split('')
      .map((ch) => `${ch}${ch}`)
      .join('');
    return `#${expanded.toUpperCase()}`;
  }

  return `#${hex.toUpperCase()}`;
}

function buildThemeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function getPublicThemeStore() {
  const result = await pool.query(`SELECT value FROM app_settings WHERE key = 'public_theme_presets' LIMIT 1`);
  const fromDb = result.rows[0]?.value;
  const safe = fromDb && typeof fromDb === 'object' && !Array.isArray(fromDb) ? fromDb : {};
  const presets = Array.isArray(safe.presets) ? safe.presets.filter((row) => row && typeof row === 'object') : [];
  const active_id = typeof safe.active_id === 'string' ? safe.active_id : null;
  return { active_id, presets };
}

async function savePublicThemeStore(store) {
  const payload = store && typeof store === 'object' ? store : { active_id: null, presets: [] };
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ('public_theme_presets', $1::jsonb, NOW())
     ON CONFLICT (key)
     DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [JSON.stringify(payload)]
  );
  return payload;
}

async function getAboutUs(req, res) {
  try {
    const result = await pool.query(`SELECT value FROM app_settings WHERE key = 'about_us_page' LIMIT 1`);
    const fromDb = result.rows[0]?.value;
    const safePayload =
      fromDb && typeof fromDb === 'object' && !Array.isArray(fromDb) ? fromDb : DEFAULT_ABOUT_US_CONTENT;
    res.json({ ...DEFAULT_ABOUT_US_CONTENT, ...safePayload });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function getGeneralSettings(req, res) {
  try {
    const result = await pool.query(`SELECT value FROM app_settings WHERE key = 'general_settings' LIMIT 1`);
    const fromDb = result.rows[0]?.value;
    const safePayload =
      fromDb && typeof fromDb === 'object' && !Array.isArray(fromDb) ? fromDb : DEFAULT_GENERAL_SETTINGS;
    res.json({ ...DEFAULT_GENERAL_SETTINGS, ...safePayload });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function updateGeneralSettings(req, res) {
  try {
    const payload = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const nextValue = {
      site_name: String(payload.site_name ?? DEFAULT_GENERAL_SETTINGS.site_name).trim(),
      currency: String(payload.currency ?? DEFAULT_GENERAL_SETTINGS.currency).trim(),
      vat_configuration: String(
        payload.vat_configuration ?? DEFAULT_GENERAL_SETTINGS.vat_configuration
      ).trim(),
      email_settings: String(payload.email_settings ?? DEFAULT_GENERAL_SETTINGS.email_settings).trim(),
    };

    await pool.query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('general_settings', $1::jsonb, NOW())
       ON CONFLICT (key)
       DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify(nextValue)]
    );

    res.json(nextValue);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function getThemeSettings(req, res) {
  try {
    const result = await pool.query(`SELECT value FROM app_settings WHERE key = 'theme_settings' LIMIT 1`);
    const fromDb = result.rows[0]?.value;
    const safePayload = fromDb && typeof fromDb === 'object' && !Array.isArray(fromDb) ? fromDb : DEFAULT_THEME_SETTINGS;
    const merged = { ...DEFAULT_THEME_SETTINGS, ...safePayload };

    const themeStore = await getPublicThemeStore().catch(() => ({ active_id: null, presets: [] }));
    const activePreset =
      themeStore.active_id && Array.isArray(themeStore.presets)
        ? themeStore.presets.find((preset) => preset?.id === themeStore.active_id) || null
        : null;
    const presetSettings =
      activePreset && typeof activePreset.settings === 'object' && activePreset.settings && !Array.isArray(activePreset.settings)
        ? activePreset.settings
        : null;

    const effective = presetSettings ? { ...merged, ...presetSettings } : merged;

    const normalizedPrimary = normalizeHexColor(
      effective.public_primary_color ?? effective.primary_color,
      DEFAULT_THEME_SETTINGS.public_primary_color
    );

    const layoutCandidate = String(effective.public_layout || DEFAULT_THEME_SETTINGS.public_layout).trim().toLowerCase();
    const allowedLayouts = new Set(['classic', 'categories-first', 'minimal']);
    const public_layout = allowedLayouts.has(layoutCandidate) ? layoutCandidate : DEFAULT_THEME_SETTINGS.public_layout;
    const public_logo_url = typeof effective.public_logo_url === 'string' ? effective.public_logo_url.trim() : '';
    const public_radius = typeof effective.public_radius === 'string' ? effective.public_radius.trim() : '';

    res.json({
      ...effective,
      public_primary_color: normalizedPrimary,
      primary_color: normalizedPrimary,
      public_layout,
      public_logo_url,
      public_radius,
      active_theme_id: activePreset?.id || null,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function updateThemeSettings(req, res) {
  try {
    const payload = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const layoutCandidate = String(payload.public_layout ?? payload.layout ?? '').trim().toLowerCase();
    const allowedLayouts = new Set(['classic', 'categories-first', 'minimal']);
    const public_layout = allowedLayouts.has(layoutCandidate) ? layoutCandidate : DEFAULT_THEME_SETTINGS.public_layout;
    const nextValue = {
      public_primary_color: normalizeHexColor(
        payload.public_primary_color ?? payload.primary_color,
        DEFAULT_THEME_SETTINGS.public_primary_color
      ),
      public_layout,
      public_logo_url: typeof payload.public_logo_url === 'string' ? payload.public_logo_url.trim() : '',
      public_radius: typeof payload.public_radius === 'string' ? payload.public_radius.trim() : '',
    };

    await pool.query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('theme_settings', $1::jsonb, NOW())
       ON CONFLICT (key)
       DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify(nextValue)]
    );

    res.json({ ...nextValue, primary_color: nextValue.public_primary_color });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function listPublicThemes(req, res) {
  try {
    const store = await getPublicThemeStore();
    res.json(store);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function createPublicTheme(req, res) {
  try {
    const payload = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const name = String(payload.name || 'Layout').trim().slice(0, 80) || 'Layout';
    const settings = payload.settings && typeof payload.settings === 'object' && !Array.isArray(payload.settings) ? payload.settings : {};

    const store = await getPublicThemeStore();
    const now = new Date().toISOString();
    const preset = { id: buildThemeId(), name, settings, created_at: now, updated_at: now };
    const nextStore = { ...store, presets: [preset, ...(store.presets || [])] };
    const saved = await savePublicThemeStore(nextStore);
    res.json(saved);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function updatePublicTheme(req, res) {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ message: 'Missing theme id' });

    const payload = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const store = await getPublicThemeStore();
    const presets = Array.isArray(store.presets) ? store.presets : [];
    const index = presets.findIndex((row) => row?.id === id);
    if (index < 0) return res.status(404).json({ message: 'Theme not found' });

    const previous = presets[index];
    const name = payload.name != null ? String(payload.name || '').trim().slice(0, 80) : previous.name;
    const settings =
      payload.settings && typeof payload.settings === 'object' && !Array.isArray(payload.settings) ? payload.settings : previous.settings;

    const next = { ...previous, name: name || previous.name, settings, updated_at: new Date().toISOString() };
    const nextPresets = presets.slice();
    nextPresets[index] = next;
    const saved = await savePublicThemeStore({ ...store, presets: nextPresets });
    res.json(saved);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function deletePublicTheme(req, res) {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ message: 'Missing theme id' });

    const store = await getPublicThemeStore();
    const presets = Array.isArray(store.presets) ? store.presets : [];
    const nextPresets = presets.filter((row) => row?.id !== id);
    const nextActive = store.active_id === id ? null : store.active_id;
    const saved = await savePublicThemeStore({ active_id: nextActive, presets: nextPresets });
    res.json(saved);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function applyPublicTheme(req, res) {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ message: 'Missing theme id' });

    const store = await getPublicThemeStore();
    const presets = Array.isArray(store.presets) ? store.presets : [];
    const exists = presets.some((row) => row?.id === id);
    if (!exists) return res.status(404).json({ message: 'Theme not found' });

    const saved = await savePublicThemeStore({ ...store, active_id: id });
    res.json(saved);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function getPublicTheme(req, res) {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ message: 'Missing theme id' });

    const store = await getPublicThemeStore();
    const presets = Array.isArray(store.presets) ? store.presets : [];
    const preset = presets.find((row) => row?.id === id) || null;
    if (!preset) return res.status(404).json({ message: 'Theme not found' });

    res.json({ active_id: store.active_id || null, preset });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function getModules(req, res) {
  try {
    const settings = await getModuleSettings();
    res.json(settings);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function updateModule(req, res) {
  try {
    const moduleKey = String(req.params.module || '').trim().toLowerCase();
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ message: 'enabled must be boolean' });
    }

    const settings = await setModuleEnabled(moduleKey, enabled);
    res.json(settings);
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ message: error.message });
  }
}

module.exports = {
  getModules,
  updateModule,
  getAboutUs,
  getGeneralSettings,
  updateGeneralSettings,
  getThemeSettings,
  updateThemeSettings,
  listPublicThemes,
  createPublicTheme,
  updatePublicTheme,
  deletePublicTheme,
  applyPublicTheme,
  getPublicTheme,
};
