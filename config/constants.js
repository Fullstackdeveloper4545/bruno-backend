const ORDER_STATUS = {
  PENDING: 'pending',
  AWAITING_PAYMENT: 'awaiting_payment',
  PAID: 'paid',
  PROCESSING: 'processing',
  SHIPPED: 'shipped',
  COMPLETED: 'completed',
  PAYMENT_FAILED: 'payment_failed',
  CANCELLED: 'cancelled',
};

const ROUTING_MODE = {
  REGION: 'region',
  QUANTITY: 'quantity',
};

const PAYMENT_METHOD = {
  MB_WAY: 'mbway',
  MB_REFERENCE: 'mb_reference',
  KLARNA: 'klarna',
};

module.exports = {
  ORDER_STATUS,
  ROUTING_MODE,
  PAYMENT_METHOD,
};