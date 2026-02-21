const pool = require('../config/db');

async function getLanguages(req, res) {
  try {
    const result = await pool.query(`SELECT value FROM app_settings WHERE key = 'languages'`);
    if (!result.rows[0]) return res.json({ languages: ['pt', 'es'] });
    res.json({ languages: result.rows[0].value });
  } catch (error) { res.status(500).json({ message: error.message }); }
}

async function setLanguages(req, res) {
  try {
    const { languages } = req.body;
    if (!Array.isArray(languages) || languages.length === 0) {
      return res.status(400).json({ message: 'languages must be a non-empty array' });
    }

    await pool.query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('languages', $1::jsonb, NOW())
       ON CONFLICT (key)
       DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify(languages)]
    );

    res.json({ languages });
  } catch (error) { res.status(500).json({ message: error.message }); }
}

module.exports = { getLanguages, setLanguages };
