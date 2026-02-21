const pool = require('../config/db');
const { runDueSchedules, runScheduleById } = require('../services/reports/reportService');

async function listSchedules(req, res) {
  try {
    const result = await pool.query(
      `SELECT rs.*, s.name AS store_name
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
