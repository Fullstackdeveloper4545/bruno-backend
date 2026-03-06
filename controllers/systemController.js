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
};
