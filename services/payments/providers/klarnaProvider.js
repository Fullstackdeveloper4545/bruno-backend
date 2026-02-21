function toStatus(status) {
  const value = String(status || '').toLowerCase();
  if (['paid', 'success', 'authorized', 'captured'].includes(value)) return 'paid';
  if (['failed', 'cancelled', 'canceled', 'expired'].includes(value)) return 'failed';
  return 'pending';
}

function randomRef(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

async function callKlarna(path, body) {
  const baseUrl = process.env.KLARNA_API_BASE_URL;
  const apiKey = process.env.KLARNA_API_KEY;

  if (!baseUrl || !apiKey || process.env.MOCK_KLARNA === 'true') {
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
    throw new Error(`Klarna request failed: ${response.status}`);
  }

  return response.json();
}

async function createPayment({ order, callbackUrl, returnUrl }) {
  const amount = Number(order.total);
  const payload = {
    amount,
    order_number: order.order_number,
    callback_url: callbackUrl,
    return_url: returnUrl,
  };

  const data = await callKlarna('/checkout/create', payload);

  return {
    providerPaymentId: data?.id || randomRef('klarna'),
    status: 'pending',
    paymentUrl: data?.checkout_url || `${returnUrl || ''}?klarna=${order.order_number}`,
    instructions: {
      method: 'klarna',
      message: 'Open Klarna checkout URL to complete payment.',
    },
    raw: data,
  };
}

function parseWebhook(payload) {
  return {
    providerPaymentId: payload?.provider_payment_id || payload?.payment_id || null,
    transactionRef: payload?.order_number || payload?.transaction_ref || null,
    status: toStatus(payload?.status),
    method: 'klarna',
    eventType: payload?.event || 'payment.updated',
    raw: payload,
  };
}

module.exports = {
  createPayment,
  parseWebhook,
};
