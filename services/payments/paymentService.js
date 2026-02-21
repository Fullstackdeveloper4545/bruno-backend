const { getProvider } = require('./providerFactory');
const { ensureShipmentForOrder } = require('../shipping/shippingService');
const ALLOWED_METHODS = new Set(['mbway', 'mb_reference', 'klarna']);

function providerFromMethod(method) {
  if (method === 'klarna') return 'klarna';
  return 'ifthenpay';
}

function normalizeMethod(method) {
  if (method === 'mbref') return 'mb_reference';
  if (method === 'creditcard') return 'credit_card';
  return method;
}

async function createCheckout(pool, payload) {
  const orderId = Number(payload.order_id);
  const method = normalizeMethod(payload.method);
  const provider = payload.provider || providerFromMethod(method);

  if (!ALLOWED_METHODS.has(method)) {
    throw new Error('Unsupported payment method. Allowed: mbway, mb_reference, klarna');
  }

  const orderResult = await pool.query(`SELECT * FROM orders WHERE id = $1`, [orderId]);
  if (!orderResult.rows[0]) {
    throw new Error('Order not found');
  }

  const order = orderResult.rows[0];

  if (Number(order.total) <= 0) {
    throw new Error('Order total must be greater than zero');
  }

  const paymentProvider = getProvider(provider);
  const created = await paymentProvider.createPayment({
    method,
    order,
    customer: payload.customer || {},
    callbackUrl: payload.callback_url,
    returnUrl: payload.return_url,
  });

  const paymentResult = await pool.query(
    `INSERT INTO payments (order_id, method, provider, provider_method, provider_payment_id, status, amount, transaction_ref, payment_url, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
     RETURNING *`,
    [
      orderId,
      method,
      provider,
      method,
      created.providerPaymentId,
      created.status,
      order.total,
      order.order_number,
      created.paymentUrl,
      JSON.stringify({ instructions: created.instructions || {}, raw: created.raw || {} }),
    ]
  );

  await pool.query(
    `UPDATE orders SET payment_status = 'pending', status = CASE WHEN status = 'pending' THEN 'awaiting_payment' ELSE status END, updated_at = NOW() WHERE id = $1`,
    [orderId]
  );

  return {
    payment: paymentResult.rows[0],
    instructions: created.instructions || null,
    payment_url: created.paymentUrl || null,
  };
}

async function findPaymentByWebhook(pool, parsed) {
  if (parsed.providerPaymentId) {
    const byProvider = await pool.query(`SELECT * FROM payments WHERE provider_payment_id = $1 ORDER BY id DESC LIMIT 1`, [parsed.providerPaymentId]);
    if (byProvider.rows[0]) return byProvider.rows[0];
  }

  if (parsed.transactionRef) {
    const byTxn = await pool.query(`SELECT * FROM payments WHERE transaction_ref = $1 ORDER BY id DESC LIMIT 1`, [parsed.transactionRef]);
    if (byTxn.rows[0]) return byTxn.rows[0];
  }

  return null;
}

async function decrementInventoryForOrder(pool, orderId) {
  const orderResult = await pool.query(`SELECT assigned_store_id FROM orders WHERE id = $1`, [orderId]);
  const storeId = orderResult.rows[0]?.assigned_store_id;
  if (!storeId) return;

  const items = await pool.query(`SELECT variant_id, quantity FROM order_items WHERE order_id = $1 AND variant_id IS NOT NULL`, [orderId]);

  for (const item of items.rows) {
    await pool.query(
      `UPDATE store_inventory
       SET stock_quantity = GREATEST(stock_quantity - $1, 0), updated_at = NOW()
       WHERE store_id::text = $2::text AND variant_id::text = $3::text`,
      [item.quantity, storeId, item.variant_id]
    );
  }
}

async function handleWebhook(pool, providerName, payload) {
  const provider = getProvider(providerName);
  const parsed = provider.parseWebhook(payload || {});

  const logResult = await pool.query(
    `INSERT INTO payment_webhook_logs (provider, event_type, payload, processed)
     VALUES ($1,$2,$3::jsonb,false)
     RETURNING *`,
    [providerName, parsed.eventType || 'payment.updated', JSON.stringify(payload || {})]
  );

  const payment = await findPaymentByWebhook(pool, parsed);

  if (!payment) {
    await pool.query(`UPDATE payment_webhook_logs SET processing_error = $1 WHERE id = $2`, ['Payment not found', logResult.rows[0].id]);
    throw new Error('Payment not found for webhook');
  }

  await pool.query(
    `UPDATE payments
     SET status = $1,
         webhook_payload = $2::jsonb,
         provider_payment_id = COALESCE($3, provider_payment_id)
     WHERE id = $4`,
    [parsed.status, JSON.stringify(parsed.raw || {}), parsed.providerPaymentId, payment.id]
  );

  if (parsed.status === 'paid') {
    await pool.query(
      `UPDATE orders
       SET payment_status = 'paid',
           status = CASE WHEN status IN ('pending', 'awaiting_payment', 'payment_failed') THEN 'paid' ELSE status END,
           updated_at = NOW()
       WHERE id = $1`,
      [payment.order_id]
    );

    if (payment.status !== 'paid') {
      await decrementInventoryForOrder(pool, payment.order_id);
    }

    await ensureShipmentForOrder(pool, payment.order_id);
  }

  if (parsed.status === 'failed') {
    await pool.query(
      `UPDATE orders
       SET payment_status = 'failed', status = 'payment_failed', updated_at = NOW()
       WHERE id = $1`,
      [payment.order_id]
    );
  }

  await pool.query(`UPDATE payment_webhook_logs SET processed = true WHERE id = $1`, [logResult.rows[0].id]);

  return { success: true, payment_id: payment.id, status: parsed.status };
}

async function listPayments(pool) {
  const result = await pool.query(
    `SELECT p.*, o.order_number, o.customer_name, o.customer_email
     FROM payments p
     JOIN orders o ON o.id = p.order_id
     ORDER BY p.id DESC`
  );

  return result.rows;
}

async function getPaymentByOrder(pool, orderId) {
  const result = await pool.query(
    `SELECT * FROM payments WHERE order_id = $1 ORDER BY id DESC LIMIT 1`,
    [orderId]
  );
  return result.rows[0] || null;
}

async function listWebhookLogs(pool) {
  const result = await pool.query(`SELECT * FROM payment_webhook_logs ORDER BY id DESC LIMIT 200`);
  return result.rows;
}

module.exports = {
  createCheckout,
  handleWebhook,
  listPayments,
  getPaymentByOrder,
  listWebhookLogs,
};
