const pool = require('../config/db');
const shippingService = require('../services/shipping/shippingService');

function parsePositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function resolveOrderId(orderRef) {
  const normalized = String(orderRef || '').trim();
  if (!normalized) return null;

  const numericId = parsePositiveInt(normalized);
  if (numericId) {
    return numericId;
  }

  const byOrderNumber = await pool.query(`SELECT id FROM orders WHERE order_number = $1 LIMIT 1`, [normalized]);
  return byOrderNumber.rows[0]?.id || null;
}

async function listShipments(req, res) {
  try {
    const shipments = await shippingService.listShipments(pool);
    res.json(shipments);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function generateLabel(req, res) {
  try {
    const orderId = await resolveOrderId(req.params.orderId);
    if (!orderId) {
      return res.status(404).json({ message: 'Order not found. Use a valid order ID or order number.' });
    }
    const shipment = await shippingService.ensureShipmentForOrder(pool, orderId);
    res.status(201).json(shipment);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
}

async function getTracking(req, res) {
  try {
    const orderId = await resolveOrderId(req.params.orderId);
    if (!orderId) {
      return res.status(404).json({ message: 'Order not found. Use a valid order ID or order number.' });
    }

    const tracking = await shippingService.getTrackingByOrder(pool, orderId);
    if (!tracking) {
      return res.json({
        order_id: orderId,
        status: 'not_created',
        tracking_code: null,
        label_url: null,
        steps: [
          { key: 'packaging', label: 'Packaging', state: 'current', reached_at: null },
          { key: 'shipped', label: 'Shipped', state: 'pending', reached_at: null },
          { key: 'out_for_delivery', label: 'Out of Delivery', state: 'pending', reached_at: null },
          { key: 'delivered', label: 'Delivered', state: 'pending', reached_at: null },
        ],
        events: [],
        map: null,
      });
    }
    res.json(tracking);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function cttWebhook(req, res) {
  try {
    const result = await shippingService.processShippingWebhook(pool, req.body || {});
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
}

async function updateTrackingStatus(req, res) {
  try {
    const orderId = await resolveOrderId(req.params.orderId);
    if (!orderId) {
      return res.status(404).json({ message: 'Order not found. Use a valid order ID or order number.' });
    }
    const tracking = await shippingService.updateTrackingStatusForOrder(pool, orderId, req.body || {});
    res.json(tracking);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
}

module.exports = {
  listShipments,
  generateLabel,
  getTracking,
  cttWebhook,
  updateTrackingStatus,
};
