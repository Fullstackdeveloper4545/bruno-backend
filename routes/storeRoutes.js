const express = require('express');
const controller = require('../controllers/storeController');
const router = express.Router();

router.get('/routing/config', controller.getRoutingConfig);
router.put('/routing/config', controller.setRoutingConfig);
router.get('/', controller.listStores);
router.post('/', controller.createStore);
router.put('/:id', controller.updateStore);
router.delete('/:id', controller.deleteStore);

module.exports = router;
