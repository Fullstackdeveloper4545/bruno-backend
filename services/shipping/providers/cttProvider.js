function randomTracking() {
  return `CTT-${Math.floor(100000 + Math.random() * 900000)}-${Math.floor(10 + Math.random() * 90)}`;
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function normalizeTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function callCtt(path, body) {
  const baseUrl = process.env.CTT_API_BASE_URL;
  const apiKey = process.env.CTT_API_KEY;

  if (!baseUrl || !apiKey || process.env.MOCK_CTT === 'true') {
    return { mock: true, data: body };
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`CTT request failed: ${response.status}`);
  }

  return response.json();
}

async function createLabel({ order, store }) {
  const payload = {
    reference: order.order_number,
    recipient: {
      name: order.customer_name,
      email: order.customer_email,
      address: order.shipping_address,
      region: order.shipping_region,
    },
    origin_store: store ? { id: store.id, name: store.name, address: store.address } : null,
  };

  const data = await callCtt('/labels/create', payload);

  const trackingCode = data?.tracking_code || randomTracking();
  const labelUrl = data?.label_url || `${process.env.APP_PUBLIC_URL || 'http://localhost:5000'}/labels/${trackingCode}.pdf`;

  return {
    provider: 'ctt',
    status: 'label_created',
    trackingCode,
    labelUrl,
    raw: data,
  };
}

function parseWebhook(payload) {
  const status = String(payload?.status || 'in_transit').toLowerCase();
  const location = firstText(
    payload?.location,
    payload?.city,
    payload?.facility,
    payload?.checkpoint,
    payload?.hub,
    payload?.address?.city
  );
  const description = firstText(payload?.description, payload?.message, payload?.event, payload?.event_description);
  const occurredAt = normalizeTimestamp(payload?.occurred_at || payload?.timestamp || payload?.event_date || payload?.date);

  return {
    trackingCode: payload?.tracking_code || null,
    status,
    location,
    description,
    occurredAt,
    raw: payload,
  };
}

module.exports = {
  createLabel,
  parseWebhook,
};
