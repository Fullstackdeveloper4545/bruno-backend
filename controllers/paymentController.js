const pool = require('../config/db');
const paymentService = require('../services/payments/paymentService');

async function listPayments(req, res) {
  try {
    const rows = await paymentService.listPayments(pool);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function createCheckout(req, res) {
  try {
    const data = await paymentService.createCheckout(pool, req.body || {});
    res.status(201).json(data);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
}

async function ifthenpayWebhook(req, res) {
  try {
    const data = await paymentService.handleWebhook(pool, 'ifthenpay', req.body || {});
    res.json(data);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
}

async function klarnaWebhook(req, res) {
  try {
    const data = await paymentService.handleWebhook(pool, 'klarna', req.body || {});
    res.json(data);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
}

async function getOrderPayment(req, res) {
  try {
    const orderId = Number(req.params.orderId);
    const data = await paymentService.getPaymentByOrder(pool, orderId);
    if (!data) {
      return res.status(404).json({ message: 'Payment not found for order' });
    }
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function listWebhookLogs(req, res) {
  try {
    const logs = await paymentService.listWebhookLogs(pool);
    res.json(logs);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

module.exports = {
  listPayments,
  createCheckout,
  ifthenpayWebhook,
  klarnaWebhook,
  getOrderPayment,
  listWebhookLogs,
};
