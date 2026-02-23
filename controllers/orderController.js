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

async function getInventorySources(client) {
  const result = await client.query(
    `SELECT
      to_regclass('public.store_inventory') IS NOT NULL AS has_store_inventory,
      to_regclass('public.store_stock') IS NOT NULL AS has_store_stock`
  );
  const row = result.rows[0] || {};
  return {
    hasStoreInventory: Boolean(row.has_store_inventory),
    hasStoreStock: Boolean(row.has_store_stock),
  };
}

function toStockError(message) {
  const error = new Error(message);
  error.code = 'INSUFFICIENT_STOCK';
  return error;
}

async function decrementStockForStore(client, storeId, item, sources) {
  const qty = Number(item.quantity);
  if (!Number.isFinite(qty) || qty <= 0) return;

  if (sources.hasStoreInventory && item.variant_id) {
    const result = await client.query(
      `UPDATE store_inventory
       SET stock_quantity = stock_quantity - $1, updated_at = NOW()
       WHERE store_id::text = $2::text
         AND variant_id::text = $3::text
         AND stock_quantity >= $1
       RETURNING id`,
      [qty, storeId, item.variant_id]
    );
    if (!result.rows[0]) {
      throw toStockError(`Insufficient inventory for variant ${item.variant_id}`);
    }
    return;
  }

  if (sources.hasStoreStock && item.variant_id) {
    const variantStock = await client.query(
      `UPDATE store_stock
       SET quantity = quantity - $1, updated_at = NOW()
       WHERE store_id::text = $2::text
         AND variant_id::text = $3::text
         AND quantity >= $1
       RETURNING id`,
      [qty, storeId, item.variant_id]
    );
    if (variantStock.rows[0]) return;
  }

  if (sources.hasStoreStock && item.product_id) {
    const productStock = await client.query(
      `UPDATE store_stock
       SET quantity = quantity - $1, updated_at = NOW()
       WHERE store_id::text = $2::text
         AND product_id::text = $3::text
         AND (variant_id IS NULL OR variant_id::text = '')
         AND quantity >= $1
       RETURNING id`,
      [qty, storeId, item.product_id]
    );
    if (productStock.rows[0]) return;
  }

  if (sources.hasStoreInventory || sources.hasStoreStock) {
    throw toStockError(`Insufficient stock for item ${item.sku || item.product_name}`);
  }
}

async function reserveStockForOrder(client, storeId, items) {
  const sources = await getInventorySources(client);
  for (const item of items) {
    await decrementStockForStore(client, storeId, item, sources);
  }
}

async function incrementStockForStore(client, storeId, item, sources) {
  const qty = Number(item.quantity);
  if (!Number.isFinite(qty) || qty <= 0) return;

  if (sources.hasStoreInventory && item.variant_id) {
    const result = await client.query(
      `UPDATE store_inventory
       SET stock_quantity = stock_quantity + $1, updated_at = NOW()
       WHERE store_id::text = $2::text
         AND variant_id::text = $3::text
       RETURNING id`,
      [qty, storeId, item.variant_id]
    );
    if (result.rows[0]) return;
  }

  if (sources.hasStoreStock && item.variant_id) {
    const result = await client.query(
      `UPDATE store_stock
       SET quantity = quantity + $1, updated_at = NOW()
       WHERE store_id::text = $2::text
         AND variant_id::text = $3::text
       RETURNING id`,
      [qty, storeId, item.variant_id]
    );
    if (result.rows[0]) return;
  }

  if (sources.hasStoreStock && item.product_id) {
    await client.query(
      `UPDATE store_stock
       SET quantity = quantity + $1, updated_at = NOW()
       WHERE store_id::text = $2::text
         AND product_id::text = $3::text
         AND (variant_id IS NULL OR variant_id::text = '')`,
      [qty, storeId, item.product_id]
    );
  }
}

async function restoreStockForOrder(client, orderId, storeId) {
  const itemsResult = await client.query(
    `SELECT product_id, variant_id, quantity, sku, product_name
     FROM order_items
     WHERE order_id = $1`,
    [orderId]
  );
  const sources = await getInventorySources(client);
  for (const item of itemsResult.rows) {
    await incrementStockForStore(client, storeId, item, sources);
  }
}

async function listOrders(req, res) {
  try {
    const result = await pool.query(
      `SELECT o.*, s.name AS store_name, s.address AS store_address
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
         s.address AS store_address,
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
      `SELECT o.*, s.name AS store_name, s.address AS store_address
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

    if (order.stock_committed && order.assigned_store_id) {
      await restoreStockForOrder(client, id, order.assigned_store_id);
    }

    const updateOrder = await client.query(
      `UPDATE orders
       SET status = 'cancelled',
           stock_committed = false,
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
    await reserveStockForOrder(client, store.id, normalizedItems);

    const createdOrder = await client.query(
      `INSERT INTO orders (order_number, customer_name, customer_email, shipping_address, shipping_region, assigned_store_id, status, subtotal, discount_total, total, payment_status, shipping_status, stock_committed, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,'awaiting_payment',$7,$8,$9,'pending','not_created',true,NOW())
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
      const id = String(candidateId).trim();
      if (!id) return null;
      if (productIdCache.has(id)) return productIdCache.get(id);
      const exists = await client.query(`SELECT 1 FROM products WHERE id = $1 LIMIT 1`, [id]);
      const resolved = exists.rows[0] ? id : null;
      productIdCache.set(id, resolved);
      return resolved;
    };

    const resolveExistingVariantId = async (candidateId) => {
      if (candidateId == null) return null;
      const id = String(candidateId).trim();
      if (!id) return null;
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
    if (error?.code === 'INSUFFICIENT_STOCK') {
      return res.status(409).json({ message: error.message, code: 'INSUFFICIENT_STOCK' });
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

async function getDashboardSummary(req, res) {
  try {
    const thresholdRaw = Number(req.query?.threshold);
    const threshold = Number.isFinite(thresholdRaw) && thresholdRaw >= 0 ? Math.floor(thresholdRaw) : 5;
    const limitRaw = Number(req.query?.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : 10;

    const ordersPerStoreResult = await pool.query(
      `SELECT
         o.assigned_store_id AS store_id,
         COALESCE(s.name, 'Unassigned') AS store_name,
         COUNT(o.id)::int AS orders
       FROM orders o
       LEFT JOIN stores s ON s.id::text = o.assigned_store_id::text
       GROUP BY o.assigned_store_id, s.name
       ORDER BY COUNT(o.id) DESC, COALESCE(s.name, 'Unassigned') ASC`
    );

    const orders7dResult = await pool.query(
      `SELECT
         TO_CHAR(days.day, 'Dy') AS day_label,
         COALESCE(COUNT(o.id), 0)::int AS orders
       FROM (
         SELECT generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, INTERVAL '1 day')::date AS day
       ) days
       LEFT JOIN orders o ON o.created_at::date = days.day
       GROUP BY days.day
       ORDER BY days.day ASC`
    );

    const revenue7dResult = await pool.query(
      `SELECT
         TO_CHAR(days.day, 'Dy') AS day_label,
         COALESCE(SUM(o.total), 0)::numeric(12,2) AS revenue
       FROM (
         SELECT generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, INTERVAL '1 day')::date AS day
       ) days
       LEFT JOIN orders o ON o.created_at::date = days.day
       GROUP BY days.day
       ORDER BY days.day ASC`
    );

    const revenue30dResult = await pool.query(
      `SELECT
         TO_CHAR(days.day, 'DD Mon') AS day_label,
         COALESCE(SUM(o.total), 0)::numeric(12,2) AS revenue
       FROM (
         SELECT generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, INTERVAL '1 day')::date AS day
       ) days
       LEFT JOIN orders o ON o.created_at::date = days.day
       GROUP BY days.day
       ORDER BY days.day ASC`
    );

    const source = await pool.query(
      `SELECT
         to_regclass('public.store_inventory') IS NOT NULL AS has_store_inventory,
         to_regclass('public.store_stock') IS NOT NULL AS has_store_stock`
    );
    const hasStoreInventory = Boolean(source.rows[0]?.has_store_inventory);
    const hasStoreStock = Boolean(source.rows[0]?.has_store_stock);

    let lowStockRows = [];
    if (hasStoreInventory) {
      const lowStockResult = await pool.query(
        `SELECT
           p.id AS product_id,
           COALESCE(NULLIF(p.name_pt, ''), NULLIF(p.name_es, ''), p.sku, p.id::text) AS product_name,
           COALESCE(MIN(NULLIF(v.sku, '')), p.sku, p.id::text) AS sku,
           s.id AS store_id,
           COALESCE(s.name, 'Unknown Store') AS store_name,
           COALESCE(SUM(si.stock_quantity), 0)::int AS stock_left
         FROM products p
         JOIN product_variants v ON v.product_id = p.id
         JOIN store_inventory si ON si.variant_id::text = v.id::text
         LEFT JOIN stores s ON s.id::text = si.store_id::text
         GROUP BY p.id, p.name_pt, p.name_es, p.sku, s.id, s.name
         HAVING COALESCE(SUM(si.stock_quantity), 0) < $1
         ORDER BY stock_left ASC, store_name ASC, product_name ASC
         LIMIT $2`,
        [threshold, limit]
      );
      lowStockRows = lowStockResult.rows;
    } else if (hasStoreStock) {
      const lowStockResult = await pool.query(
        `SELECT
           p.id AS product_id,
           COALESCE(NULLIF(p.name_pt, ''), NULLIF(p.name_es, ''), p.sku, p.id::text) AS product_name,
           COALESCE(p.sku, p.id::text) AS sku,
           s.id AS store_id,
           COALESCE(s.name, 'Unknown Store') AS store_name,
           COALESCE(SUM(ss.quantity), 0)::int AS stock_left
         FROM products p
         JOIN store_stock ss ON ss.product_id::text = p.id::text
         LEFT JOIN stores s ON s.id::text = ss.store_id::text
         GROUP BY p.id, p.name_pt, p.name_es, p.sku, s.id, s.name
         HAVING COALESCE(SUM(ss.quantity), 0) < $1
         ORDER BY stock_left ASC, store_name ASC, product_name ASC
         LIMIT $2`,
        [threshold, limit]
      );
      lowStockRows = lowStockResult.rows;
    }

    res.json({
      orders_per_store: ordersPerStoreResult.rows.map((row) => ({
        store_id: row.store_id || null,
        store_name: row.store_name,
        orders: Number(row.orders || 0),
      })),
      orders_7d: orders7dResult.rows.map((row) => ({
        day: String(row.day_label || '').trim(),
        orders: Number(row.orders || 0),
      })),
      revenue_7d: revenue7dResult.rows.map((row) => ({
        day: String(row.day_label || '').trim(),
        revenue: Number(row.revenue || 0),
      })),
      revenue_30d: revenue30dResult.rows.map((row) => ({
        day: String(row.day_label || '').trim(),
        revenue: Number(row.revenue || 0),
      })),
      low_stock_products: lowStockRows.map((row) => ({
        product_id: row.product_id,
        name: row.product_name,
        sku: row.sku,
        store_id: row.store_id || null,
        store_name: row.store_name || 'Unknown Store',
        stock_left: Number(row.stock_left || 0),
      })),
      threshold,
      limit,
    });
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
  getDashboardSummary,
};
