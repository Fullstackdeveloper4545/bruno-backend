const cttProvider = require('./providers/cttProvider');
const { sendOrderTrackingEmail } = require('../mailService');

const STEP_SEQUENCE = ['packaging', 'shipped', 'out_for_delivery', 'delivered'];
const STEP_LABELS = {
  packaging: 'Packaging',
  shipped: 'Shipped',
  out_for_delivery: 'Out of Delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

const STATUS_LABELS = {
  label_created: 'Label Created',
  created: 'Label Created',
  shipped: 'Shipped',
  in_transit: 'In Transit',
  out_for_delivery: 'Out of Delivery',
  delivered: 'Delivered',
  completed: 'Delivered',
  cancelled: 'Cancelled',
};

function normalizeStatus(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_');
}

function mapStatusToStep(status) {
  const key = normalizeStatus(status);
  if (!key || key === 'not_created') return 'not_created';
  if (['cancelled'].includes(key)) return 'cancelled';
  if (
    ['label_created', 'created', 'pending', 'awaiting_payment', 'processing', 'paid', 'payment_pending'].includes(key)
  ) {
    return 'packaging';
  }
  if (['shipped'].includes(key)) return 'shipped';
  if (['out_for_delivery'].includes(key)) return 'out_for_delivery';
  if (['delivered', 'completed'].includes(key)) return 'delivered';
  if (
    [
      'in_transit',
      'transit',
      'at_hub',
      'hub_received',
      'at_sorting_center',
      'sorting',
      'arrived',
      'on_route',
      'in_route',
      'departure_scan',
      'arrival_scan',
    ].includes(key)
  ) {
    return 'shipped';
  }

  // Unknown in-flight statuses are best represented as shipped.
  return 'shipped';
}

function formatStatusLabel(status) {
  const key = normalizeStatus(status);
  return STATUS_LABELS[key] || key.replace(/[_-]+/g, ' ');
}

function defaultDescriptionForStatus(status) {
  const step = mapStatusToStep(status);
  if (step === 'packaging') return 'Order is being prepared and packaged';
  if (step === 'shipped') return 'Parcel has left the origin store';
  if (step === 'out_for_delivery') return 'Courier is out for delivery';
  if (step === 'delivered') return 'Parcel delivered';
  if (step === 'cancelled') return 'Shipment cancelled';
  return null;
}

async function insertTrackingEvent(
  pool,
  { shipmentId, orderId, status, location = null, description = null, occurredAt = null, rawPayload = {} }
) {
  await pool.query(
    `INSERT INTO shipment_tracking_events (shipment_id, order_id, status, location, description, occurred_at, raw_payload)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6::timestamp,NOW()),$7::jsonb)`,
    [
      shipmentId,
      orderId,
      normalizeStatus(status),
      location,
      description || defaultDescriptionForStatus(status),
      occurredAt,
      JSON.stringify(rawPayload || {}),
    ]
  );
}

async function getTrackingEventsByOrder(pool, orderId) {
  const result = await pool.query(
    `SELECT id, shipment_id, order_id, status, location, description, occurred_at
     FROM shipment_tracking_events
     WHERE order_id = $1
     ORDER BY occurred_at ASC, id ASC`,
    [orderId]
  );
  return result.rows;
}

function buildProgressSteps(shipment, events) {
  if (!shipment) {
    return STEP_SEQUENCE.map((step, index) => ({
      key: step,
      label: STEP_LABELS[step],
      state: index === 0 ? 'current' : 'pending',
      reached_at: null,
    }));
  }

  const reachedAtByStep = new Map();
  for (const event of events) {
    const step = mapStatusToStep(event.status);
    if (step === 'not_created' || step === 'cancelled') continue;
    if (!reachedAtByStep.has(step)) {
      reachedAtByStep.set(step, event.occurred_at || null);
    }
  }

  if (!reachedAtByStep.has('packaging')) {
    reachedAtByStep.set('packaging', shipment.created_at || null);
  }

  const currentStep = mapStatusToStep(shipment.status);
  if (currentStep === 'cancelled') {
    return [
      ...STEP_SEQUENCE.map((step) => ({
        key: step,
        label: STEP_LABELS[step],
        state: reachedAtByStep.has(step) ? 'done' : 'pending',
        reached_at: reachedAtByStep.get(step) || null,
      })),
      {
        key: 'cancelled',
        label: STEP_LABELS.cancelled,
        state: 'cancelled',
        reached_at: shipment.updated_at || null,
      },
    ];
  }

  const currentIndex = Math.max(STEP_SEQUENCE.indexOf(currentStep), 0);

  return STEP_SEQUENCE.map((step, idx) => {
    const reachedAt = reachedAtByStep.get(step) || null;
    let state = 'pending';
    if (idx < currentIndex || reachedAt) state = 'done';
    if (idx === currentIndex) state = 'current';
    if (currentStep === 'delivered' && idx === currentIndex) state = 'done';

    return {
      key: step,
      label: STEP_LABELS[step],
      state,
      reached_at: reachedAt,
    };
  });
}

function buildTrackingResponse(orderId, orderNumber, shipment, events) {
  const currentStatus = shipment ? normalizeStatus(shipment.status) : 'not_created';
  const steps = buildProgressSteps(shipment, events);
  const formattedEvents = events
    .slice()
    .reverse()
    .map((event) => ({
      id: event.id,
      status: normalizeStatus(event.status),
      label: formatStatusLabel(event.status),
      location: event.location || null,
      description: event.description || null,
      occurred_at: event.occurred_at,
    }));

  return {
    order_id: orderId,
    order_number: orderNumber || null,
    provider: shipment?.provider || 'ctt',
    status: currentStatus,
    tracking_code: shipment?.tracking_code || null,
    label_url: shipment?.label_url || null,
    created_at: shipment?.created_at || null,
    updated_at: shipment?.updated_at || null,
    steps,
    events: formattedEvents,
  };
}

async function ensureShipmentForOrder(pool, orderId) {
  const existing = await pool.query(`SELECT * FROM shipments WHERE order_id = $1`, [orderId]);
  if (existing.rows[0]) {
    return existing.rows[0];
  }

  const orderResult = await pool.query(
    `SELECT o.*, s.id AS store_id, s.name AS store_name, s.address AS store_address
     FROM orders o
     LEFT JOIN stores s ON s.id::text = o.assigned_store_id::text
     WHERE o.id = $1`,
    [orderId]
  );

  if (!orderResult.rows[0]) {
    throw new Error('Order not found for shipment creation');
  }

  const order = orderResult.rows[0];
  const shipmentData = await cttProvider.createLabel({
    order,
    store: order.store_id ? { id: order.store_id, name: order.store_name, address: order.store_address } : null,
  });

  const shipmentResult = await pool.query(
    `INSERT INTO shipments (order_id, provider, status, tracking_code, label_url, payload, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,NOW())
     RETURNING *`,
    [
      orderId,
      shipmentData.provider,
      shipmentData.status,
      shipmentData.trackingCode,
      shipmentData.labelUrl,
      JSON.stringify(shipmentData.raw || {}),
    ]
  );

  await pool.query(
    `UPDATE orders
     SET shipping_status = $1,
         shipping_tracking_code = $2,
         shipping_label_url = $3,
         status = CASE WHEN status IN ('paid', 'awaiting_payment', 'pending') THEN 'processing' ELSE status END,
         updated_at = NOW()
     WHERE id = $4`,
    [shipmentData.status, shipmentData.trackingCode, shipmentData.labelUrl, orderId]
  );

  await insertTrackingEvent(pool, {
    shipmentId: shipmentResult.rows[0].id,
    orderId,
    status: shipmentData.status,
    location: order.store_name || null,
    description: 'Shipping label created',
    rawPayload: shipmentData.raw || {},
  });

  await sendOrderTrackingEmail(order.customer_email, order.order_number, shipmentData.trackingCode, shipmentData.labelUrl);

  return shipmentResult.rows[0];
}

async function processShippingWebhook(pool, payload) {
  const parsed = cttProvider.parseWebhook(payload);

  if (!parsed.trackingCode) {
    throw new Error('tracking_code is required in CTT webhook');
  }

  const shipment = await pool.query(`SELECT * FROM shipments WHERE tracking_code = $1`, [parsed.trackingCode]);
  if (!shipment.rows[0]) {
    throw new Error('Shipment not found for tracking code');
  }

  const shipmentId = shipment.rows[0].id;
  const orderId = shipment.rows[0].order_id;

  await pool.query(
    `UPDATE shipments SET status = $1, payload = $2::jsonb, updated_at = NOW() WHERE id = $3`,
    [parsed.status, JSON.stringify(parsed.raw || {}), shipmentId]
  );

  await insertTrackingEvent(pool, {
    shipmentId,
    orderId,
    status: parsed.status,
    location: parsed.location,
    description: parsed.description,
    occurredAt: parsed.occurredAt,
    rawPayload: parsed.raw || {},
  });

  await pool.query(
    `UPDATE orders
     SET shipping_status = $1,
         status = CASE WHEN $1 IN ('delivered','completed') THEN 'completed' ELSE status END,
         updated_at = NOW()
     WHERE id = $2`,
    [parsed.status, orderId]
  );

  return { success: true, order_id: orderId, status: parsed.status };
}

async function listShipments(pool) {
  const result = await pool.query(
    `SELECT sh.*, o.order_number, o.customer_email, o.shipping_address
     FROM shipments sh
     JOIN orders o ON o.id = sh.order_id
     ORDER BY sh.id DESC`
  );

  return result.rows;
}

async function getTrackingByOrder(pool, orderId) {
  const result = await pool.query(
    `SELECT o.id AS order_id, o.order_number, sh.*
     FROM orders o
     LEFT JOIN shipments sh ON sh.order_id = o.id
     WHERE o.id = $1
     LIMIT 1`,
    [orderId]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const shipment = row.id ? row : null;
  const events = shipment ? await getTrackingEventsByOrder(pool, orderId) : [];
  return buildTrackingResponse(orderId, row.order_number, shipment, events);
}

async function updateTrackingStatusForOrder(pool, orderId, payload = {}) {
  if (!Number.isInteger(orderId) || orderId <= 0) {
    throw new Error('Invalid order id');
  }

  const orderResult = await pool.query(`SELECT id FROM orders WHERE id = $1 LIMIT 1`, [orderId]);
  if (!orderResult.rows[0]) {
    throw new Error('Order not found');
  }

  const status = normalizeStatus(payload.status || 'in_transit');
  if (!status) {
    throw new Error('status is required');
  }

  const location = typeof payload.location === 'string' ? payload.location.trim() || null : null;
  const description = typeof payload.description === 'string' ? payload.description.trim() || null : null;

  const existingShipment = await pool.query(`SELECT * FROM shipments WHERE order_id = $1 LIMIT 1`, [orderId]);
  const shipment = existingShipment.rows[0] || (await ensureShipmentForOrder(pool, orderId));

  await pool.query(
    `UPDATE shipments
     SET status = $1,
         updated_at = NOW()
     WHERE id = $2`,
    [status, shipment.id]
  );

  await insertTrackingEvent(pool, {
    shipmentId: shipment.id,
    orderId,
    status,
    location,
    description,
    rawPayload: payload,
  });

  await pool.query(
    `UPDATE orders
     SET shipping_status = $1,
         shipping_tracking_code = COALESCE(shipping_tracking_code, $2),
         shipping_label_url = COALESCE(shipping_label_url, $3),
         status = CASE
           WHEN $1 IN ('delivered', 'completed') THEN 'completed'
           WHEN $1 IN ('shipped', 'in_transit', 'out_for_delivery', 'label_created', 'created') AND status IN ('paid', 'awaiting_payment', 'pending', 'processing') THEN 'processing'
           ELSE status
         END,
         updated_at = NOW()
     WHERE id = $4`,
    [status, shipment.tracking_code, shipment.label_url, orderId]
  );

  return getTrackingByOrder(pool, orderId);
}

module.exports = {
  ensureShipmentForOrder,
  processShippingWebhook,
  listShipments,
  getTrackingByOrder,
  updateTrackingStatusForOrder,
};
