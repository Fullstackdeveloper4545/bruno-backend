const pool = require('../config/db');

const toSafeText = (value) => (typeof value === 'string' ? value.trim() : '');

exports.listLoginActivity = async (req, res) => {
  try {
    const limitRaw = Number(req.query?.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 200) : 50;

    const result = await pool.query(
      `SELECT id, admin_email, location, status, ip_address, user_agent, created_at
       FROM admin_login_activity
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.createLoginActivity = async (req, res) => {
  try {
    const adminEmail = toSafeText(req.body?.admin_email) || null;
    const location = toSafeText(req.body?.location) || null;
    const status = toSafeText(req.body?.status) || 'success';
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || null;
    const userAgent = toSafeText(req.headers['user-agent']) || null;

    const result = await pool.query(
      `INSERT INTO admin_login_activity (admin_email, location, status, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, admin_email, location, status, ip_address, user_agent, created_at`,
      [adminEmail, location, status, ipAddress, userAgent]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
