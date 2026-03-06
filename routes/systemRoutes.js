const express = require('express');
const router = express.Router();
const controller = require('../controllers/systemController');

router.get('/modules', controller.getModules);
router.get('/about-us', controller.getAboutUs);
router.get('/general-settings', controller.getGeneralSettings);
router.put('/modules/:module', controller.updateModule);
router.put('/general-settings', controller.updateGeneralSettings);

module.exports = router;
