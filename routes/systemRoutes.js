const express = require('express');
const router = express.Router();
const controller = require('../controllers/systemController');

router.get('/modules', controller.getModules);
router.put('/modules/:module', controller.updateModule);

module.exports = router;
