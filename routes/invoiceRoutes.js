const express = require('express');
const controller = require('../controllers/invoiceController');
const router = express.Router();

router.get('/', controller.listInvoices);
router.get('/:id/pdf', controller.getInvoicePdf);
router.post('/:id/resend', controller.resendInvoice);
router.post('/sync/pending', controller.syncInvoices);

module.exports = router;
