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
  getAdminTwoFactorStatus,
  setupAdminTwoFactor,
  enableAdminTwoFactor,
  disableAdminTwoFactor,
} = require('../controllers/authController');

router.post('/register', register);
router.post('/verify-otp', verifyOtp);
router.post('/login', login);
router.post('/forgot-password/request', requestPasswordResetOtp);
router.post('/forgot-password/reset', resetPasswordWithOtp);
router.post('/change-password', changePassword);
router.post('/customers/deactivate', deactivateCustomerAccount);
router.get('/admin/2fa', getAdminTwoFactorStatus);
router.post('/admin/2fa/setup', setupAdminTwoFactor);
router.post('/admin/2fa/enable', enableAdminTwoFactor);
router.post('/admin/2fa/disable', disableAdminTwoFactor);

module.exports = router;
