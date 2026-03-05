const express = require('express');
const controller = require('../controllers/blogController');

const router = express.Router();

router.get('/', controller.listPublicPosts);
router.get('/admin', controller.listAdminPosts);
router.post('/admin', controller.createPost);
router.put('/admin/:id', controller.updatePost);
router.delete('/admin/:id', controller.deletePost);
router.get('/:slug', controller.getPublicPostBySlug);

module.exports = router;
