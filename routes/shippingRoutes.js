const express = require('express');
const controller = require('../controllers/shippingController');
const router = express.Router();

router.get('/', controller.listShipments);
router.post('/orders/:orderId/label', controller.generateLabel);
router.get('/orders/:orderId/tracking', controller.getTracking);
router.post('/webhooks/ctt', controller.cttWebhook);

module.exports = router;
