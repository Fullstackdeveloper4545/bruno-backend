const express = require('express');
const controller = require('../controllers/languageController');
const router = express.Router();

router.get('/', controller.getLanguages);
router.put('/', controller.setLanguages);

module.exports = router;
