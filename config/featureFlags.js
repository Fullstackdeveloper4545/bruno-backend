function toBool(value, fallback = false) {
  if (value == null) return fallback;
  return String(value).toLowerCase() === 'true';
}

module.exports = {
  modules: {
    auth: toBool(process.env.FLAG_AUTH, true),
    product: toBool(process.env.FLAG_PRODUCT, true),
    store: toBool(process.env.FLAG_STORE, true),
    order: toBool(process.env.FLAG_ORDER, true),
    payment: toBool(process.env.FLAG_PAYMENT, true),
    shipping: toBool(process.env.FLAG_SHIPPING, true),
    discount: toBool(process.env.FLAG_DISCOUNT, true),
    invoice: toBool(process.env.FLAG_INVOICE, true),
    integration: toBool(process.env.FLAG_INTEGRATION, true),
    report: toBool(process.env.FLAG_REPORT, true),
    language: toBool(process.env.FLAG_LANGUAGE, true),
  },
};