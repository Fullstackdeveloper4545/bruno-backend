function toStatus(status) {
  const value = String(status || '').toLowerCase();
  if (['paid', 'success', 'confirmed', 'ok'].includes(value)) return 'paid';
  if (['failed', 'cancelled', 'canceled', 'error', 'refused'].includes(value)) return 'failed';
  return 'pending';
}

function randomRef(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

async function callIfthenPay(path, body) {
  const baseUrl = process.env.IFTHENPAY_API_BASE_URL;
  const apiKey = process.env.IFTHENPAY_API_KEY;

  if (!baseUrl || !apiKey || process.env.MOCK_IFTHENPAY === 'true') {
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
    throw new Error(`IfthenPay request failed: ${response.status}`);
  }

  return response.json();
}

async function createPayment({ method, order, customer, callbackUrl, returnUrl }) {
  const amount = Number(order.total);
  const orderNumber = order.order_number;

  if (method === 'mbway') {
    const phone = customer?.phone || '';
    const payload = { amount, order_number: orderNumber, phone, callback_url: callbackUrl };
    const data = await callIfthenPay('/mbway/create', payload);

    return {
      providerPaymentId: data?.id || randomRef('ifp_mbway'),
      status: 'pending',
      paymentUrl: null,
      instructions: {
        method: 'mbway',
        phone,
        message: 'Confirm payment in MB Way app.',
      },
      raw: data,
    };
  }

  if (method === 'mb_reference') {
    const payload = { amount, order_number: orderNumber, callback_url: callbackUrl };
    const data = await callIfthenPay('/mb-reference/create', payload);

    const entity = data?.entity || '12345';
    const reference = data?.reference || String(Math.floor(100000000 + Math.random() * 899999999));

    return {
      providerPaymentId: data?.id || randomRef('ifp_mbr'),
      status: 'pending',
      paymentUrl: null,
      instructions: {
        method: 'mb_reference',
        entity,
        reference,
        amount: amount.toFixed(2),
      },
      raw: data,
    };
  }

  throw new Error(`Unsupported IfthenPay method: ${method}`);
}

function parseWebhook(payload) {
  return {
    providerPaymentId: payload?.provider_payment_id || payload?.payment_id || null,
    transactionRef: payload?.order_number || payload?.transaction_ref || null,
    status: toStatus(payload?.status),
    method: payload?.method || payload?.provider_method || null,
    eventType: payload?.event || 'payment.updated',
    raw: payload,
  };
}

module.exports = {
  createPayment,
  parseWebhook,
};
