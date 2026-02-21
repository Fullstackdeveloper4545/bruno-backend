const express = require('express');
const controller = require('../controllers/reportController');
const router = express.Router();

router.get('/schedules', controller.listSchedules);
router.post('/schedules', controller.createSchedule);
router.put('/schedules/:id', controller.updateSchedule);
router.delete('/schedules/:id', controller.deleteSchedule);
router.post('/run-now', controller.runNow);

module.exports = router;
