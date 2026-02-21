const express = require('express');
const controller = require('../controllers/discountController');
const router = express.Router();

router.get('/coupons', controller.listCoupons);
router.post('/coupons', controller.createCoupon);
router.put('/coupons/:id', controller.updateCoupon);
router.delete('/coupons/:id', controller.deleteCoupon);
router.post('/apply', controller.applyCoupon);

module.exports = router;
