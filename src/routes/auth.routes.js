const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const validationRules = require('../utils/validation.util');

// Public routes
router.post(
  '/signup',
  validationRules.signup,
  validate,
  authController.signup
);

router.post(
  '/login',
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
  authenticate,
  validationRules.resetPassword,
  validate,
  authController.resetPassword
);

router.post('/refresh', authController.refreshSession);

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

module.exports = router;
