const express = require('express');
const controller = require('../controllers/orderController');
const router = express.Router();

router.get('/', controller.listOrders);
router.get('/my', controller.listMyOrders);
router.get('/my/:id', controller.getMyOrder);
router.get('/my/:id/invoice', controller.downloadMyOrderInvoice);
router.put('/my/:id/cancel', controller.cancelMyOrder);
router.get('/:id', controller.getOrder);
router.post('/', controller.createOrder);
router.put('/:id/status', controller.updateOrderStatus);

module.exports = router;
