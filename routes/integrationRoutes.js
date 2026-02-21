const express = require('express');
const controller = require('../controllers/integrationController');
const router = express.Router();

router.get('/settings', controller.getIntegrationSettings);
router.put('/settings', controller.updateIntegrationSettings);
router.post('/sync/manual', controller.manualSync);
router.post('/webhook', controller.webhookSync);
router.get('/logs', controller.getSyncLogs);

module.exports = router;
