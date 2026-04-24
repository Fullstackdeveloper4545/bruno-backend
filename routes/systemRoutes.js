const express = require('express');
const router = express.Router();
const controller = require('../controllers/systemController');

router.get('/modules', controller.getModules);
router.get('/pages', controller.listSitePages);
router.get('/pages/:slug', controller.getSitePage);
router.get('/about-us', controller.getAboutUs);
router.get('/general-settings', controller.getGeneralSettings);
router.get('/theme', controller.getThemeSettings);
router.get('/athlete-settings', controller.getAthleteSettings);
router.get('/brand-settings', controller.getBrandSettings);
router.get('/performance-settings', controller.getPerformanceSettings);
router.get('/public-themes', controller.listPublicThemes);
router.get('/public-themes/:id', controller.getPublicTheme);
router.put('/modules/:module', controller.updateModule);
router.put('/pages/:slug', controller.upsertSitePage);
router.put('/about-us', controller.updateAboutUs);
router.put('/general-settings', controller.updateGeneralSettings);
router.put('/theme', controller.updateThemeSettings);
router.put('/athlete-settings', controller.updateAthleteSettings);
router.put('/brand-settings', controller.updateBrandSettings);
router.put('/performance-settings', controller.updatePerformanceSettings);
router.post('/public-themes', controller.createPublicTheme);
router.put('/public-themes/:id', controller.updatePublicTheme);
router.delete('/public-themes/:id', controller.deletePublicTheme);
router.put('/public-themes/:id/apply', controller.applyPublicTheme);

module.exports = router;
