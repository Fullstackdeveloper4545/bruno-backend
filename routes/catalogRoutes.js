const express = require('express');
const controller = require('../controllers/catalogController');
const router = express.Router();

router.get('/products', controller.getProducts);
router.post('/products', controller.createProduct);
router.put('/products/:id', controller.updateProduct);
router.delete('/products/:id', controller.deleteProduct);
router.post('/products/:id/images', controller.addProductImage);
router.delete('/products/:id/images/:imageId', controller.deleteProductImage);
router.post('/products/:id/variants', controller.createVariant);
router.put('/variants/:variantId', controller.updateVariant);
router.delete('/variants/:variantId', controller.deleteVariant);
router.get('/products/:id/inventory', controller.getInventory);
router.put('/variants/:variantId/inventory/:storeId', controller.updateInventory);
router.get('/categories', controller.getCategories);
router.post('/categories', controller.createCategory);
router.put('/categories/:id', controller.updateCategory);
router.delete('/categories/:id', controller.deleteCategory);
router.get('/attributes', controller.getAttributes);
router.post('/attributes', controller.createAttribute);
router.put('/attributes/:id', controller.updateAttribute);
router.delete('/attributes/:id', controller.deleteAttribute);

module.exports = router;
