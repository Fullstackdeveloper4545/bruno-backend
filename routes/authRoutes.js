const express = require('express');
const router = express.Router();
const {
  register,
  verifyOtp,
  login,
  requestPasswordResetOtp,
  resetPasswordWithOtp,
  changePassword,
  deactivateCustomerAccount,
} = require('../controllers/authController');

router.post('/register', register);
router.post('/verify-otp', verifyOtp);
router.post('/login', login);
router.post('/forgot-password/request', requestPasswordResetOtp);
router.post('/forgot-password/reset', resetPasswordWithOtp);
router.post('/change-password', changePassword);
router.post('/customers/deactivate', deactivateCustomerAccount);

module.exports = router;
