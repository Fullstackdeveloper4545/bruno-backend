const { sendReportEmail } = require('../mailService');

function getReportSystemStatus() {
  return {
    email_configured: Boolean(process.env.EMAIL_USER && process.env.EMAIL_PASS),
    email_from: process.env.EMAIL_FROM || process.env.EMAIL_USER || null,
  };
}

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
  const pendingOrdersResult = await pool.query(
    `SELECT order_number, customer_name, total, status, payment_status, created_at
     FROM orders
     WHERE assigned_store_id::text = $1::text
       AND status IN ('pending', 'awaiting_payment', 'paid', 'processing')
     ORDER BY created_at ASC`,
    [storeId]
  );

  const analyticsResult = await pool.query(
    `SELECT
       COUNT(*)::int AS total_orders,
       COUNT(*) FILTER (
         WHERE created_at::date = CURRENT_DATE
       )::int AS orders_today,
       COALESCE(SUM(total), 0)::numeric(12,2) AS total_revenue,
       COALESCE(SUM(total) FILTER (
         WHERE created_at::date = CURRENT_DATE
       ), 0)::numeric(12,2) AS revenue_today,
       COUNT(*) FILTER (
         WHERE created_at::date >= CURRENT_DATE - INTERVAL '6 days'
       )::int AS orders_last_7d,
       COALESCE(SUM(total) FILTER (
         WHERE created_at::date >= CURRENT_DATE - INTERVAL '6 days'
       ), 0)::numeric(12,2) AS revenue_last_7d,
       COUNT(*) FILTER (
         WHERE status IN ('pending', 'awaiting_payment', 'paid', 'processing')
       )::int AS pending_orders
     FROM orders
     WHERE assigned_store_id::text = $1::text`,
    [storeId]
  );

  return {
    store,
    orders: pendingOrdersResult.rows,
    analytics: analyticsResult.rows[0] || {},
  };
}

function renderPendingOrdersEmail(summary) {
  const lines = summary.orders.map((order) => `${order.order_number} | ${order.customer_name} | EUR ${Number(order.total).toFixed(2)} | ${order.status}/${order.payment_status}`);
  const analytics = summary.analytics || {};
  const stats = {
    totalOrders: Number(analytics.total_orders || 0),
    ordersToday: Number(analytics.orders_today || 0),
    pendingOrders: Number(analytics.pending_orders || 0),
    totalRevenue: Number(analytics.total_revenue || 0).toFixed(2),
    revenueToday: Number(analytics.revenue_today || 0).toFixed(2),
    ordersLast7d: Number(analytics.orders_last_7d || 0),
    revenueLast7d: Number(analytics.revenue_last_7d || 0).toFixed(2),
  };

  return {
    subject: `Daily Report - ${summary.store.name}`,
    text: lines.length
      ? `Store: ${summary.store.name}
Orders today: ${stats.ordersToday}
Revenue today: EUR ${stats.revenueToday}
Orders last 7 days: ${stats.ordersLast7d}
Revenue last 7 days: EUR ${stats.revenueLast7d}
Total orders: ${stats.totalOrders}
Total revenue: EUR ${stats.totalRevenue}
Pending orders: ${stats.pendingOrders}

Pending order list:
${lines.join('\n')}`
      : `Store: ${summary.store.name}
Orders today: ${stats.ordersToday}
Revenue today: EUR ${stats.revenueToday}
Orders last 7 days: ${stats.ordersLast7d}
Revenue last 7 days: EUR ${stats.revenueLast7d}
Total orders: ${stats.totalOrders}
Total revenue: EUR ${stats.totalRevenue}
Pending orders: ${stats.pendingOrders}

No pending orders today.`,
    html: `
      <div>
        <p><strong>Store:</strong> ${summary.store.name}</p>
        <h3>Analytics summary</h3>
        <ul>
          <li>Orders today: ${stats.ordersToday}</li>
          <li>Revenue today: EUR ${stats.revenueToday}</li>
          <li>Orders last 7 days: ${stats.ordersLast7d}</li>
          <li>Revenue last 7 days: EUR ${stats.revenueLast7d}</li>
          <li>Total orders: ${stats.totalOrders}</li>
          <li>Total revenue: EUR ${stats.totalRevenue}</li>
          <li>Pending orders: ${stats.pendingOrders}</li>
        </ul>
        <h3>Pending orders</h3>
        ${lines.length ? `<ul>${lines.map((line) => `<li>${line}</li>`).join('')}</ul>` : '<p>No pending orders today.</p>'}
      </div>`,
  };
}

async function runSchedule(pool, schedule) {
  const summary = await buildPendingOrdersSummary(pool, schedule.store_id);
  const email = renderPendingOrdersEmail(summary);

  await sendReportEmail(schedule.recipient_email, email.subject, email.text, email.html);

  await pool.query(
    `UPDATE report_schedules
     SET last_sent_date = CURRENT_DATE,
         last_sent_at = NOW(),
         updated_at = NOW()
     WHERE id = $1`,
    [schedule.id]
  );

  return {
    schedule_id: schedule.id,
    recipient_email: schedule.recipient_email,
    store_name: summary.store.name,
    pending_orders: summary.orders.length,
  };
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
  const deliveries = [];
  for (const schedule of schedules.rows) {
    deliveries.push(await runSchedule(pool, schedule));
    sent += 1;
  }

  return { sent, deliveries };
}

async function runScheduleById(pool, scheduleId) {
  const result = await pool.query(`SELECT * FROM report_schedules WHERE id = $1`, [scheduleId]);
  if (!result.rows[0]) {
    throw new Error('Report schedule not found');
  }

  const delivery = await runSchedule(pool, result.rows[0]);
  return { sent: 1, deliveries: [delivery] };
}

module.exports = {
  getReportSystemStatus,
  runDueSchedules,
  runScheduleById,
};
