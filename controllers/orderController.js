const pool = require('../config/db');
const { assignStoreForOrder } = require('../utils/orderRouting');
const { generateInvoiceForOrder } = require('../services/invoiceService');
const shippingService = require('../services/shipping/shippingService');

function orderNumber() {
  return `ORD-${Date.now()}`;
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidOrderItem(item) {
  if (!item || typeof item !== 'object') return false;
  const quantity = Number(item.quantity);
  const unitPrice = Number(item.unit_price);
  return (
    hasText(item.product_name) &&
    Number.isFinite(quantity) &&
    quantity > 0 &&
    Number.isFinite(unitPrice) &&
    unitPrice >= 0
  );
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function canUserCancelOrderStatus(status) {
  return ['pending', 'awaiting_payment', 'payment_failed', 'paid', 'processing'].includes(String(status || ''));
}

function isBlockedShippingStatus(status) {
  return ['shipped', 'delivered', 'completed', 'cancelled'].includes(String(status || ''));
}

async function listOrders(req, res) {
  try {
    const result = await pool.query(
      `SELECT o.*, s.name AS store_name
       FROM orders o
       LEFT JOIN stores s ON s.id::text = o.assigned_store_id::text
       ORDER BY o.id DESC`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function listMyOrders(req, res) {
  try {
    const email = normalizeEmail(req.query?.email);
    if (!email) {
      return res.status(400).json({ message: 'email query parameter is required' });
    }

    const result = await pool.query(
      `SELECT
         o.id,
         o.order_number,
         o.created_at,
         o.status,
         o.subtotal,
         o.discount_total,
         o.total,
         COALESCE(sh.status, o.shipping_status) AS shipping_status,
         COALESCE(sh.tracking_code, o.shipping_tracking_code) AS shipping_tracking_code,
         COALESCE(sh.label_url, o.shipping_label_url) AS shipping_label_url,
         s.name AS store_name,
         (
           SELECT COALESCE(SUM(oi.quantity), 0)::int
           FROM order_items oi
           WHERE oi.order_id = o.id
         ) AS item_count
       FROM orders o
       LEFT JOIN stores s ON s.id::text = o.assigned_store_id::text
       LEFT JOIN shipments sh ON sh.order_id = o.id
       WHERE LOWER(o.customer_email) = $1
       ORDER BY o.id DESC`,
      [email]
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function getOrder(req, res) {
  try {
    const id = Number(req.params.id);
    const orderResult = await pool.query(`SELECT * FROM orders WHERE id = $1`, [id]);

    if (!orderResult.rows[0]) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const items = await pool.query(`SELECT * FROM order_items WHERE order_id = $1`, [id]);
    const payments = await pool.query(`SELECT * FROM payments WHERE order_id = $1`, [id]);

    res.json({ ...orderResult.rows[0], items: items.rows, payments: payments.rows });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function getMyOrder(req, res) {
  try {
    const id = Number(req.params.id);
    const email = normalizeEmail(req.query?.email);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: 'Invalid order id' });
    }
    if (!email) {
      return res.status(400).json({ message: 'email query parameter is required' });
    }

    const orderResult = await pool.query(
      `SELECT o.*, s.name AS store_name
       FROM orders o
       LEFT JOIN stores s ON s.id::text = o.assigned_store_id::text
       WHERE o.id = $1 AND LOWER(o.customer_email) = $2
       LIMIT 1`,
      [id, email]
    );

    if (!orderResult.rows[0]) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const items = await pool.query(`SELECT * FROM order_items WHERE order_id = $1 ORDER BY id ASC`, [id]);
    const payments = await pool.query(`SELECT * FROM payments WHERE order_id = $1 ORDER BY id DESC`, [id]);
    const shipment = await pool.query(`SELECT * FROM shipments WHERE order_id = $1 LIMIT 1`, [id]);
    const invoice = await pool.query(
      `SELECT id, invoice_number, synced, created_at
       FROM invoices
       WHERE order_id = $1
       ORDER BY id DESC
       LIMIT 1`,
      [id]
    );
    const trackingProgress = await shippingService.getTrackingByOrder(pool, id);
    const order = orderResult.rows[0];
    const shipmentRow = shipment.rows[0] || null;

    res.json({
      ...order,
      shipping_status: shipmentRow?.status || order.shipping_status,
      shipping_tracking_code: shipmentRow?.tracking_code || order.shipping_tracking_code,
      shipping_label_url: shipmentRow?.label_url || order.shipping_label_url,
      items: items.rows,
      payments: payments.rows,
      shipment: shipmentRow,
      invoice: invoice.rows[0] || null,
      tracking_progress: trackingProgress,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function downloadMyOrderInvoice(req, res) {
  try {
    const id = Number(req.params.id);
    const email = normalizeEmail(req.query?.email);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: 'Invalid order id' });
    }
    if (!email) {
      return res.status(400).json({ message: 'email query parameter is required' });
    }

    const orderResult = await pool.query(
      `SELECT id
       FROM orders
       WHERE id = $1 AND LOWER(customer_email) = $2
       LIMIT 1`,
      [id, email]
    );
    if (!orderResult.rows[0]) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const existing = await pool.query(`SELECT * FROM invoices WHERE order_id = $1 ORDER BY id DESC LIMIT 1`, [id]);
    const invoice = existing.rows[0] || (await generateInvoiceForOrder(pool, id));

    const buffer = Buffer.from(invoice.pdf_base64, 'base64');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${invoice.invoice_number}.pdf`);
    return res.send(buffer);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
}

async function cancelMyOrder(req, res) {
  let client;
  try {
    const id = Number(req.params.id);
    const email = normalizeEmail(req.query?.email);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: 'Invalid order id' });
    }
    if (!email) {
      return res.status(400).json({ message: 'email query parameter is required' });
    }

    client = await pool.connect();
    await client.query('BEGIN');

    const orderResult = await client.query(
      `SELECT
         o.*,
         sh.status AS shipment_status,
         sh.tracking_code AS shipment_tracking_code,
         sh.label_url AS shipment_label_url
       FROM orders o
       LEFT JOIN shipments sh ON sh.order_id = o.id
       WHERE o.id = $1 AND LOWER(o.customer_email) = $2
       LIMIT 1`,
      [id, email]
    );

    const order = orderResult.rows[0];
    if (!order) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Order not found' });
    }

    const shippingStatus = order.shipment_status || order.shipping_status;
    if (String(order.status) === 'cancelled' || String(shippingStatus) === 'cancelled') {
      await client.query('ROLLBACK');
      return res.json({
        ...order,
        status: 'cancelled',
        shipping_status: 'cancelled',
        message: 'Order is already cancelled',
      });
    }

    if (!canUserCancelOrderStatus(order.status) || isBlockedShippingStatus(shippingStatus)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: 'This order can no longer be cancelled',
      });
    }

    const updateOrder = await client.query(
      `UPDATE orders
       SET status = 'cancelled',
           shipping_status = CASE
             WHEN shipping_status IN ('delivered', 'completed') THEN shipping_status
             ELSE 'cancelled'
           END,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    await client.query(
      `UPDATE shipments
       SET status = CASE
         WHEN status IN ('delivered', 'completed') THEN status
         ELSE 'cancelled'
       END,
       updated_at = NOW()
       WHERE order_id = $1`,
      [id]
    );

    await client.query(
      `INSERT INTO shipment_tracking_events (shipment_id, order_id, status, description, occurred_at, raw_payload)
       SELECT id, $1, 'cancelled', 'Shipment cancelled by customer', NOW(), '{}'::jsonb
       FROM shipments
       WHERE order_id = $1`,
      [id]
    );

    await client.query('COMMIT');

    const updated = updateOrder.rows[0];
    return res.json({
      ...updated,
      shipping_status: isBlockedShippingStatus(shippingStatus) ? shippingStatus : 'cancelled',
      shipping_tracking_code: order.shipment_tracking_code || updated.shipping_tracking_code,
      shipping_label_url: order.shipment_label_url || updated.shipping_label_url,
      message: 'Order cancelled successfully',
    });
  } catch (error) {
    if (client) {
      await client.query('ROLLBACK');
    }
    return res.status(500).json({ message: error.message });
  } finally {
    if (client) {
      client.release();
    }
  }
}

async function createOrder(req, res) {
  let client;
  try {
    client = await pool.connect();

    const {
      customer_name,
      customer_email,
      shipping_address,
      shipping_region,
      items = [],
      discount_total = 0,
    } = req.body;

    const missingFields = [];
    if (!hasText(customer_name)) missingFields.push('customer_name');
    if (!hasText(customer_email)) missingFields.push('customer_email');
    if (!hasText(shipping_address)) missingFields.push('shipping_address');
    if (!Array.isArray(items) || items.length === 0) missingFields.push('items');
    if (Array.isArray(items) && items.some((item) => !isValidOrderItem(item))) {
      missingFields.push('items[*].{product_name,quantity,unit_price}');
    }

    if (missingFields.length > 0) {
      return res.status(400).json({
        message: 'Missing required order fields',
        missing_fields: missingFields,
      });
    }

    const normalizedCustomerName = customer_name.trim();
    const normalizedCustomerEmail = customer_email.trim();
    const normalizedShippingAddress = shipping_address.trim();
    const normalizedShippingRegion = hasText(shipping_region) ? shipping_region.trim() : null;
    const normalizedDiscountTotal = Number(discount_total);
    const safeDiscountTotal =
      Number.isFinite(normalizedDiscountTotal) && normalizedDiscountTotal >= 0 ? normalizedDiscountTotal : 0;
    const normalizedItems = items.map((item) => ({
      product_name: String(item.product_name).trim(),
      sku: item.sku ? String(item.sku).trim() : null,
      quantity: Number(item.quantity),
      unit_price: Number(item.unit_price),
      product_id: item.product_id ?? null,
      variant_id: item.variant_id ?? null,
    }));

    const store = await assignStoreForOrder(pool, normalizedShippingRegion, normalizedItems);
    if (!store?.id) {
      return res.status(400).json({ message: 'No active store available for routing' });
    }

    const subtotal = normalizedItems.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
    const total = Math.max(0, subtotal - safeDiscountTotal);

    await client.query('BEGIN');

    const createdOrder = await client.query(
      `INSERT INTO orders (order_number, customer_name, customer_email, shipping_address, shipping_region, assigned_store_id, status, subtotal, discount_total, total, payment_status, shipping_status, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,'awaiting_payment',$7,$8,$9,'pending','not_created',NOW())
       RETURNING *`,
      [
        orderNumber(),
        normalizedCustomerName,
        normalizedCustomerEmail,
        normalizedShippingAddress,
        normalizedShippingRegion,
        store.id,
        subtotal,
        safeDiscountTotal,
        total,
      ]
    );

    const order = createdOrder.rows[0];

    const productIdCache = new Map();
    const variantIdCache = new Map();

    const resolveExistingProductId = async (candidateId) => {
      if (candidateId == null) return null;
      const id = Number(candidateId);
      if (!Number.isInteger(id) || id <= 0) return null;
      if (productIdCache.has(id)) return productIdCache.get(id);
      const exists = await client.query(`SELECT 1 FROM products WHERE id = $1 LIMIT 1`, [id]);
      const resolved = exists.rows[0] ? id : null;
      productIdCache.set(id, resolved);
      return resolved;
    };

    const resolveExistingVariantId = async (candidateId) => {
      if (candidateId == null) return null;
      const id = Number(candidateId);
      if (!Number.isInteger(id) || id <= 0) return null;
      if (variantIdCache.has(id)) return variantIdCache.get(id);
      const exists = await client.query(`SELECT 1 FROM product_variants WHERE id = $1 LIMIT 1`, [id]);
      const resolved = exists.rows[0] ? id : null;
      variantIdCache.set(id, resolved);
      return resolved;
    };

    for (const item of normalizedItems) {
      const lineTotal = item.quantity * item.unit_price;
      const productId = await resolveExistingProductId(item.product_id);
      const variantId = await resolveExistingVariantId(item.variant_id);
      await client.query(
        `INSERT INTO order_items (order_id, product_id, variant_id, product_name, sku, quantity, unit_price, line_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [order.id, productId, variantId, item.product_name, item.sku || null, item.quantity, item.unit_price, lineTotal]
      );
    }

    await client.query('COMMIT');
    res.status(201).json(order);
  } catch (error) {
    if (client) {
      await client.query('ROLLBACK');
    }
    const message =
      process.env.NODE_ENV === 'development'
        ? `Order creation failed: ${error.message}`
        : 'Order creation failed';
    res.status(500).json({ message });
  } finally {
    if (client) {
      client.release();
    }
  }
}

async function updateOrderStatus(req, res) {
  try {
    const id = Number(req.params.id);
    const { status } = req.body;

    const result = await pool.query(
      `UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [status, id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (status === 'completed') {
      await generateInvoiceForOrder(pool, id);
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

module.exports = {
  listOrders,
  listMyOrders,
  getOrder,
  getMyOrder,
  downloadMyOrderInvoice,
  cancelMyOrder,
  createOrder,
  updateOrderStatus,
};
