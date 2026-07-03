const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { rateLimitLogin, rateLimitGoogleOAuth } = require('../middleware/rate-limit.middleware');
const validate = require('../middleware/validate.middleware');
const validationRules = require('../utils/validation.util');
const upload = require('../middleware/upload.middleware');

// Public routes
router.post(
  '/signup',
  validationRules.signup,
  validate,
  authController.signup
);

router.post(
  '/login',
  rateLimitLogin, // 🚦 Rate limit (10 attempts per 15 minutes per IP)
  validationRules.login,
  validate,
  authController.login
);

router.post(
  '/forgot-password',
  validationRules.forgotPassword,
  validate,
  authController.forgotPassword
);

router.post(
  '/reset-password',
  validationRules.resetPassword,
  validate,
  authController.resetPassword
);

// Verify reset token validity
router.get('/verify-reset-token', authController.verifyResetToken);

router.post('/refresh', authController.refreshSession);

// Google OAuth authentication
router.post('/google', rateLimitGoogleOAuth, authController.googleAuth);

// Resend verification email
router.post(
  '/resend-verification',
  validationRules.forgotPassword, // Reuse email validation
  validate,
  authController.resendVerification
);

// Protected routes (require authentication)
router.use(authenticate); // All routes below require authentication

router.get('/me', authController.getMe);

router.post('/logout', authController.logout);

router.put(
  '/profile',
  validationRules.updateProfile,
  validate,
  authController.updateProfile
);

// Upload avatar (with file upload)
router.post(
  '/upload-avatar',
  upload.single('avatar'),
  authController.uploadAvatar
);

// Update user role (post-auth role selection)
router.put('/update-role', authController.updateRole);

// Issue a short-lived Socket.io authentication ticket (HttpOnly cookies
// are not forwarded on WS handshakes, so we exchange a one-time ticket)
router.get('/ws-ticket', authController.getWsTicket);

module.exports = router;
