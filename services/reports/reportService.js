const { sendReportEmail } = require('../mailService');

function nowUtcParts(now = new Date()) {
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mm = String(now.getUTCMinutes()).padStart(2, '0');
  const yyyy = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  return { hhmm: `${hh}:${mm}`, ymd: `${yyyy}-${month}-${dd}` };
}

async function buildPendingOrdersSummary(pool, storeId) {
  const storeResult = await pool.query(`SELECT * FROM stores WHERE id::text = $1::text`, [storeId]);
  if (!storeResult.rows[0]) {
    throw new Error('Store not found');
  }

  const store = storeResult.rows[0];
  const ordersResult = await pool.query(
    `SELECT order_number, customer_name, total, status, payment_status, created_at
     FROM orders
     WHERE assigned_store_id::text = $1::text
       AND status IN ('pending', 'awaiting_payment', 'paid', 'processing')
     ORDER BY created_at ASC`,
    [storeId]
  );

  return { store, orders: ordersResult.rows };
}

function renderPendingOrdersEmail(summary) {
  const lines = summary.orders.map((order) => `${order.order_number} | ${order.customer_name} | EUR ${Number(order.total).toFixed(2)} | ${order.status}/${order.payment_status}`);

  return {
    subject: `Daily Pending Orders - ${summary.store.name}`,
    text: lines.length
      ? `Store: ${summary.store.name}\n${lines.join('\n')}`
      : `Store: ${summary.store.name}\nNo pending orders today.`,
    html: `<p><strong>Store:</strong> ${summary.store.name}</p>${lines.length ? `<ul>${lines.map((line) => `<li>${line}</li>`).join('')}</ul>` : '<p>No pending orders today.</p>'}`,
  };
}

async function runSchedule(pool, schedule) {
  const summary = await buildPendingOrdersSummary(pool, schedule.store_id);
  const email = renderPendingOrdersEmail(summary);

  await sendReportEmail(schedule.recipient_email, email.subject, email.text, email.html);

  await pool.query(
    `UPDATE report_schedules SET last_sent_date = CURRENT_DATE, updated_at = NOW() WHERE id = $1`,
    [schedule.id]
  );
}

async function runDueSchedules(pool, now = new Date()) {
  const { hhmm, ymd } = nowUtcParts(now);

  const schedules = await pool.query(
    `SELECT *
     FROM report_schedules
     WHERE is_active = true
       AND send_time_utc = $1
       AND (last_sent_date IS NULL OR last_sent_date < $2::date)`,
    [hhmm, ymd]
  );

  let sent = 0;
  for (const schedule of schedules.rows) {
    await runSchedule(pool, schedule);
    sent += 1;
  }

  return { sent };
}

async function runScheduleById(pool, scheduleId) {
  const result = await pool.query(`SELECT * FROM report_schedules WHERE id = $1`, [scheduleId]);
  if (!result.rows[0]) {
    throw new Error('Report schedule not found');
  }

  await runSchedule(pool, result.rows[0]);
  return { sent: 1 };
}

module.exports = {
  runDueSchedules,
  runScheduleById,
};
