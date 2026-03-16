const pool = require('../config/db');
const { runDueSchedules, runScheduleById } = require('../services/reports/reportService');

function isValidTimeUtc(value) {
  return /^\d{2}:\d{2}$/.test(String(value || '').trim());
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

async function listSchedules(req, res) {
  try {
    const result = await pool.query(
      `SELECT
         rs.*,
         s.name AS store_name,
         CASE
           WHEN rs.is_active = false THEN NULL
           ELSE
             to_char(
               CASE
                 WHEN rs.last_sent_date IS NULL OR rs.last_sent_date < CURRENT_DATE
                   THEN CURRENT_DATE::timestamp + rs.send_time_utc::time
                 ELSE (CURRENT_DATE + INTERVAL '1 day')::timestamp + rs.send_time_utc::time
               END,
               'YYYY-MM-DD HH24:MI'
             )
         END AS next_run_utc
       FROM report_schedules rs
       JOIN stores s ON s.id::text = rs.store_id::text
       ORDER BY rs.id DESC`
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function createSchedule(req, res) {
  try {
    const { store_id, send_time_utc, recipient_email, report_type = 'pending_orders', is_active = true } = req.body;
    if (!String(store_id || '').trim()) {
      return res.status(400).json({ message: 'store_id is required' });
    }
    if (!isValidTimeUtc(send_time_utc)) {
      return res.status(400).json({ message: 'send_time_utc must be in HH:MM format' });
    }
    if (!isValidEmail(recipient_email)) {
      return res.status(400).json({ message: 'recipient_email is invalid' });
    }
    const storeResult = await pool.query(`SELECT id FROM stores WHERE id::text = $1::text LIMIT 1`, [store_id]);
    if (!storeResult.rows[0]) {
      return res.status(404).json({ message: 'Store not found' });
    }
    const result = await pool.query(
      `INSERT INTO report_schedules (store_id, send_time_utc, recipient_email, report_type, is_active)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [store_id, send_time_utc, recipient_email, report_type, is_active]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
}

async function updateSchedule(req, res) {
  try {
    const id = Number(req.params.id);
    const { send_time_utc, recipient_email, report_type, is_active } = req.body;
    if (send_time_utc != null && !isValidTimeUtc(send_time_utc)) {
      return res.status(400).json({ message: 'send_time_utc must be in HH:MM format' });
    }
    if (recipient_email != null && !isValidEmail(recipient_email)) {
      return res.status(400).json({ message: 'recipient_email is invalid' });
    }
    const result = await pool.query(
      `UPDATE report_schedules
       SET send_time_utc = COALESCE($1, send_time_utc),
           recipient_email = COALESCE($2, recipient_email),
           report_type = COALESCE($3, report_type),
           is_active = COALESCE($4, is_active),
           updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [send_time_utc, recipient_email, report_type, is_active, id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ message: 'Schedule not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
}

async function deleteSchedule(req, res) {
  try {
    const id = Number(req.params.id);
    await pool.query(`DELETE FROM report_schedules WHERE id = $1`, [id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function runNow(req, res) {
  try {
    const scheduleId = req.body?.schedule_id ? Number(req.body.schedule_id) : null;
    const result = scheduleId ? await runScheduleById(pool, scheduleId) : await runDueSchedules(pool, new Date());
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
}

module.exports = {
  listSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  runNow,
};
