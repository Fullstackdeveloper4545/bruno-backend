const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

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

function toCoordinate(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCoordinatesFromText(value) {
  if (typeof value !== 'string') return { latitude: null, longitude: null };
  const match = value.trim().match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!match) return { latitude: null, longitude: null };
  return {
    latitude: toCoordinate(match[1]),
    longitude: toCoordinate(match[2]),
  };
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

function sanitizeFilename(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '');
}

function getPublicBaseUrl() {
  const raw = String(process.env.APP_PUBLIC_URL || 'http://localhost:5000').trim();
  return raw.replace(/\/+$/, '');
}

async function createMockLabelPdf(trackingCode, payload = {}) {
  const safeTrackingCode = sanitizeFilename(trackingCode) || randomTracking();
  const labelsDir = path.join(__dirname, '..', '..', '..', 'labels');
  const filename = `${safeTrackingCode}.pdf`;
  const fullPath = path.join(labelsDir, filename);

  if (fs.existsSync(fullPath)) {
    return `${getPublicBaseUrl()}/labels/${filename}`;
  }

  await fs.promises.mkdir(labelsDir, { recursive: true });

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const stream = fs.createWriteStream(fullPath);

    stream.on('finish', resolve);
    stream.on('error', reject);
    doc.on('error', reject);

    doc.pipe(stream);
    doc.fontSize(20).text('CTT Shipping Label (Mock)', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Tracking Code: ${trackingCode}`);
    doc.text(`Order: ${payload?.reference || '-'}`);
    doc.text(`Recipient: ${payload?.recipient?.name || '-'}`);
    doc.text(`Address: ${payload?.recipient?.address || '-'}`);
    doc.text(`Region: ${payload?.recipient?.region || '-'}`);
    doc.moveDown();
    doc.text('This is a mock label generated for local development/testing.');
    doc.end();
  });

  return `${getPublicBaseUrl()}/labels/${filename}`;
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
  const labelUrl = data?.label_url || (await createMockLabelPdf(trackingCode, payload));

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
  let latitude = toCoordinate(
    payload?.latitude ?? payload?.lat ?? payload?.location_lat ?? payload?.coordinates?.lat ?? payload?.coords?.lat
  );
  let longitude = toCoordinate(
    payload?.longitude ?? payload?.lng ?? payload?.location_lng ?? payload?.coordinates?.lng ?? payload?.coords?.lng
  );
  if (latitude == null || longitude == null) {
    const parsedFromLocation = parseCoordinatesFromText(location);
    latitude = latitude ?? parsedFromLocation.latitude;
    longitude = longitude ?? parsedFromLocation.longitude;
  }

  return {
    trackingCode: payload?.tracking_code || null,
    status,
    location,
    description,
    occurredAt,
    latitude,
    longitude,
    raw: payload,
  };
}

module.exports = {
  createLabel,
  parseWebhook,
};
