const express = require('express');
const controller = require('../controllers/catalogController');

const router = express.Router();

router.get('/', controller.getProducts);
router.post('/', controller.createProduct);
router.put('/:id', controller.updateProduct);
router.delete('/:id', controller.deleteProduct);
router.post('/:id/images', controller.addProductImage);
router.delete('/:id/images/:imageId', controller.deleteProductImage);
router.post('/:id/variants', controller.createVariant);
router.get('/:id/inventory', controller.getInventory);

module.exports = router;
