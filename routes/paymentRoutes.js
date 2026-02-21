const express = require('express');
const controller = require('../controllers/paymentController');
const router = express.Router();

router.get('/', controller.listPayments);
router.post('/checkout', controller.createCheckout);
router.get('/order/:orderId', controller.getOrderPayment);
router.get('/webhooks/logs', controller.listWebhookLogs);
router.post('/webhooks/ifthenpay', controller.ifthenpayWebhook);
router.post('/webhooks/klarna', controller.klarnaWebhook);

module.exports = router;
