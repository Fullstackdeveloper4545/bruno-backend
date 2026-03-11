const express = require('express');
const router = express.Router();
const controller = require('../controllers/securityController');

router.get('/login-activity', controller.listLoginActivity);
router.post('/login-activity', controller.createLoginActivity);

module.exports = router;
