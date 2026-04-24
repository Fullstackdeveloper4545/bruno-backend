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
  public_logo_url: '',
  public_radius: '0.5rem',
  public_home_hero_image: '',
  public_home_hero_carousel_images: [],
  public_home_promo_image: '',
  public_category_card_bg_image: '',
  public_home_hero_overlay_color: '#000000',
  public_home_hero_overlay_opacity: '0',
  public_home_promo_overlay_color: '#000000',
  public_home_promo_overlay_opacity: '0',
  public_category_card_overlay_color: '#000000',
  public_category_card_overlay_opacity: '0',
  public_home_sections: [],
  public_home_content: {},
  public_home_custom_sections: {},
  public_content_overrides: {},
  public_layout_overrides: {},
};
const DEFAULT_ATHLETE_SETTINGS = {
  enabled: true,
  product_count: 10,
  category_ids: [],
  category_limits: {},
  sort_by: 'sales',
};
const DEFAULT_BRAND_SETTINGS = {
  enabled: true,
  brand_ids: [],
};
const DEFAULT_PERFORMANCE_SETTINGS = {
  enabled: true,
  product_count: 10,
  category_ids: [],
  category_limits: {},
  sort_by: 'sales',
};
const DEFAULT_SITE_PAGES = {
  'about-us': {
    slug: 'about-us',
    title: 'Sobre Nos',
    hero_image_url: '',
    subtitle:
      'Para muitos corredores, evoluir parece significar treinar mais e mais. A nossa abordagem combina equipamento certo, recuperacao e acompanhamento para melhorares de forma consistente e sustentavel.',
    section_title: 'A nossa missao',
    section_body:
      'Ajudar cada atleta, do iniciante ao competitivo, a correr com confianca. Selecionamos produtos tecnicos, partilhamos conhecimento pratico e criamos uma comunidade focada em progresso real.',
    stores_title: 'Estamos perto de ti',
    stores_body: 'Visita-nos numa das nossas lojas fisicas e recebe aconselhamento especializado.',
  },
  contact: {
    slug: 'contact',
    title: 'CONTACTOS',
    hero_image_url: '',
    subtitle:
      'Nisi duis culpa proident magna in nisi et ex aute culpa et aliqua. Dolor sunt ex qui eu sunt pariatur adipisicing pariatur minim. Nisi duis culpa proident magna in nisi et ex aute culpa et aliqua.',
    social_links: ['TIKTOK', 'INSTAGRAM', 'FACEBOOK'],
    contact_items: ['email', 'numero', 'morada'],
    form_title: 'TEM DUVIDAS\nA ESCLARECER?',
    form_body:
      'Tem alguma questao ou pretende mais informacoes sobre os nossos servicos? Estamos disponiveis para o ajudar e esclarecer todas as suas duvidas.',
    stores_title: 'Estamos perto de ti',
    stores_body: 'Visita-nos numa das nossas lojas fisicas e recebe aconselhamento especializado.',
  },
  blog: {
    slug: 'blog',
    title: 'Blog',
    hero_image_url: '',
    subtitle:
      'Ipsum sit id Morbi est non, dignissim, libero. Donec dolor sed vitae ex laoreet ex non, elit lorem, hendrerit amet, elit ex.',
  },
};
const DEFAULT_AVAILABLE_BRANDS = [
  { id: 'adidas', name: 'Adidas' },
  { id: 'asics', name: 'Asics' },
  { id: 'nike', name: 'Nike' },
  { id: 'hoka', name: 'Hoka' },
  { id: 'puma', name: 'Puma' },
  { id: 'new-balance', name: 'New Balance' },
  { id: 'garmin', name: 'Garmin' },
  { id: 'brooks', name: 'Brooks' },
];

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

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

function normalizeThemeCarouselImages(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => ({
      url: String(item.url || '').trim(),
      title: String(item.title || '').trim(),
      alt: String(item.alt || '').trim(),
    }))
    .filter((item) => item.url);
}

function normalizeThemeSettings(value, base = DEFAULT_THEME_SETTINGS) {
  const payload = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const merged = { ...base, ...payload };

  const layoutCandidate = String(merged.public_layout || merged.layout || DEFAULT_THEME_SETTINGS.public_layout)
    .trim()
    .toLowerCase();
  const allowedLayouts = new Set(['classic', 'categories-first', 'minimal']);

  return {
    ...merged,
    public_primary_color: normalizeHexColor(
      merged.public_primary_color ?? merged.primary_color,
      DEFAULT_THEME_SETTINGS.public_primary_color
    ),
    public_layout: allowedLayouts.has(layoutCandidate) ? layoutCandidate : DEFAULT_THEME_SETTINGS.public_layout,
    public_logo_url: String(merged.public_logo_url || '').trim(),
    public_radius: String(merged.public_radius || DEFAULT_THEME_SETTINGS.public_radius).trim(),
    public_home_hero_image: String(merged.public_home_hero_image || '').trim(),
    public_home_hero_carousel_images: normalizeThemeCarouselImages(merged.public_home_hero_carousel_images),
    public_home_promo_image: String(merged.public_home_promo_image || '').trim(),
    public_category_card_bg_image: String(merged.public_category_card_bg_image || '').trim(),
    public_home_hero_overlay_color: normalizeHexColor(
      merged.public_home_hero_overlay_color,
      DEFAULT_THEME_SETTINGS.public_home_hero_overlay_color
    ),
    public_home_hero_overlay_opacity: String(
      merged.public_home_hero_overlay_opacity ?? DEFAULT_THEME_SETTINGS.public_home_hero_overlay_opacity
    ).trim(),
    public_home_promo_overlay_color: normalizeHexColor(
      merged.public_home_promo_overlay_color,
      DEFAULT_THEME_SETTINGS.public_home_promo_overlay_color
    ),
    public_home_promo_overlay_opacity: String(
      merged.public_home_promo_overlay_opacity ?? DEFAULT_THEME_SETTINGS.public_home_promo_overlay_opacity
    ).trim(),
    public_category_card_overlay_color: normalizeHexColor(
      merged.public_category_card_overlay_color,
      DEFAULT_THEME_SETTINGS.public_category_card_overlay_color
    ),
    public_category_card_overlay_opacity: String(
      merged.public_category_card_overlay_opacity ?? DEFAULT_THEME_SETTINGS.public_category_card_overlay_opacity
    ).trim(),
    public_home_sections:
      Array.isArray(merged.public_home_sections) ? merged.public_home_sections.filter((item) => item != null) : [],
    public_home_content:
      merged.public_home_content && typeof merged.public_home_content === 'object' && !Array.isArray(merged.public_home_content)
        ? merged.public_home_content
        : {},
    public_home_custom_sections:
      merged.public_home_custom_sections &&
      typeof merged.public_home_custom_sections === 'object' &&
      !Array.isArray(merged.public_home_custom_sections)
        ? merged.public_home_custom_sections
        : {},
    public_content_overrides:
      merged.public_content_overrides &&
      typeof merged.public_content_overrides === 'object' &&
      !Array.isArray(merged.public_content_overrides)
        ? merged.public_content_overrides
        : {},
    public_layout_overrides:
      merged.public_layout_overrides &&
      typeof merged.public_layout_overrides === 'object' &&
      !Array.isArray(merged.public_layout_overrides)
        ? merged.public_layout_overrides
        : {},
  };
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

async function getSitePagesStore() {
  const result = await pool.query(`SELECT value FROM app_settings WHERE key = 'site_pages' LIMIT 1`);
  const fromDb = result.rows[0]?.value;
  const safe = fromDb && typeof fromDb === 'object' && !Array.isArray(fromDb) ? fromDb : {};
  return {
    'about-us': { ...DEFAULT_SITE_PAGES['about-us'], ...(safe['about-us'] || {}) },
    contact: { ...DEFAULT_SITE_PAGES.contact, ...(safe.contact || {}) },
    blog: { ...DEFAULT_SITE_PAGES.blog, ...(safe.blog || {}) },
    ...Object.fromEntries(
      Object.entries(safe).filter(
        ([key, value]) =>
          !['about-us', 'contact', 'blog'].includes(key) &&
          value &&
          typeof value === 'object' &&
          !Array.isArray(value)
      )
    ),
  };
}

async function saveSitePagesStore(store) {
  const payload = store && typeof store === 'object' && !Array.isArray(store) ? store : DEFAULT_SITE_PAGES;
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ('site_pages', $1::jsonb, NOW())
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
    console.warn('getAboutUs fallback:', error.message);
    res.json(DEFAULT_ABOUT_US_CONTENT);
  }
}

async function updateAboutUs(req, res) {
  try {
    const payload = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const currentResult = await pool.query(`SELECT value FROM app_settings WHERE key = 'about_us_page' LIMIT 1`);
    const currentValue =
      currentResult.rows[0]?.value && typeof currentResult.rows[0].value === 'object' && !Array.isArray(currentResult.rows[0].value)
        ? currentResult.rows[0].value
        : {};

    const testimonials = Array.isArray(payload.testimonials)
      ? payload.testimonials
          .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
          .map((item) => ({
            quote: String(item.quote || '').trim(),
            author: String(item.author || '').trim(),
            role: String(item.role || '').trim(),
          }))
          .filter((item) => item.quote || item.author || item.role)
      : Array.isArray(currentValue.testimonials)
        ? currentValue.testimonials
        : DEFAULT_ABOUT_US_CONTENT.testimonials;

    const nextValue = {
      ...DEFAULT_ABOUT_US_CONTENT,
      ...currentValue,
      ...payload,
      testimonials,
    };

    await pool.query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('about_us_page', $1::jsonb, NOW())
       ON CONFLICT (key)
       DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify(nextValue)]
    );

    res.json(nextValue);
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
    console.warn('getGeneralSettings fallback:', error.message);
    res.json(DEFAULT_GENERAL_SETTINGS);
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
    const merged = normalizeThemeSettings(safePayload);

    const themeStore = await getPublicThemeStore().catch(() => ({ active_id: null, presets: [] }));
    const activePreset =
      themeStore.active_id && Array.isArray(themeStore.presets)
        ? themeStore.presets.find((preset) => preset?.id === themeStore.active_id) || null
        : null;
    const presetSettings =
      activePreset && typeof activePreset.settings === 'object' && activePreset.settings && !Array.isArray(activePreset.settings)
        ? activePreset.settings
        : null;

    const effective = normalizeThemeSettings(presetSettings ? { ...merged, ...presetSettings } : merged);

    res.json({
      ...effective,
      primary_color: effective.public_primary_color,
      active_theme_id: activePreset?.id || null,
    });
  } catch (error) {
    console.warn('getThemeSettings fallback:', error.message);
    res.json({
      ...DEFAULT_THEME_SETTINGS,
      primary_color: DEFAULT_THEME_SETTINGS.public_primary_color,
      active_theme_id: null,
    });
  }
}

async function updateThemeSettings(req, res) {
  try {
    const payload = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const existingResult = await pool.query(`SELECT value FROM app_settings WHERE key = 'theme_settings' LIMIT 1`);
    const existingValue =
      existingResult.rows[0]?.value && typeof existingResult.rows[0].value === 'object' && !Array.isArray(existingResult.rows[0].value)
        ? existingResult.rows[0].value
        : DEFAULT_THEME_SETTINGS;
    const nextValue = normalizeThemeSettings(payload, normalizeThemeSettings(existingValue));

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

async function getJsonSetting(key, fallback) {
  const result = await pool.query(`SELECT value FROM app_settings WHERE key = $1 LIMIT 1`, [key]);
  const fromDb = result.rows[0]?.value;
  const safePayload = fromDb && typeof fromDb === 'object' && !Array.isArray(fromDb) ? fromDb : {};
  return { ...fallback, ...safePayload };
}

async function saveJsonSetting(key, payload) {
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key)
     DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, JSON.stringify(payload)]
  );
  return payload;
}

async function getAthleteSettings(req, res) {
  try {
    const settings = await getJsonSetting('athlete_settings', DEFAULT_ATHLETE_SETTINGS);
    res.json(settings);
  } catch (error) {
    console.warn('getAthleteSettings fallback:', error.message);
    res.json(DEFAULT_ATHLETE_SETTINGS);
  }
}

async function updateAthleteSettings(req, res) {
  try {
    const payload = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const nextValue = {
      enabled: typeof payload.enabled === 'boolean' ? payload.enabled : DEFAULT_ATHLETE_SETTINGS.enabled,
      product_count: Number.isInteger(payload.product_count) ? payload.product_count : DEFAULT_ATHLETE_SETTINGS.product_count,
      category_ids: Array.isArray(payload.category_ids) ? payload.category_ids : DEFAULT_ATHLETE_SETTINGS.category_ids,
      category_limits:
        payload.category_limits && typeof payload.category_limits === 'object' && !Array.isArray(payload.category_limits)
          ? payload.category_limits
          : DEFAULT_ATHLETE_SETTINGS.category_limits,
      sort_by: typeof payload.sort_by === 'string' && payload.sort_by.trim() ? payload.sort_by.trim() : DEFAULT_ATHLETE_SETTINGS.sort_by,
    };
    res.json(await saveJsonSetting('athlete_settings', nextValue));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function getBrandSettings(req, res) {
  try {
    const settings = await getJsonSetting('brand_settings', DEFAULT_BRAND_SETTINGS);
    const availableBrands = DEFAULT_AVAILABLE_BRANDS;
    const selected = normalizeStringList(settings.brand_ids);
    res.json({
      enabled: settings.enabled !== false,
      brand_ids: selected,
      available_brands: availableBrands,
    });
  } catch (error) {
    console.warn('getBrandSettings fallback:', error.message);
    res.json({
      ...DEFAULT_BRAND_SETTINGS,
      available_brands: DEFAULT_AVAILABLE_BRANDS,
    });
  }
}

async function updateBrandSettings(req, res) {
  try {
    const payload = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const nextValue = {
      enabled: typeof payload.enabled === 'boolean' ? payload.enabled : DEFAULT_BRAND_SETTINGS.enabled,
      brand_ids: normalizeStringList(payload.brand_ids),
    };
    const saved = await saveJsonSetting('brand_settings', nextValue);
    res.json({
      ...saved,
      available_brands: DEFAULT_AVAILABLE_BRANDS,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function getPerformanceSettings(req, res) {
  try {
    const settings = await getJsonSetting('performance_settings', DEFAULT_PERFORMANCE_SETTINGS);
    res.json(settings);
  } catch (error) {
    console.warn('getPerformanceSettings fallback:', error.message);
    res.json(DEFAULT_PERFORMANCE_SETTINGS);
  }
}

async function updatePerformanceSettings(req, res) {
  try {
    const payload = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const nextValue = {
      enabled: typeof payload.enabled === 'boolean' ? payload.enabled : DEFAULT_PERFORMANCE_SETTINGS.enabled,
      product_count: Number.isInteger(payload.product_count) ? payload.product_count : DEFAULT_PERFORMANCE_SETTINGS.product_count,
      category_ids: Array.isArray(payload.category_ids) ? payload.category_ids : DEFAULT_PERFORMANCE_SETTINGS.category_ids,
      category_limits:
        payload.category_limits && typeof payload.category_limits === 'object' && !Array.isArray(payload.category_limits)
          ? payload.category_limits
          : DEFAULT_PERFORMANCE_SETTINGS.category_limits,
      sort_by:
        typeof payload.sort_by === 'string' && payload.sort_by.trim()
          ? payload.sort_by.trim()
          : DEFAULT_PERFORMANCE_SETTINGS.sort_by,
    };
    res.json(await saveJsonSetting('performance_settings', nextValue));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function listPublicThemes(req, res) {
  try {
    const store = await getPublicThemeStore();
    res.json({
      active_id: store.active_id || null,
      presets: Array.isArray(store.presets)
        ? store.presets.map((preset) => ({
            ...preset,
            settings: normalizeThemeSettings(preset?.settings),
          }))
        : [],
    });
  } catch (error) {
    console.warn('listPublicThemes fallback:', error.message);
    res.json({ active_id: null, presets: [] });
  }
}

async function createPublicTheme(req, res) {
  try {
    const payload = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const name = String(payload.name || 'Layout').trim().slice(0, 80) || 'Layout';
    const settings = normalizeThemeSettings(
      payload.settings && typeof payload.settings === 'object' && !Array.isArray(payload.settings) ? payload.settings : {}
    );

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
    const settings = normalizeThemeSettings(
      payload.settings && typeof payload.settings === 'object' && !Array.isArray(payload.settings)
        ? payload.settings
        : previous.settings
    );

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

    res.json({
      active_id: store.active_id || null,
      preset: {
        ...preset,
        settings: normalizeThemeSettings(preset?.settings),
      },
    });
  } catch (error) {
    console.warn('getPublicTheme fallback:', error.message);
    res.status(404).json({ message: 'Theme not found' });
  }
}

async function getModules(req, res) {
  try {
    const settings = await getModuleSettings();
    res.json(settings);
  } catch (error) {
    console.warn('getModules fallback:', error.message);
    res.json({
      modules: {
        auth: true,
        product: true,
        store: true,
        order: true,
        payment: true,
        shipping: true,
        discount: true,
        invoice: true,
        integration: true,
        report: true,
        language: true,
        customers: true,
      },
    });
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

async function listSitePages(req, res) {
  try {
    const pages = await getSitePagesStore();
    res.json(
      Object.values(pages).map((page) => ({
        ...page,
        slug: String(page?.slug || '').trim(),
      }))
    );
  } catch (error) {
    res.json(Object.values(DEFAULT_SITE_PAGES));
  }
}

async function getSitePage(req, res) {
  try {
    const slug = String(req.params.slug || '').trim().toLowerCase();
    if (!slug) {
      return res.status(400).json({ message: 'Missing page slug' });
    }
    const pages = await getSitePagesStore();
    const page = pages[slug];
    if (!page) {
      return res.status(404).json({ message: 'Page not found' });
    }
    res.json({ ...page, slug });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function upsertSitePage(req, res) {
  try {
    const slug = String(req.params.slug || '').trim().toLowerCase();
    if (!slug) {
      return res.status(400).json({ message: 'Missing page slug' });
    }

    const payload = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const pages = await getSitePagesStore();
    const current = pages[slug] && typeof pages[slug] === 'object' ? pages[slug] : { slug };

    const next = {
      ...current,
      ...payload,
      slug,
      title: String(payload.title ?? current.title ?? '').trim(),
      hero_image_url: String(payload.hero_image_url ?? current.hero_image_url ?? '').trim(),
      subtitle: String(payload.subtitle ?? current.subtitle ?? '').trim(),
    };

    if (Object.prototype.hasOwnProperty.call(payload, 'section_title')) {
      next.section_title = String(payload.section_title || '').trim();
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'section_body')) {
      next.section_body = String(payload.section_body || '').trim();
    }

    if (Array.isArray(payload.social_links)) {
      next.social_links = payload.social_links.map((item) => String(item || '').trim()).filter(Boolean);
    }
    if (Array.isArray(payload.contact_items)) {
      next.contact_items = payload.contact_items.map((item) => String(item || '').trim()).filter(Boolean);
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'form_title')) {
      next.form_title = String(payload.form_title || '').trim();
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'form_body')) {
      next.form_body = String(payload.form_body || '').trim();
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'stores_title')) {
      next.stores_title = String(payload.stores_title || '').trim();
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'stores_body')) {
      next.stores_body = String(payload.stores_body || '').trim();
    }

    const saved = await saveSitePagesStore({
      ...pages,
      [slug]: next,
    });

    res.json(saved[slug]);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

module.exports = {
  getModules,
  updateModule,
  listSitePages,
  getSitePage,
  upsertSitePage,
  getAboutUs,
  updateAboutUs,
  getGeneralSettings,
  updateGeneralSettings,
  getThemeSettings,
  updateThemeSettings,
  getAthleteSettings,
  updateAthleteSettings,
  getBrandSettings,
  updateBrandSettings,
  getPerformanceSettings,
  updatePerformanceSettings,
  listPublicThemes,
  createPublicTheme,
  updatePublicTheme,
  deletePublicTheme,
  applyPublicTheme,
  getPublicTheme,
};
