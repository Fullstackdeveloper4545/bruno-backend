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

module.exports = {
  getIntegrationSettings,
  updateIntegrationSettings,
  manualSync,
  webhookSync,
  getSyncLogs,
};
